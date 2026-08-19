import { describe, expect, it, vi } from 'vitest';
import { parseEther, type Hash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildTestRelayer,
  FakeChain,
  makeEnv,
  signedRequest,
  SILENT_LOGGER,
  USER,
  type ErrorBody,
} from './helpers.js';
import { createRelayer } from '../src/create.js';
import { keys, MemoryStore, utcDay } from '../src/store.js';
import { TxWatcher, type PendingTx } from '../src/nonce.js';
import { loadConfig } from '../src/config.js';

/**
 * The economic abuse layer: budget reconciliation, the multi-instance store
 * requirement, request dedupe, and the replacement cap. Everything here guards
 * the sponsorship budget rather than the signature path.
 */

const ADDRESS = '0x4444444444444444444444444444444444444444' as const;

function pending(overrides: Partial<PendingTx> = {}): PendingTx {
  return {
    nonce: 1,
    hash: '0xfeed000000000000000000000000000000000000000000000000000000000001' as Hash,
    fees: { maxFeePerGas: 1_300_000n, maxPriorityFeePerGas: 1n },
    submitter: async () => '0x0' as Hash,
    submittedAt: Date.now(),
    replacements: 0,
    requestId: 'r',
    reservedWei: 1_000_000n,
    reservedDay: '2026-08-15',
    payer: ADDRESS,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// M1 — reconcile() was deletable with no test failing
// ---------------------------------------------------------------------------

describe('gas reservation reconciliation', () => {
  it('credits back the difference when a transaction cost less than reserved', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);
    await store.incrBy(keys.spendDay('2026-08-15'), 1_000_000n, 0);

    await relayer.service.reconcile(pending({ reservedWei: 1_000_000n }), {
      hash: pending().hash,
      state: 'confirmed',
      success: true,
      blockNumber: 1n,
      gasUsed: 100n,
      effectiveGasPrice: 3_000n,
      gasCostWei: 300_000n,
      from: null,
    });

    // Reserved 1,000,000; actually cost 300,000. The budget gets 700,000 back.
    expect(await store.get(keys.spendDay('2026-08-15'))).toBe(300_000n);
  });

  it('debits more when a transaction cost more than reserved', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);
    await store.incrBy(keys.spendDay('2026-08-15'), 1_000_000n, 0);

    await relayer.service.reconcile(pending({ reservedWei: 1_000_000n }), {
      hash: pending().hash,
      state: 'confirmed',
      success: true,
      blockNumber: 1n,
      gasUsed: 100n,
      effectiveGasPrice: 3_000n,
      gasCostWei: 1_500_000n,
      from: null,
    });
    expect(await store.get(keys.spendDay('2026-08-15'))).toBe(1_500_000n);
  });

  it('applies the adjustment to the RESERVATION day, not today', async () => {
    const store = new MemoryStore();
    // "Today" is the 16th; the reservation was debited on the 15th.
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T00:01:00Z'));

    await store.incrBy(keys.spendDay('2026-08-15'), 1_000_000n, 0);
    await relayer.service.reconcile(pending({ reservedDay: '2026-08-15' }), {
      hash: pending().hash,
      state: 'confirmed',
      success: true,
      blockNumber: 1n,
      gasUsed: 1n,
      effectiveGasPrice: 1n,
      gasCostWei: 400_000n,
      from: null,
    });

    // Yesterday is corrected...
    expect(await store.get(keys.spendDay('2026-08-15'))).toBe(400_000n);
    // ...and today is untouched. Crediting today would hand out free budget.
    expect(await store.get(keys.spendDay('2026-08-16'))).toBe(0n);
    vi.useRealTimers();
  });

  it('clamps the daily counter at zero instead of going negative', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);
    // Nothing recorded, but a large refund arrives (double reconciliation, or a
    // counter that expired between reserve and settle).
    await relayer.service.reconcile(pending({ reservedWei: 5_000_000n }), {
      hash: pending().hash,
      state: 'confirmed',
      success: true,
      blockNumber: 1n,
      gasUsed: 1n,
      effectiveGasPrice: 1n,
      gasCostWei: 1_000n,
      from: null,
    });
    // A negative counter would be free budget for everyone until it climbed back.
    expect(await store.get(keys.spendDay('2026-08-15'))).toBe(0n);
  });

  it('does nothing when the settlement has no gas cost', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);
    await store.incrBy(keys.spendDay('2026-08-15'), 42n, 0);
    await relayer.service.reconcile(pending(), {
      hash: pending().hash,
      state: 'submitted',
      success: false,
      blockNumber: null,
      gasUsed: null,
      effectiveGasPrice: null,
      gasCostWei: null,
      from: null,
    });
    expect(await store.get(keys.spendDay('2026-08-15'))).toBe(42n);
  });

  /**
   * The headline mechanism of the committed-spend fix, and it had no coverage:
   * replacing this delta with `0n` left all 210 tests green. `committed:<day>`
   * is what latches the day-long halt, so if it never converges on what we
   * actually paid the halt fires at the wrong time in one direction or the
   * other. Tested here independent of whether it is currently correct.
   */
  it('corrects committed spend downward when a transaction cost less than reserved', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);
    await store.incrBy(keys.spendDay('2026-08-15'), 1_000_000n, 0);
    await store.incrBy(keys.committedDay('2026-08-15'), 1_000_000n, 0);

    await relayer.service.reconcile(pending({ reservedWei: 1_000_000n }), {
      hash: pending().hash,
      state: 'confirmed',
      success: true,
      blockNumber: 1n,
      gasUsed: 100n,
      effectiveGasPrice: 3_000n,
      gasCostWei: 300_000n,
      from: null,
    });

    // Both counters converge on the real cost. If committed did not move, the
    // halt would latch off a number 3x the truth.
    expect(await store.get(keys.spendDay('2026-08-15'))).toBe(300_000n);
    expect(await store.get(keys.committedDay('2026-08-15'))).toBe(300_000n);
  });

  it('corrects committed spend upward when a transaction cost more than reserved', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);
    await store.incrBy(keys.spendDay('2026-08-15'), 1_000_000n, 0);
    await store.incrBy(keys.committedDay('2026-08-15'), 1_000_000n, 0);

    await relayer.service.reconcile(pending({ reservedWei: 1_000_000n }), {
      hash: pending().hash,
      state: 'confirmed',
      success: true,
      blockNumber: 1n,
      gasUsed: 100n,
      effectiveGasPrice: 3_000n,
      gasCostWei: 1_500_000n,
      from: null,
    });
    expect(await store.get(keys.committedDay('2026-08-15'))).toBe(1_500_000n);
  });

  it('clamps committed spend at zero, never negative', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);
    // No committed spend recorded, but a large downward correction arrives.
    await relayer.service.reconcile(pending({ reservedWei: 5_000_000n }), {
      hash: pending().hash,
      state: 'confirmed',
      success: true,
      blockNumber: 1n,
      gasUsed: 1n,
      effectiveGasPrice: 1n,
      gasCostWei: 1_000n,
      from: null,
    });
    expect(await store.get(keys.committedDay('2026-08-15'))).toBe(0n);
  });

  it('is wired to the watcher, so a settled transaction actually reconciles', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);
    await store.incrBy(keys.spendDay('2026-08-15'), 1_000_000n, 0);

    const hash = '0xabcd000000000000000000000000000000000000000000000000000000000001' as Hash;
    relayer.chainFake.receipts.set(hash, {
      status: 'success',
      blockNumber: 5n,
      gasUsed: 100n,
      effectiveGasPrice: 2_000n,
    });
    relayer.watcher?.track(pending({ hash, reservedWei: 1_000_000n }));
    await relayer.watcher?.sweep();

    expect(await store.get(keys.spendDay('2026-08-15'))).toBe(200_000n);
  });
});

// ---------------------------------------------------------------------------
// THE LATCHING HALT, RE-ATTACKED
// ---------------------------------------------------------------------------

/**
 * Adversarial round 2 removed one latching denial of service — the halt used to
 * fire off RESERVED spend, so a burst of doomed requests took the relayer down
 * for a day having spent nothing. This is the one that survived it.
 *
 * `#commitSpend` latches off `request.gas * maxFeePerGas`. `request.gas` is a
 * CEILING chosen by the signer, not a cost. The relayer's own cap allows
 * 1,500,000 and a `MarenRegistry.commit` costs a fraction of that; the web
 * client alone signs 1.5x its estimate plus 60k. So the committed counter
 * reaches the cap on a fraction of the real spend, `reconcile()` then corrects
 * it downward — and before this fix `#budgetHaltedOn` was never re-read, so the
 * relayer stayed off until 00:00 UTC on money it had not spent.
 */
describe('the day-long budget halt is lifted by reconciliation', () => {
  /** FakeChain quotes 2,600,000 wei/gas, so 1,000,000 gas reserves 2.6e12. */
  const RESERVED = 2_600_000_000_000n;
  const REALLY_COST = 156_000_000_000n; // 120,000 gas at Mezo's 1,300,000 wei base fee

  it('an over-reserved request no longer halts the day once the receipt lands', async () => {
    const store = new MemoryStore();
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(
      // A budget of exactly one maximum-gas reservation.
      makeEnv({ RELAYER_MAX_DAILY_SPONSORED_BTC: '0.0000026' }),
      chain,
      store,
    );
    const day = utcDay(new Date());

    expect((await relayer.post('/relay', await signedRequest({ gas: 1_000_000n }))).status).toBe(
      202,
    );
    // The ceiling, not the cost, and it is enough to stop the relayer.
    expect(await store.get(keys.committedDay(day))).toBe(RESERVED);
    expect(relayer.service.accepting).toBe(false);

    const sent = chain.sent[0]!;
    await relayer.service.reconcile(
      pending({ hash: sent.hash, nonce: sent.nonce, reservedWei: RESERVED, reservedDay: day }),
      {
        hash: sent.hash,
        state: 'confirmed',
        success: true,
        blockNumber: 1n,
        gasUsed: 120_000n,
        effectiveGasPrice: 1_300_000n,
        gasCostWei: REALLY_COST,
        from: null,
      },
    );

    // 6% of the budget genuinely spent, so the relayer is back.
    expect(await store.get(keys.committedDay(day))).toBe(REALLY_COST);
    expect(relayer.service.accepting).toBe(true);
    const after = await relayer.post('/relay', await signedRequest({ gas: 100_000n }));
    expect(after.status).toBe(202);
  });

  it('does NOT lift a halt the reconciled number still justifies', async () => {
    // The other direction matters just as much: a halt that a correction leaves
    // standing is a relayer that really is out of money for the day.
    const store = new MemoryStore();
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_DAILY_SPONSORED_BTC: '0.0000026' }),
      chain,
      store,
    );
    const day = utcDay(new Date());

    expect((await relayer.post('/relay', await signedRequest({ gas: 1_000_000n }))).status).toBe(
      202,
    );
    expect(relayer.service.accepting).toBe(false);

    const sent = chain.sent[0]!;
    await relayer.service.reconcile(
      pending({ hash: sent.hash, nonce: sent.nonce, reservedWei: RESERVED, reservedDay: day }),
      {
        hash: sent.hash,
        state: 'confirmed',
        success: true,
        blockNumber: 1n,
        gasUsed: 1_000_000n,
        effectiveGasPrice: 2_600_000n,
        gasCostWei: RESERVED, // it really did cost the whole budget
        from: null,
      },
    );

    expect(relayer.service.accepting).toBe(false);
  });

  it('leaves a halt alone when the correction belongs to another day', async () => {
    // `reconcile` applies to the day the reservation was DEBITED. A correction
    // for a day that is not today must not touch a halt that is.
    const store = new MemoryStore();
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_DAILY_SPONSORED_BTC: '0.0000026' }),
      chain,
      store,
    );

    expect((await relayer.post('/relay', await signedRequest({ gas: 1_000_000n }))).status).toBe(
      202,
    );
    expect(relayer.service.accepting).toBe(false);

    await relayer.service.reconcile(pending({ reservedWei: RESERVED, reservedDay: '1999-12-31' }), {
      hash: pending().hash,
      state: 'confirmed',
      success: true,
      blockNumber: 1n,
      gasUsed: 1n,
      effectiveGasPrice: 1n,
      gasCostWei: 1n,
      from: null,
    });

    expect(relayer.service.accepting).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A RESERVATION THAT ONLY PARTLY LANDED
// ---------------------------------------------------------------------------

/** A store where one named key always refuses to increment. */
class OneBadKeyStore extends MemoryStore {
  constructor(readonly failingKey: string) {
    super();
  }
  override async incrBy(key: string, amount: bigint, ttl: number): Promise<bigint> {
    if (key === this.failingKey) throw new Error('the quota store said no');
    return super.incrBy(key, amount, ttl);
  }
}

/**
 * `#reserve` writes four independent counters. It used to `Promise.all` them,
 * which rejects on the first failure while the other three still land — and
 * nothing above that frame knew a reservation had been taken, so nothing gave it
 * back. Two of those counters are a user's own free tier and one is the shared
 * daily BTC budget, so a store that flaps for a minute burns both, permanently,
 * for relays that never happened. The same class of leak `#release` exists to
 * prevent, one layer up from where it was being handled.
 */
describe('a reservation that fails halfway is given back', () => {
  it('refunds the counters that landed when one of them throws', async () => {
    const day = utcDay(new Date());
    const store = new OneBadKeyStore(keys.spendDay(day));
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);

    const response = await relayer.post('/relay', await signedRequest());

    // A typed refusal, not the bare 500 an unhandled store error produced.
    expect(response.status).toBe(503);
    expect(((await response.json()) as ErrorBody).error).toBe('STORE_UNAVAILABLE');
    // Nothing broadcast, and nothing left debited.
    expect(relayer.chainFake.sent).toHaveLength(0);
    expect(await store.get(keys.lifetime(USER.address))).toBe(0n);
    expect(await store.get(keys.addressDay(USER.address, day))).toBe(0n);
  });

  it('does not refund the counter that never incremented', async () => {
    // Refunding a write that failed is how a counter goes negative, and a
    // negative counter is free money — the exact failure `#applyRefundOnce`
    // clamps for. The clamp is a backstop; not refunding is the fix.
    const day = utcDay(new Date());
    const store = new OneBadKeyStore(keys.lifetime(USER.address));
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);

    expect((await relayer.post('/relay', await signedRequest())).status).toBe(503);
    expect(await store.get(keys.lifetime(USER.address))).toBe(0n);
    expect(await store.get(keys.spendDay(day))).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// M5 — the replacement cap was untested
// ---------------------------------------------------------------------------

describe('stuck-transaction replacement cap', () => {
  it('stops bumping after maxReplacements — an unbounded loop is a budget drain', async () => {
    const submitter = vi.fn(async () => '0x0' as Hash);
    let now = 100_000;
    const watcher = new TxWatcher({
      reader: { getReceipt: async () => null },
      logger: SILENT_LOGGER,
      stuckAfterMs: 1_000,
      maxReplacements: 3,
      now: () => now,
    });

    watcher.track(pending({ submitter, submittedAt: 0, replacements: 3 }));
    await watcher.sweep();
    await watcher.sweep();

    // Already at the cap: still watched, never re-broadcast.
    expect(submitter).not.toHaveBeenCalled();
    expect(watcher.size).toBe(1);
  });

  it('does bump while under the cap, and each bump raises the fee', async () => {
    const submitter = vi.fn(
      async (ctx: { nonce: number; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }) =>
        `0x${(ctx.nonce + 1).toString(16).padStart(64, '0')}` as Hash,
    );
    let now = 100_000;
    const watcher = new TxWatcher({
      reader: { getReceipt: async () => null },
      logger: SILENT_LOGGER,
      stuckAfterMs: 1_000,
      maxReplacements: 2,
      now: () => now,
    });
    watcher.track(pending({ submitter, submittedAt: 0, replacements: 0 }));

    await watcher.sweep();
    now += 10_000;
    await watcher.sweep();
    now += 10_000;
    await watcher.sweep(); // at the cap now — must not fire again

    expect(submitter).toHaveBeenCalledTimes(2);
    const firstFee = submitter.mock.calls[0]?.[0].maxFeePerGas ?? 0n;
    const secondFee = submitter.mock.calls[1]?.[0].maxFeePerGas ?? 0n;
    expect(secondFee).toBeGreaterThan(firstFee);
  });

  /**
   * `start` fires the sweep on an interval with `void`, and one pass costs a
   * receipt read per pending transaction plus a broadcast for the stuck ones, so
   * a slow RPC makes a sweep outlast its own interval trivially. Two overlapping
   * sweeps iterate the same snapshot and both replace the same stuck
   * transaction at the same nonce: two hashes in `#pending` for one slot, only
   * one of which can ever get a receipt. The other is watched forever, its
   * `onSettled` never fires, and the reservation it carries is never reconciled
   * — which feeds straight into the halt that reconciliation is now the only
   * thing able to lift.
   */
  it('does not run two sweeps at once', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const submitter = vi.fn(async () => '0xbeef' as Hash);
    const watcher = new TxWatcher({
      reader: {
        getReceipt: async () => {
          await gate;
          return null;
        },
      },
      logger: SILENT_LOGGER,
      stuckAfterMs: 0,
      maxReplacements: 3,
      now: () => 100_000,
    });
    watcher.track(pending({ submitter, submittedAt: 0, replacements: 0 }));

    const first = watcher.sweep();
    // The second call lands while the first is blocked on the receipt read.
    await watcher.sweep();
    expect(submitter).not.toHaveBeenCalled();

    release!();
    await first;
    expect(submitter).toHaveBeenCalledTimes(1);
    expect(watcher.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// H2 — memory store must be a boot problem on a multi-instance deployment
// ---------------------------------------------------------------------------

describe('multi-instance storage requirements', () => {
  it('refuses to relay with RELAYER_STORE=memory under VERCEL', async () => {
    const relayer = await createRelayer({
      env: makeEnv({ VERCEL: '1', RELAYER_IP_SALT: 'fixed-salt' }),
      chain: new FakeChain(),
      logger: SILENT_LOGGER,
      skipPreflight: true,
    });

    expect(relayer.problems.join('\n')).toMatch(/global daily BTC budget unenforceable/);
    expect(relayer.service.accepting).toBe(false);

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

  it('refuses when RELAYER_IP_SALT is unset under VERCEL', async () => {
    const { problems } = await createRelayer({
      env: makeEnv({ VERCEL: '1', RELAYER_STORE: 'redis' }),
      chain: new FakeChain(),
      logger: SILENT_LOGGER,
      skipPreflight: true,
    });
    expect(problems.join('\n')).toMatch(/RELAYER_IP_SALT is unset/);
  });

  /**
   * The serverless target is not supported and refuses rather than running
   * degraded: `reconcile()` and `retryPendingRefunds()` are reachable only from
   * the sweep, which needs a process that outlives a request. Without them a
   * reservation permanently holds ~25x the real cost and a rejected refund is
   * lost on instance recycle while `/health` reports clean.
   */
  it('refuses under VERCEL even with redis and a fixed salt', async () => {
    const relayer = await createRelayer({
      env: makeEnv({
        VERCEL: '1',
        RELAYER_STORE: 'redis',
        RELAYER_IP_SALT: 'fixed-salt',
        UPSTASH_REDIS_REST_URL: 'https://redis.test',
        UPSTASH_REDIS_REST_TOKEN: 'token',
      }),
      chain: new FakeChain(),
      logger: SILENT_LOGGER,
      skipPreflight: true,
    });
    expect(relayer.problems.join('\n')).toMatch(/serverless \(Vercel\) target is not supported/);
    expect(relayer.service.accepting).toBe(false);

    const response = await relayer.app.fetch(
      new Request('http://relayer.test/relay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(await signedRequest()),
      }),
    );
    expect(response.status).toBe(503);
  });

  it('accepts a correctly configured standalone deployment', async () => {
    const relayer = await createRelayer({
      env: makeEnv(),
      chain: new FakeChain(),
      logger: SILENT_LOGGER,
      skipPreflight: true,
    });
    expect(relayer.problems).toEqual([]);
    expect(relayer.service.accepting).toBe(true);
  });

  it('treats redis without credentials as a problem, not a silent memory fallback', () => {
    const { problems } = loadConfig(makeEnv({ RELAYER_STORE: 'redis' }));
    expect(problems.join('\n')).toMatch(/requires UPSTASH_REDIS_REST_URL/);
  });

  it('treats an unrecognised RELAYER_STORE value as a problem', () => {
    const { problems } = loadConfig(makeEnv({ RELAYER_STORE: 'postgres' }));
    expect(problems.join('\n')).toMatch(/RELAYER_STORE must be "memory" or "redis"/);
  });
});

// ---------------------------------------------------------------------------
// H3 / H4
// ---------------------------------------------------------------------------

describe('duplicate request suppression (H3)', () => {
  it('rejects a second request from the same signer at the same nonce in flight', async () => {
    const chain = new FakeChain({ submitDelayMs: 25 });
    const relayer = await buildTestRelayer(undefined, chain);
    const body = await signedRequest();

    const [first, second] = await Promise.all([
      relayer.post('/relay', body, { 'x-test-socket-ip': '203.0.113.1' }),
      relayer.post('/relay', body, { 'x-test-socket-ip': '203.0.113.1' }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([202, 409]);

    const loser = first.status === 409 ? first : second;
    expect(((await loser.json()) as ErrorBody).error).toBe('DUPLICATE_REQUEST_IN_FLIGHT');
    // Only one transaction was ever broadcast, so we paid gas once.
    expect(chain.sent).toHaveLength(1);
  });

  it('releases the slot afterwards, so a later retry at the same nonce is allowed', async () => {
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(undefined, chain);
    const body = await signedRequest();

    expect((await relayer.post('/relay', body)).status).toBe(202);
    // Nonce still 0 on the fake forwarder, so this is a legitimate re-submit.
    expect((await relayer.post('/relay', body)).status).toBe(202);
    expect(chain.sent).toHaveLength(2);
  });
});

describe('contract-signer gas ceiling (H4)', () => {
  it('applies a tighter gas cap to contract-account signers', async () => {
    const chain = new FakeChain();
    chain.contractAccounts.add(USER.address.toLowerCase());
    const relayer = await buildTestRelayer(
      makeEnv({
        RELAYER_MAX_GAS_PER_REQUEST: '1500000',
        RELAYER_MAX_GAS_CONTRACT_SIGNER: '300000',
      }),
      chain,
    );

    const response = await relayer.post('/relay', await signedRequest({ gas: 900_000n }));
    expect(response.status).toBe(403);
    const body = (await response.json()) as ErrorBody;
    expect(body.error).toBe('GAS_LIMIT_TOO_HIGH');
    expect(body.meta['signerKind']).toBe('contract');
    expect(chain.sent).toHaveLength(0);
  });

  it('lets an EOA use the full per-request cap', async () => {
    const relayer = await buildTestRelayer(
      makeEnv({
        RELAYER_MAX_GAS_PER_REQUEST: '1500000',
        RELAYER_MAX_GAS_CONTRACT_SIGNER: '300000',
      }),
    );
    const response = await relayer.post('/relay', await signedRequest({ gas: 900_000n }));
    expect(response.status).toBe(202);
  });

  it('never lets the contract-signer cap exceed the general cap', () => {
    const { config } = loadConfig(
      makeEnv({
        RELAYER_MAX_GAS_PER_REQUEST: '200000',
        RELAYER_MAX_GAS_CONTRACT_SIGNER: '9000000',
      }),
    );
    expect(config.policy.maxGasContractSigner).toBe(200_000n);
  });
});

// ---------------------------------------------------------------------------
// paid tier while MarenRelayHub does not exist
// ---------------------------------------------------------------------------

describe('paid tier without an in-band fee', () => {
  it('closes the paid tier rather than sponsoring for free', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);
    await store.incrBy(keys.lifetime(USER.address), 25n, 0);

    // A call shape with no readable relayFee.
    const { evaluatePolicy } = await import('../src/policy.js');
    const result = evaluatePolicy(relayer.config.policy, {
      usage: {
        lifetimeActions: 25,
        addressActionsToday: 0,
        ipActionsToday: 0,
        spentTodayWei: 0n,
      },
      signedFeeMusdWei: null,
      projectedGasCostWei: 1n,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SPONSORSHIP_UNAVAILABLE');
      expect(result.error.status).toBe(402);
    }
    expect(privateKeyToAccount).toBeTruthy();
    expect(parseEther('1')).toBe(10n ** 18n);
  });
});
