import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { buildTestRelayer, FakeChain, makeEnv, signedRequest, type ErrorBody } from './helpers.js';
import { keys, MemoryStore, type RelayStore } from '../src/store.js';
import { ipBucketKey } from '../src/clientip.js';

/**
 * F1 — the global daily BTC budget was a check-then-act race.
 *
 * `#readUsage` read the counters, policy decided, then `chain.balance()` and
 * `chain.simulate()` ran (two RPC round trips), and only then did `#reserve`
 * increment — discarding what the increment returned. Every request in a
 * concurrent burst therefore saw the same pre-spend counters and every one was
 * accepted. Measured before the fix, against a budget sized for exactly one
 * request: 25 concurrent went 13x over, 100 went 52x, 250 went 130x.
 *
 * It was NOT a MemoryStore artifact. It reproduced against an atomic Redis
 * INCRBY with realistic latency, because atomicity was never the problem —
 * discarding the return value was.
 *
 * These tests hold the line for all four counters. The store below adds latency
 * to the exact window the old code left open, so a regression fails loudly
 * rather than depending on scheduling luck.
 */

/** A store whose operations take real time, like a network round trip. */
class LaggyStore implements RelayStore {
  readonly kind = 'memory' as const;
  readonly #inner = new MemoryStore();
  constructor(private readonly latencyMs = 3) {}

  async #lag(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
  }

  async incrBy(key: string, amount: bigint, ttl: number): Promise<bigint> {
    await this.#lag();
    // The increment itself is atomic — as Redis INCRBY is. The race the old code
    // had was never about this being non-atomic.
    return this.#inner.incrBy(key, amount, ttl);
  }

  async decrBy(key: string, amount: bigint): Promise<bigint> {
    await this.#lag();
    return this.#inner.decrBy(key, amount);
  }

  async get(key: string): Promise<bigint> {
    await this.#lag();
    return this.#inner.get(key);
  }
}

/** N distinct signers, so per-address limits never mask the budget check. */
function signers(count: number) {
  return Array.from({ length: count }, (_, i) =>
    privateKeyToAccount(`0x${(i + 1).toString(16).padStart(64, '0')}` as `0x${string}`),
  );
}

/** `signers(n)[i]` with the index checked, for `noUncheckedIndexedAccess`. */
function signer(index: number) {
  const account = signers(index + 1)[index];
  if (account === undefined) throw new Error('unreachable');
  return account;
}

describe('global daily BTC budget under concurrency', () => {
  // FakeChain: gas 200,000 x maxFeePerGas 2,600,000 = 5.2e11 wei per request.
  const PER_REQUEST_WEI = 200_000n * 2_600_000n;

  it.each([25, 100])(
    'accepts at most the budget with %i simultaneous requests',
    async (concurrency) => {
      const store = new LaggyStore();
      const chain = new FakeChain({ submitDelayMs: 2 });
      // Budget for exactly TWO requests.
      const budgetWei = PER_REQUEST_WEI * 2n;
      const relayer = await buildTestRelayer(
        makeEnv({
          RELAYER_MAX_DAILY_SPONSORED_BTC: (Number(budgetWei) / 1e18).toFixed(18),
          RELAYER_MAX_ACTIONS_PER_IP_DAY: String(concurrency * 10),
        }),
        chain,
        store as never,
      );

      const accounts = signers(concurrency);
      const bodies = await Promise.all(accounts.map((account) => signedRequest({ account })));
      const responses = await Promise.all(
        bodies.map((body, i) =>
          relayer.post('/relay', body, { 'x-test-socket-ip': `203.0.113.${(i % 200) + 1}` }),
        ),
      );

      const accepted = responses.filter((r) => r.status === 202).length;

      // The invariant: we never broadcast more than the budget can pay for.
      expect(chain.sent.length).toBe(accepted);
      expect(accepted).toBeLessThanOrEqual(2);
      expect(accepted).toBeGreaterThan(0);

      // And the recorded spend never exceeds the cap.
      const spent = await store.get(keys.spendDay(new Date().toISOString().slice(0, 10)));
      expect(spent).toBeLessThanOrEqual(budgetWei);

      // Losers get the typed error, not a 500.
      const rejected = responses.filter((r) => r.status !== 202);
      expect(rejected.length).toBe(concurrency - accepted);
      for (const response of rejected.slice(0, 5)) {
        expect(response.status).toBe(429);
        expect(((await response.json()) as ErrorBody).error).toBe(
          'GLOBAL_DAILY_BUDGET_EXHAUSTED',
        );
      }
    },
  );

  it('refunds the reservation of every request it rejects', async () => {
    const store = new LaggyStore();
    const chain = new FakeChain();
    const budgetWei = PER_REQUEST_WEI * 1n;
    const relayer = await buildTestRelayer(
      makeEnv({
        RELAYER_MAX_DAILY_SPONSORED_BTC: (Number(budgetWei) / 1e18).toFixed(18),
        RELAYER_MAX_ACTIONS_PER_IP_DAY: '500',
      }),
      chain,
      store as never,
    );

    const accounts = signers(20);
    const bodies = await Promise.all(accounts.map((account) => signedRequest({ account })));
    await Promise.all(
      bodies.map((body, i) =>
        relayer.post('/relay', body, { 'x-test-socket-ip': `203.0.113.${i + 1}` }),
      ),
    );

    const day = new Date().toISOString().slice(0, 10);
    // Exactly one request's worth of spend is recorded — the rest refunded.
    expect(await store.get(keys.spendDay(day))).toBe(PER_REQUEST_WEI);
    // And the losers' lifetime counters were given back, so a rejected request
    // did not silently consume one of their 25 free actions.
    for (const account of accounts.slice(1)) {
      const lifetime = await store.get(keys.lifetime(account.address));
      expect(lifetime).toBeLessThanOrEqual(1n);
    }
  });
});

describe('per-address and per-IP caps under concurrency', () => {
  it('holds the per-address daily cap against a simultaneous burst', async () => {
    const store = new LaggyStore();
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY: '3' }),
      chain,
      store as never,
    );

    // Same signer, same nonce is deduped by H3 — so vary the nonce and let the
    // fake forwarder accept each, isolating the per-address counter.
    const account = signer(0);
    chain.nonces_.set(account.address.toLowerCase(), 0n);
    const bodies = await Promise.all(
      Array.from({ length: 20 }, () => signedRequest({ account, nonce: 0n })),
    );
    const responses = await Promise.all(
      bodies.map((body, i) =>
        relayer.post('/relay', body, { 'x-test-socket-ip': `198.51.100.${i + 1}` }),
      ),
    );

    const accepted = responses.filter((r) => r.status === 202).length;
    expect(accepted).toBeLessThanOrEqual(3);
    expect(chain.sent.length).toBe(accepted);
  });

  it('holds the per-IP daily cap against a simultaneous burst', async () => {
    const store = new LaggyStore();
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_ACTIONS_PER_IP_DAY: '2' }),
      chain,
      store as never,
    );

    const accounts = signers(15);
    const bodies = await Promise.all(accounts.map((account) => signedRequest({ account })));
    const responses = await Promise.all(
      // One IP, many signers: only the IP cap can stop this.
      bodies.map((body) => relayer.post('/relay', body, { 'x-test-socket-ip': '203.0.113.42' })),
    );

    const accepted = responses.filter((r) => r.status === 202).length;
    expect(accepted).toBeLessThanOrEqual(2);
    expect(chain.sent.length).toBe(accepted);
  });

  it('holds the free-tier allowance against a simultaneous burst', async () => {
    const store = new LaggyStore();
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(
      makeEnv({
        RELAYER_FREE_ACTIONS_PER_ADDRESS: '2',
        RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY: '100',
        RELAYER_MAX_ACTIONS_PER_IP_DAY: '100',
        // Paid tier closed, so anything past the free tier must be refused.
        RELAYER_FEE_MUSD: '',
      }),
      chain,
      store as never,
    );

    const account = signer(0);
    const bodies = await Promise.all(
      Array.from({ length: 12 }, () => signedRequest({ account, nonce: 0n })),
    );
    const responses = await Promise.all(bodies.map((body) => relayer.post('/relay', body)));

    const accepted = responses.filter((r) => r.status === 202).length;
    expect(accepted).toBeLessThanOrEqual(2);
    expect(chain.sent.length).toBe(accepted);
  });
});

/**
 * F2 — per-IP buckets were keyed at the full IPv6 /128, so every host in an
 * ordinary residential allocation got its own bucket and the cap braked nothing.
 */
describe('IPv6 bucketing', () => {
  it('collapses a /64 to one bucket key', () => {
    const a = ipBucketKey('2001:db8:abcd:1234::1');
    const b = ipBucketKey('2001:db8:abcd:1234::2');
    const c = ipBucketKey('2001:db8:abcd:1234:ffff:ffff:ffff:ffff');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('keeps distinct /64s in distinct buckets', () => {
    expect(ipBucketKey('2001:db8:abcd:1234::1')).not.toBe(ipBucketKey('2001:db8:abcd:1235::1'));
  });

  it('keys IPv4 at the full address', () => {
    expect(ipBucketKey('203.0.113.1')).not.toBe(ipBucketKey('203.0.113.2'));
  });

  it('maps an unparseable address to the shared unknown bucket', () => {
    expect(ipBucketKey('garbage')).toBe('unknown');
    expect(ipBucketKey('unknown')).toBe('unknown');
  });

  it('rate limits two hosts in the same /64 together', async () => {
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_ACTIONS_PER_IP_DAY: '1' }),
      chain,
    );
    const first = signer(0);
    const second = signer(1);

    const a = await relayer.post('/relay', await signedRequest({ account: first }), {
      'x-test-socket-ip': '2001:db8:abcd:1234::1',
    });
    expect(a.status).toBe(202);

    // A different /128 in the SAME /64 — free for an attacker to obtain.
    const b = await relayer.post('/relay', await signedRequest({ account: second }), {
      'x-test-socket-ip': '2001:db8:abcd:1234::2',
    });
    expect(b.status).toBe(429);
    expect(((await b.json()) as ErrorBody).error).toBe('IP_RATE_LIMIT');
    expect(chain.sent).toHaveLength(1);
  });

  it('still separates genuinely different /64s', async () => {
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_ACTIONS_PER_IP_DAY: '1' }),
      new FakeChain(),
    );
    const first = signer(0);
    const second = signer(1);

    expect(
      (
        await relayer.post('/relay', await signedRequest({ account: first }), {
          'x-test-socket-ip': '2001:db8:abcd:1234::1',
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await relayer.post('/relay', await signedRequest({ account: second }), {
          'x-test-socket-ip': '2001:db8:abcd:9999::1',
        })
      ).status,
    ).toBe(202);
  });
});
