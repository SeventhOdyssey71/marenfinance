import { describe, expect, it } from 'vitest';
import { parseEther, type Hash } from 'viem';
import { buildTestRelayer, FakeChain, signedRequest, USER, type ErrorBody } from './helpers.js';
import { MemoryStore, keys } from '../src/store.js';
import { settle, settlementHttpStatus } from '../src/receipt.js';

/**
 * Simulate before submitting, and never call a hash a success.
 */

describe('simulation gate', () => {
  it('does not submit a transaction that reverts in simulation', async () => {
    const chain = new FakeChain({ simulateReverts: true });
    const relayer = await buildTestRelayer(undefined, chain);

    const response = await relayer.post('/relay', await signedRequest());

    expect(response.status).toBe(422);
    const body = (await response.json()) as ErrorBody;
    expect(body.error).toBe('SIMULATION_REVERTED');
    expect(body.detail).toMatch(/reverts in simulation/);

    expect(chain.simulations).toBe(1);
    expect(chain.sent).toHaveLength(0);
  });

  it('does not consume quota for a request that never got submitted', async () => {
    const store = new MemoryStore();
    const chain = new FakeChain({ simulateReverts: true });
    const relayer = await buildTestRelayer(undefined, chain, store);

    await relayer.post('/relay', await signedRequest());

    // The reservation happens AFTER simulation, so a doomed request costs the
    // user nothing and costs us nothing.
    expect(await store.get(keys.lifetime(USER.address))).toBe(0n);
  });

  it('releases the reservation when the broadcast itself fails', async () => {
    const store = new MemoryStore();
    const chain = new FakeChain();
    chain.sendExecute = async () => {
      throw new Error('replacement transaction underpriced');
    };
    const relayer = await buildTestRelayer(undefined, chain, store);

    const response = await relayer.post('/relay', await signedRequest());
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await store.get(keys.lifetime(USER.address))).toBe(0n);
  });

  it('refuses to start work when the hot key is out of BTC', async () => {
    const chain = new FakeChain({ balanceWei: 1n });
    const relayer = await buildTestRelayer(undefined, chain);
    const response = await relayer.post('/relay', await signedRequest());
    expect(response.status).toBe(503);
    expect(((await response.json()) as ErrorBody).error).toBe('RELAYER_UNDERFUNDED');
    expect(chain.sent).toHaveLength(0);
  });
});

/**
 * R15 — a transaction hash is not a success. Checked in ONE shared place
 * (`src/receipt.ts`), which is what these tests exercise.
 */
describe('settlement (R15)', () => {
  const hash = '0xcccc000000000000000000000000000000000000000000000000000000000000' as Hash;

  it('a broadcast with no receipt yet is NOT a success', async () => {
    const settlement = await settle({ getReceipt: async () => null }, hash);
    expect(settlement.state).toBe('submitted');
    expect(settlement.success).toBe(false);
    expect(settlementHttpStatus(settlement.state)).toBe(202);
  });

  it('a reverted receipt is NOT a success', async () => {
    const settlement = await settle(
      {
        getReceipt: async () => ({
          status: 'reverted',
          blockNumber: 1n,
          gasUsed: 90_000n,
          effectiveGasPrice: 1_300_000n,
        }),
      },
      hash,
    );
    expect(settlement.state).toBe('reverted');
    expect(settlement.success).toBe(false);
    // We still paid for it.
    expect(settlement.gasCostWei).toBe(117_000_000_000n);
  });

  it('only a success receipt is a success', async () => {
    const settlement = await settle(
      {
        getReceipt: async () => ({
          status: 'success',
          blockNumber: 2n,
          gasUsed: 100_000n,
          effectiveGasPrice: 1_300_000n,
        }),
      },
      hash,
    );
    expect(settlement.state).toBe('confirmed');
    expect(settlement.success).toBe(true);
  });

  it('an RPC failure is "unknown", never a verdict either way', async () => {
    const settlement = await settle(
      {
        getReceipt: async () => {
          throw new Error('upstream down');
        },
      },
      hash,
    );
    expect(settlement.state).toBe('unknown');
    expect(settlement.success).toBe(false);
    expect(settlementHttpStatus(settlement.state)).toBe(502);
  });

  it('POST /relay answers 202 and never claims success', async () => {
    const relayer = await buildTestRelayer();
    const response = await relayer.post('/relay', await signedRequest());
    expect(response.status).toBe(202);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['success']).toBe(false);
    expect(body['state']).toBe('submitted');
    expect(body['statusUrl']).toBe(`/status/${body['hash'] as string}`);
  });

  it('GET /status reports the on-chain verdict', async () => {
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(undefined, chain);
    const submitted = (await (await relayer.post('/relay', await signedRequest())).json()) as {
      hash: Hash;
    };

    const pendingResponse = await relayer.get(`/status/${submitted.hash}`);
    expect(pendingResponse.status).toBe(202);
    expect(((await pendingResponse.json()) as { success: boolean }).success).toBe(false);

    chain.receipts.set(submitted.hash, {
      status: 'success',
      blockNumber: 99n,
      gasUsed: 100_000n,
      effectiveGasPrice: 1_300_000n,
    });
    const confirmed = await relayer.get(`/status/${submitted.hash}`);
    expect(confirmed.status).toBe(200);
    expect(((await confirmed.json()) as { success: boolean }).success).toBe(true);
  });

  it('rejects a malformed hash', async () => {
    const relayer = await buildTestRelayer();
    expect((await relayer.get('/status/0xnope')).status).toBe(400);
  });
});

describe('health', () => {
  it('reports the relayer address, balance, nonce, chain id and posture', async () => {
    const chain = new FakeChain({ balanceWei: parseEther('0.25') });
    const relayer = await buildTestRelayer(undefined, chain);
    const response = await relayer.get('/health');

    expect(response.status).toBe(200);
    const health = (await response.json()) as Record<string, unknown>;
    expect(health['relayer']).toBe(chain.account);
    expect(health['balanceBtc']).toBe('0.25000000');
    expect(health['nonce']).toBe(7);
    expect(health['chainId']).toBe(31611);
    expect(health['accepting']).toBe(true);
    expect(health['problems']).toEqual([]);
  });

  it('drains in-flight work on shutdown and stops accepting', async () => {
    const chain = new FakeChain({ submitDelayMs: 20 });
    const relayer = await buildTestRelayer(undefined, chain);

    const inFlight = relayer.post('/relay', await signedRequest());
    await new Promise((resolve) => setTimeout(resolve, 5));

    const drain = relayer.service.drain(5_000);
    // Work that arrives during the drain is refused...
    const late = await relayer.post('/relay', await signedRequest({ nonce: 0n }));
    expect(late.status).toBe(503);
    expect(((await late.json()) as ErrorBody).error).toBe('RELAYER_SHUTTING_DOWN');

    // ...but work already in flight finishes.
    expect((await inFlight).status).toBe(202);
    await drain;
    expect(chain.sent).toHaveLength(1);
  });
});
