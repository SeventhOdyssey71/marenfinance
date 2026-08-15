import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import {
  isDeniedRpc,
  preflightRpcs,
  probeEndpoint,
  REQUIRED_RPC_METHODS,
  RPC_HOST_DENYLIST,
  VERIFIED_RPCS,
} from '../src/rpc.js';
import { loadConfig } from '../src/config.js';
import { createRelayer } from '../src/create.js';
import { MemoryStore } from '../src/store.js';
import { makeEnv, signedRequest, SILENT_LOGGER, type ErrorBody } from './helpers.js';

/**
 * RPC capability preflight.
 *
 * The failure this exists for, measured on 2026-08-15: `https://mezo.drpc.org`
 * answers `eth_chainId` and returns -32601 for everything else without an API
 * key. A relayer whose health check is "can I reach a node" comes up green and
 * then fails every simulation — which is the one check that stops it burning BTC
 * on transactions that were always going to revert.
 *
 * So the preflight asserts METHOD SUPPORT, not reachability, and refuses to
 * start when no endpoint has it. R8 applied to infrastructure.
 */

const CHAIN_ID = 31611;
const PROBE_CONTRACT = getAddress('0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503');
const PROBE_ACCOUNT = getAddress('0x4444444444444444444444444444444444444444');

/** A node that answers eth_chainId and nothing else — i.e. dRPC's public tier. */
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

describe('RPC denylist', () => {
  it('denies mezo.drpc.org with the measured reason', () => {
    const reason = isDeniedRpc('https://mezo.drpc.org');
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/eth_chainId only/);
    expect(RPC_HOST_DENYLIST.has('mezo.drpc.org')).toBe(true);
  });

  it('does not deny the verified endpoints', () => {
    for (const url of [...VERIFIED_RPCS.mainnet, ...VERIFIED_RPCS.testnet]) {
      expect(isDeniedRpc(url)).toBeNull();
    }
  });

  it('drops a denylisted host from the default endpoint list', () => {
    const { config } = loadConfig({
      RELAYER_NETWORK: 'mainnet',
      RELAYER_FORWARDER_ADDRESS: '0x1111111111111111111111111111111111111111',
      RELAYER_ALLOWED_TARGETS: 'marenPay:0x2222222222222222222222222222222222222222',
      RELAYER_MAX_DAILY_SPONSORED_BTC: '0.01',
      RELAYER_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
    });
    expect(config.rpcUrls).not.toContain('https://mezo.drpc.org');
    expect(config.rpcUrls[0]).toBe('https://jsonrpc-mezo.boar.network');
    expect(config.rpcUrls.length).toBeGreaterThan(1); // failover is configured
  });

  it('makes it a problem when an operator explicitly configures a denylisted host', () => {
    const { problems } = loadConfig(makeEnv({ RELAYER_RPC_URLS: 'https://mezo.drpc.org' }));
    expect(problems.join('\n')).toMatch(/not usable by the relayer/);
  });
});

describe('capability preflight', () => {
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
      return new Response(
        JSON.stringify({ error: { code: 3, message: 'execution reverted' } }),
        { status: 200 },
      );
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
      env: makeEnv({ RELAYER_RPC_URLS: 'https://pretend-drpc.test' }),
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
