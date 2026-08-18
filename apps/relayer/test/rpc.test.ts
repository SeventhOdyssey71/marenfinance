import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { preflightRpcs, probeEndpoint, REQUIRED_RPC_METHODS } from '../src/rpc.js';
import { mezoMainnet, mezoTestnet } from '@maren/sdk';
import { loadConfig } from '../src/config.js';
import { createRelayer } from '../src/create.js';
import { MemoryStore } from '../src/store.js';
import { makeEnv, signedRequest, SILENT_LOGGER, type ErrorBody } from './helpers.js';

/**
 * RPC capability preflight.
 *
 * The property under test is provider-agnostic: ANY endpoint that cannot serve
 * the relay path right now is dropped, and if none survive the relayer refuses
 * to relay. A relayer whose health check is "can I reach a node" comes up green
 * and then fails every simulation — which is the one check that stops it burning
 * BTC on transactions that were always going to revert. So the preflight asserts
 * method support, not reachability. R8 applied to infrastructure.
 *
 * These tests name no provider on purpose. An earlier revision asserted that one
 * specific host was refused, based on a probe sweep that did not reproduce; the
 * host served every method 10/10 an hour later. What had been measured was a
 * degraded backend answering -32601 instead of signalling unavailability. The
 * durable lesson — a single -32601 proves nothing, so repeat-probe and fail over
 * — is now tested directly, below.
 */

const CHAIN_ID = 31611;
const PROBE_CONTRACT = getAddress('0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503');
const PROBE_ACCOUNT = getAddress('0x4444444444444444444444444444444444444444');

/** A node that answers eth_chainId and returns -32601 for everything else. */
function chainIdOnlyNode(chainId = CHAIN_ID): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const { method } = JSON.parse(String(init?.body)) as { method: string };
    if (method === 'eth_chainId') {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: `0x${chainId.toString(16)}` }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32601, message: 'the method does not exist/is not available' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

/** A node that serves everything. */
function healthyNode(chainId = CHAIN_ID): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const { method } = JSON.parse(String(init?.body)) as { method: string };
    const result =
      method === 'eth_chainId'
        ? `0x${chainId.toString(16)}`
        : method === 'eth_getBlockByNumber'
          ? { number: '0x1' }
          : method === 'eth_call'
            ? '0x0000000000000000000000000000000000000000000000000000000000000012'
            : '0x5208';
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('endpoint list resolution', () => {
  const baseEnv = {
    RELAYER_FORWARDER_ADDRESS: '0x1111111111111111111111111111111111111111',
    RELAYER_ALLOWED_TARGETS: 'marenPay:0x2222222222222222222222222222222222222222',
    RELAYER_MAX_DAILY_SPONSORED_BTC: '0.01',
    // A keystore rather than RELAYER_PRIVATE_KEY, because these cases resolve
    // config for MAINNET and a raw key in the environment is a boot problem
    // there. `loadConfig` only records the paths; nothing is read from disk
    // until a chain adapter is built, which these cases do not do.
    RELAYER_KEYSTORE_PATH: '/keys/maren-relayer',
    RELAYER_KEYSTORE_PASSWORD_FILE: '/keys/maren-relayer.pass',
  };

  it('takes every endpoint from the SDK chain definition, in its order', () => {
    const { config, problems } = loadConfig({ ...baseEnv, RELAYER_NETWORK: 'mainnet' });
    expect(problems).toEqual([]);
    // The SDK orders these by observed stability. The relayer does not second-guess it.
    expect(config.rpcUrls).toEqual([...mezoMainnet.rpcUrls.default.http]);
    expect(config.rpcUrls.length).toBeGreaterThan(1); // failover is configured
  });

  it('blocks no provider: every SDK endpoint survives config resolution', () => {
    for (const [network, chain] of [
      ['mainnet', mezoMainnet],
      ['testnet', mezoTestnet],
    ] as const) {
      const { config } = loadConfig({ ...baseEnv, RELAYER_NETWORK: network });
      for (const url of chain.rpcUrls.default.http) {
        expect(config.rpcUrls).toContain(url);
      }
    }
  });

  it('accepts any endpoint an operator configures, without opinion', () => {
    const { config, problems } = loadConfig(
      makeEnv({ RELAYER_RPC_URLS: 'https://a.test,https://b.test' }),
    );
    expect(problems).toEqual([]);
    expect(config.rpcUrls).toEqual(['https://a.test', 'https://b.test']);
  });

  it('de-duplicates while preserving order', () => {
    const { config } = loadConfig(
      makeEnv({ RELAYER_RPC_URLS: 'https://a.test,https://a.test/,https://b.test' }),
    );
    expect(config.rpcUrls).toEqual(['https://a.test', 'https://b.test']);
  });
});

describe('capability preflight', () => {
  /**
   * The regression test for the mistake this file used to encode.
   *
   * A backend behind a load balancer answers -32601 for a while and then serves
   * the method perfectly. Probing once condemns a working provider forever; that
   * is precisely what produced a bogus in-code host block in an earlier revision.
   * The probe must ask again before believing it.
   */
  it('does not condemn an endpoint whose -32601 was transient', async () => {
    let calls = 0;
    const flaky = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      // Every method fails on its FIRST attempt and succeeds on the retry —
      // a degraded backend reporting "unsupported" instead of "unavailable".
      const failing = calls % 2 === 1;
      if (failing) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32601, message: 'the method does not exist/is not available' },
          }),
          { status: 200 },
        );
      }
      return healthyNode()(_url as string, init);
    }) as unknown as typeof fetch;

    const report = await probeEndpoint('https://flaky.test', {
      expectedChainId: CHAIN_ID,
      probeContract: PROBE_CONTRACT,
      probeAccount: PROBE_ACCOUNT,
      fetchImpl: flaky,
      retryDelayMs: 0,
    });

    expect(report.ok).toBe(true);
    expect(report.missing).toEqual([]);
  });

  it('still fails an endpoint whose methods are missing on every attempt', async () => {
    const report = await probeEndpoint('https://example-rpc.test', {
      expectedChainId: CHAIN_ID,
      probeContract: PROBE_CONTRACT,
      probeAccount: PROBE_ACCOUNT,
      fetchImpl: chainIdOnlyNode(),
      retryDelayMs: 0,
      attemptsPerMethod: 3,
    });
    expect(report.ok).toBe(false);
    expect(report.reason).toMatch(/after 3 attempts/);
  });

  it('fails an endpoint that only serves eth_chainId', async () => {
    const report = await probeEndpoint('https://example-rpc.test', {
      expectedChainId: CHAIN_ID,
      probeContract: PROBE_CONTRACT,
      probeAccount: PROBE_ACCOUNT,
      fetchImpl: chainIdOnlyNode(),
    });

    expect(report.ok).toBe(false);
    expect(report.chainId).toBe(CHAIN_ID); // connectivity was fine — that is the trap
    expect(report.missing).toContain('eth_call');
    expect(report.missing).toContain('eth_estimateGas');
    expect(report.missing).toContain('eth_getBlockByNumber');
  });

  it('passes an endpoint that serves every required method', async () => {
    const report = await probeEndpoint('https://example-rpc.test', {
      expectedChainId: CHAIN_ID,
      probeContract: PROBE_CONTRACT,
      probeAccount: PROBE_ACCOUNT,
      fetchImpl: healthyNode(),
    });
    expect(report.ok).toBe(true);
    expect(report.missing).toHaveLength(0);
  });

  it('fails an endpoint that reports the wrong chain', async () => {
    const report = await probeEndpoint('https://example-rpc.test', {
      expectedChainId: 31611,
      probeContract: PROBE_CONTRACT,
      probeAccount: PROBE_ACCOUNT,
      fetchImpl: healthyNode(31612),
    });
    expect(report.ok).toBe(false);
    expect(report.reason).toMatch(/expected 31611/);
  });

  it('treats a revert as proof the method exists', async () => {
    const revertingNode = (async (_url: string | URL | Request, init?: RequestInit) => {
      const { method } = JSON.parse(String(init?.body)) as { method: string };
      if (method === 'eth_chainId') {
        return new Response(JSON.stringify({ result: `0x${CHAIN_ID.toString(16)}` }));
      }
      return new Response(JSON.stringify({ error: { code: 3, message: 'execution reverted' } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const report = await probeEndpoint('https://example-rpc.test', {
      expectedChainId: CHAIN_ID,
      probeContract: PROBE_CONTRACT,
      probeAccount: PROBE_ACCOUNT,
      fetchImpl: revertingNode,
    });
    expect(report.ok).toBe(true);
  });

  it('one dead backup is a warning; losing the last endpoint is fatal', async () => {
    const mixed = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      const impl = target.includes('good') ? healthyNode() : chainIdOnlyNode();
      return impl(target, init);
    }) as unknown as typeof fetch;

    const partial = await preflightRpcs(['https://good.test', 'https://bad.test'], {
      expectedChainId: CHAIN_ID,
      probeContract: PROBE_CONTRACT,
      probeAccount: PROBE_ACCOUNT,
      fetchImpl: mixed,
    });
    expect(partial.usable).toEqual(['https://good.test']);
    expect(partial.warnings).toHaveLength(1);
    expect(partial.problems).toHaveLength(0);

    const none = await preflightRpcs(['https://bad.test'], {
      expectedChainId: CHAIN_ID,
      probeContract: PROBE_CONTRACT,
      probeAccount: PROBE_ACCOUNT,
      fetchImpl: mixed,
    });
    expect(none.usable).toHaveLength(0);
    expect(none.problems.join('\n')).toMatch(/refusing to relay/);
  });

  it('lists eth_call and eth_estimateGas as required — the relay path needs both', () => {
    expect(REQUIRED_RPC_METHODS).toContain('eth_call');
    expect(REQUIRED_RPC_METHODS).toContain('eth_estimateGas');
    expect(REQUIRED_RPC_METHODS).toContain('eth_getBlockByNumber');
  });
});

describe('boot refuses when preflight fails', () => {
  it('a chain-id-only RPC means the relayer will not relay', async () => {
    const relayer = await createRelayer({
      env: makeEnv({ RELAYER_RPC_URLS: 'https://degraded-node.test' }),
      store: new MemoryStore(),
      logger: SILENT_LOGGER,
      fetchImpl: chainIdOnlyNode(),
    });

    expect(relayer.problems.join('\n')).toMatch(/no configured RPC endpoint serves the methods/);
    expect(relayer.service.accepting).toBe(false);
    expect(relayer.chain).toBeNull();

    const response = await relayer.app.fetch(
      new Request('http://relayer.test/relay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(await signedRequest()),
      }),
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as ErrorBody).error).toBe('RELAYER_NOT_ACCEPTING');
  });

  it('boots normally when the RPC serves everything', async () => {
    const relayer = await createRelayer({
      env: makeEnv({ RELAYER_RPC_URLS: 'https://healthy.test' }),
      store: new MemoryStore(),
      logger: SILENT_LOGGER,
      fetchImpl: healthyNode(),
    });
    expect(relayer.problems).toEqual([]);
    expect(relayer.chain).not.toBeNull();
  });
});
