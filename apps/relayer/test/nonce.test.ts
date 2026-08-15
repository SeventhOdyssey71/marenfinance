import { describe, expect, it, vi } from 'vitest';
import { getAddress, type Hash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildTestRelayer, FakeChain, SILENT_LOGGER, signedRequest } from './helpers.js';
import { bumpFees, NonceManager, TxWatcher, type PendingTx } from '../src/nonce.js';
import type { ReceiptLike } from '../src/receipt.js';

/**
 * Nonce serialisation.
 *
 * Two concurrent relays that both read `getTransactionCount` see the same value,
 * sign two transactions with the same nonce, and the chain keeps one. The user
 * whose transaction was dropped was already told it was submitted. These tests
 * assert the allocation is serialised end to end — including the broadcast,
 * because allocating under a lock and broadcasting outside it reintroduces the
 * race in a subtler form.
 */

const ADDRESS = getAddress('0x4444444444444444444444444444444444444444');

describe('NonceManager', () => {
  it('never issues the same nonce twice under concurrency', async () => {
    let chainNonce = 12;
    const manager = new NonceManager({
      address: ADDRESS,
      getTransactionCount: async () => chainNonce,
      logger: SILENT_LOGGER,
    });

    const issued: number[] = [];
    const jobs = Array.from({ length: 40 }, () =>
      manager.submit(
        { maxFeePerGas: 10n, maxPriorityFeePerGas: 1n },
        async (ctx) => {
          // A broadcast that takes a variable, non-zero amount of time is the
          // condition under which a naive implementation interleaves.
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
          issued.push(ctx.nonce);
          return `0x${ctx.nonce.toString(16).padStart(64, '0')}` as Hash;
        },
        { requestId: 'test', reservedWei: 0n, payer: ADDRESS },
      ),
    );

    const results = await Promise.all(jobs);
    const nonces = results.map((r) => r.nonce);

    expect(new Set(nonces).size).toBe(40);
    expect([...nonces].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 40 }, (_, i) => 12 + i),
    );
    // Broadcast order matches allocation order: the critical section covers both.
    expect(issued).toEqual(nonces);
    expect(chainNonce).toBe(12);
  });

  it('resyncs from the chain after a failed broadcast rather than reusing the nonce', async () => {
    let chainNonce = 5;
    let reads = 0;
    const manager = new NonceManager({
      address: ADDRESS,
      getTransactionCount: async () => {
        reads += 1;
        return chainNonce;
      },
      logger: SILENT_LOGGER,
    });

    await expect(
      manager.submit(
        { maxFeePerGas: 10n, maxPriorityFeePerGas: 1n },
        async () => {
          throw new Error('broadcast failed');
        },
        { requestId: 'a', reservedWei: 0n, payer: ADDRESS },
      ),
    ).rejects.toThrow('broadcast failed');

    // The failed transaction MIGHT have reached the mempool, so we do not assume
    // its nonce is free — we ask the chain again.
    chainNonce = 6;
    const ok = await manager.submit(
      { maxFeePerGas: 10n, maxPriorityFeePerGas: 1n },
      async (ctx) => `0x${ctx.nonce.toString(16).padStart(64, '0')}` as Hash,
      { requestId: 'b', reservedWei: 0n, payer: ADDRESS },
    );
    expect(ok.nonce).toBe(6);
    expect(reads).toBe(2);
  });

  it('a rejected job does not poison the queue', async () => {
    const manager = new NonceManager({
      address: ADDRESS,
      getTransactionCount: async () => 0,
      logger: SILENT_LOGGER,
    });
    const failing = manager.submit(
      { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
      async () => {
        throw new Error('nope');
      },
      { requestId: 'a', reservedWei: 0n, payer: ADDRESS },
    );
    await expect(failing).rejects.toThrow();
    const after = await manager.submit(
      { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
      async (ctx) => `0x${ctx.nonce.toString(16).padStart(64, '0')}` as Hash,
      { requestId: 'b', reservedWei: 0n, payer: ADDRESS },
    );
    expect(after.nonce).toBe(0);
  });

  it('reports in-flight work so shutdown can drain it', async () => {
    const manager = new NonceManager({
      address: ADDRESS,
      getTransactionCount: async () => 0,
      logger: SILENT_LOGGER,
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const job = manager.submit(
      { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
      async (ctx) => {
        await gate;
        return `0x${ctx.nonce.toString(16).padStart(64, '0')}` as Hash;
      },
      { requestId: 'a', reservedWei: 0n, payer: ADDRESS },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(manager.inFlight).toBe(1);
    release();
    await job;
    expect(manager.inFlight).toBe(0);
  });
});

describe('concurrent relays through the HTTP surface', () => {
  it('serialises nonces across simultaneous POST /relay calls', async () => {
    const chain = new FakeChain({ submitDelayMs: 3 });
    const relayer = await buildTestRelayer(undefined, chain);

    // Ten distinct users, all with forwarder nonce 0, all arriving at once.
    const users = Array.from({ length: 10 }, (_, i) =>
      privateKeyToAccount(`0x${(i + 1).toString(16).padStart(64, '0')}` as `0x${string}`),
    );
    const bodies = await Promise.all(users.map((account) => signedRequest({ account })));
    const responses = await Promise.all(bodies.map((body) => relayer.post('/relay', body)));

    for (const response of responses) expect(response.status).toBe(202);
    const nonces = (
      await Promise.all(responses.map((r) => r.json() as Promise<{ nonce: number }>))
    ).map((b) => b.nonce);

    expect(new Set(nonces).size).toBe(10);
    expect(chain.sent.map((s) => s.nonce)).toEqual([...nonces].sort((a, b) => a - b));
  });
});

describe('stuck transaction replacement', () => {
  it('bumps fees by more than the 10% the node requires', () => {
    const bumped = bumpFees({ maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 1_000n });
    expect(bumped.maxFeePerGas).toBeGreaterThan((1_000_000n * 110n) / 100n);
    expect(bumped.maxPriorityFeePerGas).toBeGreaterThan((1_000n * 110n) / 100n);
  });

  it('replaces a transaction that has sat without a receipt', async () => {
    const receipts = new Map<Hash, ReceiptLike>();
    const submitter = vi.fn(
      async (ctx: { nonce: number }) =>
        `0x${(ctx.nonce + 100).toString(16).padStart(64, '0')}` as Hash,
    );
    let now = 0;
    const watcher = new TxWatcher({
      reader: { getReceipt: async (hash) => receipts.get(hash) ?? null },
      logger: SILENT_LOGGER,
      stuckAfterMs: 1_000,
      maxReplacements: 3,
      now: () => now,
    });

    const tx: PendingTx = {
      nonce: 4,
      hash: '0xaaaa000000000000000000000000000000000000000000000000000000000000',
      fees: { maxFeePerGas: 1_300_000n, maxPriorityFeePerGas: 1n },
      submitter,
      submittedAt: 0,
      replacements: 0,
      requestId: 'stuck',
      reservedWei: 0n,
      payer: ADDRESS,
    };
    watcher.track(tx);

    // Not yet stuck.
    now = 500;
    await watcher.sweep();
    expect(submitter).not.toHaveBeenCalled();

    // Now it is.
    now = 2_000;
    await watcher.sweep();
    expect(submitter).toHaveBeenCalledTimes(1);
    const call = submitter.mock.calls[0]?.[0] as { nonce: number; maxFeePerGas: bigint };
    expect(call.nonce).toBe(4); // same nonce — that is the whole point
    expect(call.maxFeePerGas).toBeGreaterThan(1_300_000n);
    expect(watcher.size).toBe(1);
  });

  it('stops tracking once a receipt exists and reports the settlement', async () => {
    const hash = '0xbbbb000000000000000000000000000000000000000000000000000000000000' as Hash;
    const receipts = new Map<Hash, ReceiptLike>([
      [hash, { status: 'success', blockNumber: 10n, gasUsed: 100_000n, effectiveGasPrice: 1_300_000n }],
    ]);
    const settled: Array<{ success: boolean; gasCostWei: bigint | null }> = [];
    const watcher = new TxWatcher({
      reader: { getReceipt: async (h) => receipts.get(h) ?? null },
      logger: SILENT_LOGGER,
      stuckAfterMs: 1_000,
      maxReplacements: 3,
      onSettled: (_tx, settlement) => {
        settled.push({ success: settlement.success, gasCostWei: settlement.gasCostWei });
      },
    });

    watcher.track({
      nonce: 1,
      hash,
      fees: { maxFeePerGas: 1_300_000n, maxPriorityFeePerGas: 1n },
      submitter: async () => hash,
      submittedAt: Date.now(),
      replacements: 0,
      requestId: 'done',
      reservedWei: 260_000_000_000n,
      payer: ADDRESS,
    });

    await watcher.sweep();
    expect(watcher.size).toBe(0);
    expect(settled).toEqual([{ success: true, gasCostWei: 130_000_000_000n }]);
  });
});
