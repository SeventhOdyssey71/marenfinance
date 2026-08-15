import type { Address } from 'viem';

/**
 * RPC endpoint resolution and a boot-time capability preflight.
 *
 * WHY THIS FILE EXISTS — read before "simplifying" it.
 *
 * `https://mezo.drpc.org` answers `eth_chainId` correctly and returns
 * `-32601 "the method does not exist/is not available"` for `eth_call`,
 * `eth_estimateGas`, `eth_getBalance`, `eth_blockNumber`, `eth_getLogs` and
 * `eth_getBlockByNumber` without an API key (probed 2026-08-15). A relayer that
 * checks connectivity by asking for the chain id would come up healthy and then
 * fail every single simulation, which for this service means failing the one
 * check that stops us burning BTC on doomed transactions.
 *
 * So: liveness here is defined as "serves the methods we actually call", not
 * "answers something". That is R8 — fail closed — applied to infrastructure.
 * An endpoint that cannot serve the relay path is dropped at boot, and if none
 * survive the relayer refuses to relay rather than discovering it per request.
 *
 * This is also why `@maren/sdk`'s chain defaults are filtered rather than used
 * as-is: the SDK's RPC list is written for read-mostly frontend use, and a bad
 * entry there must not silently become the relayer's transport.
 */

/**
 * Hosts that must never be used by the relayer, with the reason. Being on this
 * list is a statement about a specific measured failure, not a preference.
 */
export const RPC_HOST_DENYLIST: ReadonlyMap<string, string> = new Map([
  [
    'mezo.drpc.org',
    'public endpoint serves eth_chainId only; eth_call/eth_estimateGas/eth_getBlockByNumber return -32601 without an API key',
  ],
]);

/** Endpoints confirmed to serve a real `eth_call` (TroveManager.getTroveOwnersCount() -> 26). */
export const VERIFIED_RPCS = {
  mainnet: [
    'https://jsonrpc-mezo.boar.network',
    'https://mainnet.mezo.public.validationcloud.io',
  ],
  testnet: ['https://rpc.test.mezo.org'],
} as const;

export function isDeniedRpc(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return 'not a valid URL';
  }
  return RPC_HOST_DENYLIST.get(host) ?? null;
}

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
  /** Methods the endpoint does not serve (JSON-RPC -32601, or unreachable). */
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
}

interface JsonRpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string };
}

/** JSON-RPC "method not found". The exact signal dRPC returns. */
const METHOD_NOT_FOUND = -32601;

async function rpcCall(
  url: string,
  method: string,
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
      if (payload.error.code === METHOD_NOT_FOUND) {
        return { supported: false, reason: payload.error.message ?? 'method not found' };
      }
      // Any OTHER JSON-RPC error means the method exists and the node processed
      // it — a revert or an invalid-params complaint still proves capability.
      return { supported: true, reason: payload.error.message ?? 'rpc error' };
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
  const denied = isDeniedRpc(url);
  if (denied !== null) {
    return { url, ok: false, missing: [...REQUIRED_RPC_METHODS], chainId: null, reason: denied };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
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
    const outcome = await rpcCall(url, probe.method, probe.params, fetchImpl, timeoutMs);
    if (!outcome.supported) {
      missing.push(probe.method);
      reason ??= `${probe.method}: ${outcome.reason ?? 'unsupported'}`;
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
