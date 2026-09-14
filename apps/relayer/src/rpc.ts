import type { Address } from 'viem';

/**
 * RPC endpoint resolution and a boot-time capability preflight.
 *
 * WHY THIS FILE EXISTS — read before "simplifying" it.
 *
 * On Mezo, `-32601 "the method does not exist/is not available"` is NOT proof
 * that an endpoint lacks a method. During testing `mezo.drpc.org` returned
 * -32601 for `eth_call`, `eth_getLogs`, `eth_estimateGas` and `eth_blockNumber`
 * across a full probe sweep, and then served all of them 10/10 about an hour
 * later. A backend behind the load balancer was degraded and reported
 * "unsupported" rather than "unavailable" — which is indistinguishable from a
 * real capability limit if you probe once.
 *
 * Two lessons, both encoded here as behaviour rather than left as a comment:
 *
 *   1. NEVER condemn (or certify) an endpoint on a single probe. `probeEndpoint`
 *      retries a failing method before recording it as missing, so one degraded
 *      backend does not get an otherwise healthy provider dropped.
 *   2. FAILOVER IS NOT OPTIONAL. The relayer runs a `fallback` transport across
 *      every usable endpoint, because any of them can transiently claim a method
 *      does not exist.
 *
 * This preflight therefore answers "can THIS endpoint serve the relay path RIGHT
 * NOW", which is a liveness question, not a permanent statement about a provider.
 * It exists because a relayer that checks liveness by asking for the chain id
 * would come up healthy and then fail every simulation — and simulation is the
 * one check that stops us burning BTC on doomed transactions. That is R8 — fail
 * closed — applied to infrastructure.
 *
 * There is deliberately NO host denylist. A static in-code block against a
 * provider is unfalsifiable from the outside, ages badly, and cannot express
 * "was broken for an hour". Repeat-probing plus failover handles the real
 * hazard; a denylist never could. If an endpoint genuinely stops working, it
 * fails the preflight and is dropped for that boot, automatically.
 */

// ---------------------------------------------------------------------------
// capability preflight
// ---------------------------------------------------------------------------

/** The methods the relay path cannot work without. */
export const REQUIRED_RPC_METHODS = [
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_getTransactionCount',
] as const;

export type RequiredRpcMethod = (typeof REQUIRED_RPC_METHODS)[number];

export interface EndpointReport {
  readonly url: string;
  readonly ok: boolean;
  /** Methods that failed to return usable data after retries. */
  readonly missing: readonly RequiredRpcMethod[];
  readonly chainId: number | null;
  readonly reason: string | null;
}

export interface PreflightOptions {
  readonly expectedChainId: number;
  /** A contract we can safely `eth_call` — MUSD. `decimals()` is a pure read. */
  readonly probeContract: Address;
  /** An address to probe `eth_getTransactionCount` / `eth_estimateGas` with. */
  readonly probeAccount: Address;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /**
   * How many times to ask before believing a method is unavailable. Must be > 1:
   * a single -32601 on Mezo has already been observed to be a degraded backend
   * rather than a missing feature.
   */
  readonly attemptsPerMethod?: number;
  readonly retryDelayMs?: number;
}

interface JsonRpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string };
}

// A method existing is insufficient: these probes must return data the relay
// path can actually use. In particular, an RPC error on eth_chainId must never
// turn into an unknown chain that passes the network check.
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;

function usableResult(method: RequiredRpcMethod, result: unknown): boolean {
  switch (method) {
    case 'eth_chainId':
    case 'eth_estimateGas':
      return typeof result === 'string' && QUANTITY.test(result) && BigInt(result) > 0n;
    case 'eth_getTransactionCount':
      return typeof result === 'string' && QUANTITY.test(result);
    case 'eth_call':
      // The probe calls MUSD.decimals(), not an arbitrary contract function.
      return (
        typeof result === 'string' && /^0x[0-9a-f]{64}$/i.test(result) && BigInt(result) === 18n
      );
    case 'eth_getBlockByNumber': {
      if (result === null || typeof result !== 'object') return false;
      const block = result as Record<string, unknown>;
      return typeof block['number'] === 'string' && QUANTITY.test(block['number']);
    }
  }
}

async function rpcCall(
  url: string,
  method: RequiredRpcMethod,
  params: unknown[],
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ supported: boolean; result?: unknown; reason?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { supported: false, reason: `HTTP ${response.status}` };
    }
    const payload = (await response.json()) as JsonRpcResponse;
    if (payload.error !== undefined) {
      return { supported: false, reason: payload.error?.message ?? 'rpc error' };
    }
    if (!usableResult(method, payload.result)) {
      return { supported: false, reason: 'missing or invalid probe result' };
    }
    return { supported: true, result: payload.result };
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? `${error.name}: ${error.message}` : 'unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe one endpoint for every method the relay path needs.
 *
 * Note the `eth_call` probe is a REAL contract read (`MUSD.decimals()`), not a
 * call to the zero address: some gateways special-case trivial calls. And the
 * chain id must match — pointing a mainnet relayer at a testnet RPC would let it
 * sign requests whose EIP-712 domain can never verify.
 */
export async function probeEndpoint(
  url: string,
  options: PreflightOptions,
): Promise<EndpointReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const attempts = Math.max(2, options.attemptsPerMethod ?? 2);
  const retryDelayMs = options.retryDelayMs ?? 250;
  const missing: RequiredRpcMethod[] = [];
  let chainId: number | null = null;
  let reason: string | null = null;

  const probes: Array<{ method: RequiredRpcMethod; params: unknown[] }> = [
    { method: 'eth_chainId', params: [] },
    { method: 'eth_getBlockByNumber', params: ['latest', false] },
    { method: 'eth_call', params: [{ to: options.probeContract, data: '0x313ce567' }, 'latest'] },
    {
      method: 'eth_estimateGas',
      params: [{ from: options.probeAccount, to: options.probeAccount, value: '0x0' }],
    },
    { method: 'eth_getTransactionCount', params: [options.probeAccount, 'pending'] },
  ];

  for (const probe of probes) {
    // Ask more than once. A degraded backend answering -32601 recovers; a
    // genuinely absent method does not. Condemning an endpoint on one answer is
    // exactly the mistake that produced a bogus provider block in an earlier
    // revision of this file.
    let outcome = await rpcCall(url, probe.method, probe.params, fetchImpl, timeoutMs);
    for (let attempt = 1; attempt < attempts && !outcome.supported; attempt += 1) {
      if (retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
      outcome = await rpcCall(url, probe.method, probe.params, fetchImpl, timeoutMs);
    }

    if (!outcome.supported) {
      missing.push(probe.method);
      reason ??= `${probe.method}: ${outcome.reason ?? 'unsupported'} (after ${attempts} attempts)`;
      continue;
    }
    if (probe.method === 'eth_chainId' && typeof outcome.result === 'string') {
      chainId = Number.parseInt(outcome.result, 16);
    }
  }

  if (chainId !== null && chainId !== options.expectedChainId) {
    return {
      url,
      ok: false,
      missing,
      chainId,
      reason: `endpoint reports chain ${chainId}, expected ${options.expectedChainId}`,
    };
  }

  return { url, ok: missing.length === 0, missing, chainId, reason };
}

export interface PreflightResult {
  readonly reports: readonly EndpointReport[];
  /** Endpoints that passed, in the order they should be tried. */
  readonly usable: readonly string[];
  /** Fatal. Non-empty means the relayer must refuse to relay. */
  readonly problems: readonly string[];
  /** A degraded endpoint while others still work. Worth an alert, not a halt. */
  readonly warnings: readonly string[];
}

/**
 * Probe every configured endpoint. Endpoints are probed in parallel; the usable
 * ones keep their configured order so an operator's preference is respected.
 *
 * One dead backup is a WARNING — that is the entire point of configuring more
 * than one. Losing the last usable endpoint is a PROBLEM, and problems stop the
 * relayer from accepting work.
 */
export async function preflightRpcs(
  urls: readonly string[],
  options: PreflightOptions,
): Promise<PreflightResult> {
  const reports = await Promise.all(urls.map((url) => probeEndpoint(url, options)));
  const usable = reports.filter((r) => r.ok).map((r) => r.url);
  const warnings: string[] = [];
  const problems: string[] = [];

  for (const report of reports) {
    if (report.ok) continue;
    warnings.push(
      `RPC ${report.url} is unusable: ${report.reason ?? 'unknown'}${
        report.missing.length > 0 ? ` (missing: ${report.missing.join(', ')})` : ''
      }`,
    );
  }
  if (urls.length === 0) {
    problems.push('no RPC endpoints configured');
  } else if (usable.length === 0) {
    problems.push(
      `no configured RPC endpoint serves the methods the relay path needs (${REQUIRED_RPC_METHODS.join(', ')}); refusing to relay. ${warnings.join('; ')}`,
    );
  }
  return { reports, usable, problems, warnings };
}
