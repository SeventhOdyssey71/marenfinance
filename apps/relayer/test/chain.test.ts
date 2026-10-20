import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hash } from 'viem';
import { createViemAdapter } from '../src/chain.js';
import { loadConfig } from '../src/config.js';
import { isRelayError } from '../src/errors.js';
import { parseForwardRequest } from '../src/forwarder.js';
import { settle, settlementHttpStatus } from '../src/receipt.js';
import { makeEnv, RELAYER_KEY, signedRequest } from './helpers.js';

/**
 * M3 — receipt-error handling had zero test protection.
 *
 * `chain.ts` distinguishes "the node has no receipt yet" (null → `submitted`)
 * from "we could not reach the node" (throw → `unknown`). Collapsing the second
 * into the first is a direct R15 hole: an RPC outage would be reported as
 * `state: 'submitted'` / 202, i.e. "still on its way", when in truth we have no
 * idea. The code was already correct; nothing would have caught a regression.
 */

const HASH = '0xdead000000000000000000000000000000000000000000000000000000000001' as Hash;

function adapter() {
  const { config, problems } = loadConfig(makeEnv({ RELAYER_RPC_URLS: 'http://stub-node.test' }));
  expect(problems).toEqual([]);
  return createViemAdapter({
    config,
    privateKey: RELAYER_KEY,
    rpcUrls: ['http://stub-node.test'],
  });
}

function stubNode(respond: (method: string) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      return respond(body.method);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(['eth_call', 'eth_estimateGas'])('%s failure classification', (stage) => {
  function failAtStage(failure: () => Response) {
    const methods: string[] = [];
    stubNode((method) => {
      methods.push(method);
      return method === stage
        ? failure()
        : new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' }));
    });
    return methods;
  }

  it.each([3, -32000])('preserves a genuine EVM revert (RPC code %s)', async (code) => {
    const methods = failAtStage(
      () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: { code, message: 'execution reverted: BorrowingCeiling' },
          }),
        ),
    );
    await expect(
      adapter().simulate(parseForwardRequest(await signedRequest())),
    ).rejects.toMatchObject({
      code: 'SIMULATION_REVERTED',
      status: 422,
      message: expect.stringContaining('BorrowingCeiling'),
    });
    expect(methods).not.toContain('eth_sendRawTransaction');
    if (stage === 'eth_call') expect(methods).not.toContain('eth_estimateGas');
  });

  it('reports an HTTP outage as upstream unavailable without leaking its body', async () => {
    failAtStage(() => new Response('private-provider-token/signed-calldata', { status: 503 }));
    await expect(
      adapter().simulate(parseForwardRequest(await signedRequest())),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      status: 502,
      message: expect.not.stringContaining('private-provider-token'),
    });
  });

  it('does not mistake an internal RPC error for a contract revert', async () => {
    failAtStage(
      () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32603, message: 'node unavailable' },
          }),
        ),
    );
    await expect(
      adapter().simulate(parseForwardRequest(await signedRequest())),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      status: 502,
    });
  });
});

describe('receipt reading', () => {
  it('returns null (=> "submitted") when the node simply has no receipt yet', async () => {
    stubNode(() => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null })));

    const receipt = await adapter().getReceipt(HASH);
    expect(receipt).toBeNull();

    const settlement = await settle({ getReceipt: async () => receipt }, HASH);
    expect(settlement.state).toBe('submitted');
    expect(settlement.success).toBe(false);
  });

  it('THROWS on an RPC failure so the state becomes "unknown", not "submitted"', async () => {
    stubNode(() => new Response('upstream exploded', { status: 500 }));

    const chain = adapter();
    await expect(chain.getReceipt(HASH)).rejects.toSatisfy(
      (error: unknown) => isRelayError(error) && error.code === 'UPSTREAM_ERROR',
    );

    // And through the one shared decision point (R15).
    const settlement = await settle(chain, HASH);
    expect(settlement.state).toBe('unknown');
    expect(settlement.success).toBe(false);
    expect(settlementHttpStatus(settlement.state)).toBe(502);
  });

  it('a confirmed receipt reports success and the real gas cost', async () => {
    stubNode((method) => {
      if (method === 'eth_getTransactionReceipt') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              transactionHash: HASH,
              blockNumber: '0x64',
              blockHash: `0x${'11'.repeat(32)}`,
              transactionIndex: '0x0',
              from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
              to: '0x1111111111111111111111111111111111111111',
              cumulativeGasUsed: '0x186a0',
              gasUsed: '0x186a0',
              effectiveGasPrice: '0x13d620',
              contractAddress: null,
              logs: [],
              logsBloom: `0x${'00'.repeat(256)}`,
              status: '0x1',
              type: '0x2',
            },
          }),
        );
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }));
    });

    const settlement = await settle(adapter(), HASH);
    expect(settlement.state).toBe('confirmed');
    expect(settlement.success).toBe(true);
    expect(settlement.gasUsed).toBe(100_000n);
    expect(settlement.gasCostWei).toBe(100_000n * 1_300_000n);
  });

  it('a reverted receipt is not a success, and we still paid', async () => {
    stubNode((method) => {
      if (method === 'eth_getTransactionReceipt') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              transactionHash: HASH,
              blockNumber: '0x64',
              blockHash: `0x${'11'.repeat(32)}`,
              transactionIndex: '0x0',
              from: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
              to: '0x1111111111111111111111111111111111111111',
              cumulativeGasUsed: '0x186a0',
              gasUsed: '0x186a0',
              effectiveGasPrice: '0x13d620',
              contractAddress: null,
              logs: [],
              logsBloom: `0x${'00'.repeat(256)}`,
              status: '0x0',
              type: '0x2',
            },
          }),
        );
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }));
    });

    const settlement = await settle(adapter(), HASH);
    expect(settlement.state).toBe('reverted');
    expect(settlement.success).toBe(false);
    expect(settlement.gasCostWei).toBeGreaterThan(0n);
  });
});
