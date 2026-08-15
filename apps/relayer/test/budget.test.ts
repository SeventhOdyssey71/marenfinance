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
import { keys, MemoryStore } from '../src/store.js';
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
