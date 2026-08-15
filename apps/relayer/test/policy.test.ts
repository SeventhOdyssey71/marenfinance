import { describe, expect, it } from 'vitest';
import { encodeFunctionData, getAddress, parseEther } from 'viem';
import {
  buildTestRelayer,
  FakeChain,
  makeEnv,
  signedRequest,
  USER,
  type ErrorBody,
} from './helpers.js';
import { MemoryStore, keys } from '../src/store.js';
import { RELAYABLE_FUNCTIONS } from '../src/registry.js';
import { evaluatePolicy, POLICY_DEFAULTS, type SponsorshipPolicy } from '../src/policy.js';

/**
 * R16 — explicit typed failures over silent fallbacks.
 *
 * "If sponsorship quota is exhausted, return a typed 402/429 error naming the
 * limit. Never silently spend our money." Every assertion below checks two
 * things: the right typed code came back, AND nothing was broadcast.
 */

const PAY = RELAYABLE_FUNCTIONS.marenPay.find((f) => f.abi.name === 'pay')!;

function payWithFee(relayFee: bigint) {
  return encodeFunctionData({
    abi: [PAY.abi],
    args: [
      getAddress('0x5555555555555555555555555555555555555555'),
      parseEther('10'),
      'lunch',
      relayFee,
    ],
  });
}

async function seed(store: MemoryStore, key: string, amount: bigint) {
  await store.incrBy(key, amount, 0);
}

describe('sponsorship policy', () => {
  it('sponsors the first 25 actions for free', async () => {
    const relayer = await buildTestRelayer();
    const quota = (await (await relayer.get(`/quota/${USER.address}`)).json()) as {
      freeActionsRemaining: number;
      freeActionsPerAddress: number;
    };
    expect(quota.freeActionsPerAddress).toBe(25);
    expect(quota.freeActionsRemaining).toBe(25);

    const response = await relayer.post('/relay', await signedRequest());
    expect(response.status).toBe(202);
    const body = (await response.json()) as { sponsorship: string; freeActionsRemaining: number };
    expect(body.sponsorship).toBe('free-tier');
    expect(body.freeActionsRemaining).toBe(24);
  });

  it('returns a typed 402 naming the limit once the free tier is spent', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);
    await seed(store, keys.lifetime(USER.address), 25n);

    const response = await relayer.post('/relay', await signedRequest());

    expect(response.status).toBe(402);
    const body = (await response.json()) as ErrorBody;
    expect(body.error).toBe('SPONSORSHIP_FEE_REQUIRED');
    expect(body.detail).toMatch(/25 free sponsored actions/);
    expect(body.meta['requiredFeeWei']).toBe(parseEther('0.05').toString());
    // The point of the typed error: we did not quietly pay for it anyway.
    expect(relayer.chainFake.sent).toHaveLength(0);
  });

  it('accepts a post-free-tier request that carries the fee inside the signed calldata', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);
    await seed(store, keys.lifetime(USER.address), 25n);

    const response = await relayer.post(
      '/relay',
      await signedRequest({ data: payWithFee(parseEther('0.05')) }),
    );

    expect(response.status).toBe(202);
    expect(((await response.json()) as { sponsorship: string }).sponsorship).toBe('fee-paid');
  });

  it('rejects a fee below the required amount', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), store);
    await seed(store, keys.lifetime(USER.address), 25n);

    const response = await relayer.post(
      '/relay',
      await signedRequest({ data: payWithFee(parseEther('0.0001')) }),
    );

    expect(response.status).toBe(402);
    expect(((await response.json()) as ErrorBody).error).toBe('FEE_BELOW_REQUIRED');
    expect(relayer.chainFake.sent).toHaveLength(0);
  });

  it('closes the paid tier entirely when no fee is configured', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_FEE_MUSD: '' }),
      new FakeChain(),
      store,
    );
    await seed(store, keys.lifetime(USER.address), 25n);

    const response = await relayer.post(
      '/relay',
      await signedRequest({ data: payWithFee(parseEther('1')) }),
    );
    expect(response.status).toBe(402);
    expect(((await response.json()) as ErrorBody).error).toBe('SPONSORSHIP_UNAVAILABLE');
  });

  it('rate limits per address with a typed 429', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY: '2' }),
      new FakeChain(),
      store,
    );
    const day = new Date().toISOString().slice(0, 10);
    await seed(store, keys.addressDay(USER.address, day), 2n);

    const response = await relayer.post('/relay', await signedRequest());
    expect(response.status).toBe(429);
    const body = (await response.json()) as ErrorBody;
    expect(body.error).toBe('ADDRESS_RATE_LIMIT');
    expect(body.meta['limit']).toBe(2);
  });

  it('rate limits per IP with a typed 429', async () => {
    const relayer = await buildTestRelayer(makeEnv({ RELAYER_MAX_ACTIONS_PER_IP_DAY: '1' }));
    const first = await relayer.post('/relay', await signedRequest(), {
      'x-forwarded-for': '203.0.113.7',
    });
    expect(first.status).toBe(202);

    // Second request, same IP, different address — the IP bucket is what stops it.
    relayer.chainFake.nonces_.set(USER.address.toLowerCase(), 1n);
    const second = await relayer.post('/relay', await signedRequest({ nonce: 1n }), {
      'x-forwarded-for': '203.0.113.7',
    });
    expect(second.status).toBe(429);
    expect(((await second.json()) as ErrorBody).error).toBe('IP_RATE_LIMIT');
  });

  it('rejects a request that would exceed the global daily BTC budget', async () => {
    const store = new MemoryStore();
    // A budget so small that one 200,000-gas request at 2,600,000 wei/gas blows it.
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_DAILY_SPONSORED_BTC: '0.0000000001' }),
      new FakeChain(),
      store,
    );

    const response = await relayer.post('/relay', await signedRequest());
    expect(response.status).toBe(429);
    const body = (await response.json()) as ErrorBody;
    expect(body.error).toBe('GLOBAL_DAILY_BUDGET_EXHAUSTED');
    expect(body.meta['limitWei']).toBeDefined();
    expect(relayer.chainFake.sent).toHaveLength(0);
  });

  /**
   * REWRITTEN after review. This test used to assert that the rejection above
   * ALSO latched the day-long halt — it was encoding the denial of service.
   *
   * Because the reservation now increments before a request can be rejected,
   * any rejected request transiently pushes the reserved counter past the cap.
   * Latching on that let anyone take the relayer offline until 00:00 UTC by
   * sending doomed requests. The halt must come from spend that actually
   * happened, so a rejected-and-refunded request must leave us accepting.
   */
  it('does NOT halt when the over-budget request was refunded', async () => {
    const store = new MemoryStore();
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_DAILY_SPONSORED_BTC: '0.0000000001' }),
      new FakeChain(),
      store,
    );

    await relayer.post('/relay', await signedRequest());

    // Nothing was broadcast and nothing was committed, so nothing is spent.
    expect(relayer.chainFake.sent).toHaveLength(0);
    expect(await store.get(keys.committedDay(new Date().toISOString().slice(0, 10)))).toBe(0n);
    // Therefore the relayer is still open.
    expect(relayer.service.accepting).toBe(true);
    expect((await relayer.get('/health')).status).toBe(200);
  });

  it('the quota endpoint reflects consumed actions', async () => {
    const relayer = await buildTestRelayer();
    await relayer.post('/relay', await signedRequest());

    const quota = (await (await relayer.get(`/quota/${USER.address}`)).json()) as {
      lifetimeActions: number;
      freeActionsRemaining: number;
      actionsToday: number;
    };
    expect(quota.lifetimeActions).toBe(1);
    expect(quota.freeActionsRemaining).toBe(24);
    expect(quota.actionsToday).toBe(1);
  });

  it('rejects a malformed address on the quota endpoint', async () => {
    const relayer = await buildTestRelayer();
    const response = await relayer.get('/quota/not-an-address');
    expect(response.status).toBe(400);
  });
});

describe('policy unit behaviour', () => {
  const base: SponsorshipPolicy = {
    ...POLICY_DEFAULTS,
    feeMusdWei: parseEther('0.05'),
    maxDailySpendWei: parseEther('0.01'),
  };
  const usage = {
    lifetimeActions: 0,
    addressActionsToday: 0,
    ipActionsToday: 0,
    spentTodayWei: 0n,
  };

  it('denies everything when the daily budget is zero', () => {
    const result = evaluatePolicy(
      { ...base, maxDailySpendWei: 0n },
      { usage, signedFeeMusdWei: 0n, projectedGasCostWei: 1n },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('GLOBAL_DAILY_BUDGET_EXHAUSTED');
  });

  it('checks the global budget before anything user-specific', () => {
    // Both the budget and the address limit are blown; the budget wins, because
    // when the budget is gone the answer is the same for everybody.
    const result = evaluatePolicy(base, {
      usage: { ...usage, spentTodayWei: parseEther('1'), addressActionsToday: 9_999 },
      signedFeeMusdWei: 0n,
      projectedGasCostWei: 1n,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('GLOBAL_DAILY_BUDGET_EXHAUSTED');
  });

  it('counts the last free action as free and the next one as paid', () => {
    const last = evaluatePolicy(base, {
      usage: { ...usage, lifetimeActions: 24 },
      signedFeeMusdWei: 0n,
      projectedGasCostWei: 1n,
    });
    expect(last.ok).toBe(true);
    if (last.ok) {
      expect(last.decision.mode).toBe('free-tier');
      expect(last.decision.freeActionsRemaining).toBe(0);
    }

    const next = evaluatePolicy(base, {
      usage: { ...usage, lifetimeActions: 25 },
      signedFeeMusdWei: 0n,
      projectedGasCostWei: 1n,
    });
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.error.status).toBe(402);
  });
});
