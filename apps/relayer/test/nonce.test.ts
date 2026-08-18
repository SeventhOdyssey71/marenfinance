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
        { requestId: 'test', reservedWei: 0n, reservedDay: '2026-08-15', payer: ADDRESS },
      ),
    );

    const results = await Promise.all(jobs);
    const nonces = results.map((r) => r.nonce);

    expect(new Set(nonces).size).toBe(40);
    expect([...nonces].sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => 12 + i));
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
        { requestId: 'a', reservedWei: 0n, reservedDay: '2026-08-15', payer: ADDRESS },
      ),
    ).rejects.toThrow('broadcast failed');

    // The failed transaction MIGHT have reached the mempool, so we do not assume
    // its nonce is free — we ask the chain again.
    chainNonce = 6;
    const ok = await manager.submit(
      { maxFeePerGas: 10n, maxPriorityFeePerGas: 1n },
      async (ctx) => `0x${ctx.nonce.toString(16).padStart(64, '0')}` as Hash,
      { requestId: 'b', reservedWei: 0n, reservedDay: '2026-08-15', payer: ADDRESS },
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
      { requestId: 'a', reservedWei: 0n, reservedDay: '2026-08-15', payer: ADDRESS },
    );
    await expect(failing).rejects.toThrow();
    const after = await manager.submit(
      { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
      async (ctx) => `0x${ctx.nonce.toString(16).padStart(64, '0')}` as Hash,
      { requestId: 'b', reservedWei: 0n, reservedDay: '2026-08-15', payer: ADDRESS },
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
      { requestId: 'a', reservedWei: 0n, reservedDay: '2026-08-15', payer: ADDRESS },
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

  it('never has two broadcasts in flight at once, however many relays arrive together', async () => {
    // Distinct nonces are necessary but not sufficient. Allocating under a lock
    // and broadcasting outside it produces distinct nonces AND overlapping
    // submissions, which is the shape that reorders transactions in the mempool
    // and strands the queue behind a nonce gap. This asserts the property that
    // actually matters: the critical section covers the broadcast.
    const chain = new FakeChain();
    let concurrent = 0;
    let peak = 0;
    const originalSend = chain.sendExecute.bind(chain);
    chain.sendExecute = async (request, ctx) => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1 + Math.random() * 4));
        return await originalSend(request, ctx);
      } finally {
        concurrent -= 1;
      }
    };

    const relayer = await buildTestRelayer(undefined, chain);
    const users = Array.from({ length: 20 }, (_, i) =>
      privateKeyToAccount(`0x${(i + 1).toString(16).padStart(64, '0')}` as `0x${string}`),
    );
    const bodies = await Promise.all(users.map((account) => signedRequest({ account })));
    const responses = await Promise.all(bodies.map((body) => relayer.post('/relay', body)));

    for (const response of responses) expect(response.status).toBe(202);
    expect(peak).toBe(1);
    expect(chain.sent.map((s) => s.nonce)).toEqual(
      Array.from({ length: 20 }, (_, i) => 7 + i), // FakeChain's chain nonce starts at 7
    );
  });
});

/**
 * Stuck-nonce recovery.
 *
 * The failure this closes: something else consumes a nonce we believe is ours
 * (a transaction from a previous process that finally landed, an operator
 * sending from the hot key by hand, a mempool that dropped and re-accepted). The
 * cached counter is then permanently one behind, every submission is rejected
 * with "nonce too low", and the relayer stays broken until it is restarted.
 */
describe('stuck-nonce recovery', () => {
  /** A submitter that rejects anything below the node's idea of the next nonce. */
  function nodeAt(
    next: () => number,
    attempts: number[],
  ): (ctx: { nonce: number }) => Promise<Hash> {
    return async (ctx) => {
      attempts.push(ctx.nonce);
      if (ctx.nonce < next()) {
        throw new Error(
          `broadcast failed: nonce too low: next nonce ${next()}, tx nonce ${ctx.nonce}`,
        );
      }
      return `0x${ctx.nonce.toString(16).padStart(64, '0')}` as Hash;
    };
  }

  const META = { requestId: 'a', reservedWei: 0n, reservedDay: '2026-08-15', payer: ADDRESS };
  const FEES = { maxFeePerGas: 10n, maxPriorityFeePerGas: 1n };

  it('refetches the pending nonce and retries once when the node says the nonce is stale', async () => {
    let chainNonce = 5;
    const manager = new NonceManager({
      address: ADDRESS,
      getTransactionCount: async () => chainNonce,
      logger: SILENT_LOGGER,
    });

    // First submission syncs to 5 and lands.
    await manager.submit(
      FEES,
      nodeAt(() => 5, []),
      META,
    );

    // Something else consumes 6, 7 and 8 while we were not looking.
    chainNonce = 9;
    const attempts: number[] = [];
    const recovered = await manager.submit(
      FEES,
      nodeAt(() => 9, attempts),
      META,
    );

    expect(attempts).toEqual([6, 9]); // stale attempt, then the refetched nonce
    expect(recovered.nonce).toBe(9);
    expect(manager.resyncs).toBe(1);
    expect(manager.nextNonce).toBe(10);
    expect(manager.lastSubmission?.nonce).toBe(9);
  });

  it('does not retry a broadcast failure that is not about the nonce', async () => {
    // A transport error may mean the node accepted the transaction and lost the
    // response. Retrying that is how one relay becomes two transactions and two
    // lots of gas.
    let reads = 0;
    const manager = new NonceManager({
      address: ADDRESS,
      getTransactionCount: async () => {
        reads += 1;
        return 5;
      },
      logger: SILENT_LOGGER,
    });

    let attempts = 0;
    await expect(
      manager.submit(
        FEES,
        async () => {
          attempts += 1;
          throw new Error('broadcast failed: socket hang up');
        },
        META,
      ),
    ).rejects.toThrow('socket hang up');

    expect(attempts).toBe(1);
    expect(manager.resyncs).toBe(1);
    // Invalidated, not refetched: the next allocation asks the chain.
    expect(manager.nextNonce).toBeNull();
    expect(reads).toBe(1);
  });

  it('does not retry when the chain hands back the same nonce that just failed', async () => {
    // "nonce too low" with no movement on the chain means something we cannot
    // fix by resubmitting. One attempt, one refetch, then out.
    const manager = new NonceManager({
      address: ADDRESS,
      getTransactionCount: async () => 5,
      logger: SILENT_LOGGER,
    });

    let attempts = 0;
    await expect(
      manager.submit(
        FEES,
        async () => {
          attempts += 1;
          throw new Error('broadcast failed: nonce too low');
        },
        META,
      ),
    ).rejects.toThrow('nonce too low');

    expect(attempts).toBe(1);
    expect(manager.nextNonce).toBeNull();
  });

  it('surfaces a failed retry and leaves nothing cached', async () => {
    let chainNonce = 5;
    const manager = new NonceManager({
      address: ADDRESS,
      getTransactionCount: async () => chainNonce,
      logger: SILENT_LOGGER,
    });
    await manager.submit(
      FEES,
      nodeAt(() => 5, []),
      META,
    );
    chainNonce = 9;

    await expect(
      manager.submit(
        FEES,
        async (ctx) => {
          throw new Error(
            ctx.nonce === 6 ? 'broadcast failed: nonce too low' : 'broadcast failed: node is gone',
          );
        },
        META,
      ),
    ).rejects.toThrow('node is gone');

    expect(manager.nextNonce).toBeNull();
    expect(manager.resyncs).toBe(1);
  });

  it('leaves the nonce invalidated when the recovery read itself fails', async () => {
    let synced = false;
    const manager = new NonceManager({
      address: ADDRESS,
      getTransactionCount: async () => {
        if (synced) throw new Error('RPC is down');
        synced = true;
        return 5;
      },
      logger: SILENT_LOGGER,
    });

    await expect(
      manager.submit(
        FEES,
        async () => {
          throw new Error('broadcast failed: nonce too low');
        },
        META,
      ),
    ).rejects.toThrow('nonce too low');

    // A refetch that fails must not leave a stale number behind. Reusing one is
    // how a transaction a user was already told about gets replaced.
    expect(manager.nextNonce).toBeNull();
    expect(manager.resyncs).toBe(1);
  });

  it('recovers through the HTTP surface, so a stuck key does not need a restart', async () => {
    const chain = new FakeChain();
    // The node has moved on from FakeChain's cached 7 without us noticing.
    const originalSend = chain.sendExecute.bind(chain);
    let nodeNonce = 7;
    chain.sendExecute = async (request, ctx) => {
      if (ctx.nonce < nodeNonce) throw new Error('broadcast failed: nonce too low');
      return originalSend(request, ctx);
    };
    const relayer = await buildTestRelayer(undefined, chain);

    const first = await relayer.post('/relay', await signedRequest());
    expect(first.status).toBe(202);

    // Three nonces consumed elsewhere between the two relays.
    nodeNonce = 11;
    chain.transactionCount = async () => nodeNonce;

    const account = privateKeyToAccount(`0x${'02'.repeat(32)}`);
    const second = await relayer.post('/relay', await signedRequest({ account }));
    expect(second.status).toBe(202);
    expect(((await second.json()) as { nonce: number }).nonce).toBe(11);

    const healthz = (await (await relayer.get('/healthz')).json()) as {
      nonce: { next: number; resyncs: number };
    };
    expect(healthz.nonce.resyncs).toBe(1);
    expect(healthz.nonce.next).toBe(12);
  });

  it('reports queue depth while submissions are waiting', async () => {
    const manager = new NonceManager({
      address: ADDRESS,
      getTransactionCount: async () => 0,
      logger: SILENT_LOGGER,
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const jobs = Array.from({ length: 4 }, (_, i) =>
      manager.submit(
        FEES,
        async (ctx) => {
          if (i === 0) await gate;
          return `0x${ctx.nonce.toString(16).padStart(64, '0')}` as Hash;
        },
        META,
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    // One broadcasting, three waiting behind it. That number is what tells an
    // operator whether a slow RPC is queueing users up.
    expect(manager.queued).toBe(4);
    expect(manager.inFlight).toBe(1);

    release();
    await Promise.all(jobs);
    expect(manager.queued).toBe(0);
    expect(manager.inFlight).toBe(0);
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
      reservedDay: '2026-08-15',
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
      [
        hash,
        { status: 'success', blockNumber: 10n, gasUsed: 100_000n, effectiveGasPrice: 1_300_000n },
      ],
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
      reservedDay: '2026-08-15',
      payer: ADDRESS,
    });

    await watcher.sweep();
    expect(watcher.size).toBe(0);
    expect(settled).toEqual([{ success: true, gasCostWei: 130_000_000_000n }]);
  });
});
