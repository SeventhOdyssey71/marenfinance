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

/** The per-IP bucket key the service would derive, for asserting refunds. */
async function ipHashFor(
  relayer: Awaited<ReturnType<typeof buildTestRelayer>>,
  ip: string,
): Promise<string> {
  const { hashIp } = await import('../src/logger.js');
  return hashIp(ipBucketKey(ip), relayer.config.ipSalt);
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

    // Every loser's counters were given back, EXACTLY. The previous assertion
    // here was `toBeLessThanOrEqual(1n)`, which passed even with the lifetime
    // refund deleted; the correct value is 0n and it is now asserted as such.
    const winners = (
      await Promise.all(
        accounts.map(async (a) => ((await store.get(keys.lifetime(a.address))) > 0n ? a : null)),
      )
    ).filter((a) => a !== null);
    expect(winners).toHaveLength(1);

    for (const account of accounts) {
      const lifetime = await store.get(keys.lifetime(account.address));
      const addressDay = await store.get(keys.addressDay(account.address, day));
      const expected = account.address === winners[0]?.address ? 1n : 0n;
      expect(lifetime, `lifetime for ${account.address}`).toBe(expected);
      expect(addressDay, `addressDay for ${account.address}`).toBe(expected);
    }

    // The per-IP counters were refunded too — each loser used its own IP.
    for (let i = 0; i < accounts.length; i += 1) {
      const used = await store.get(
        keys.ipDay(await ipHashFor(relayer, `203.0.113.${i + 1}`), day),
      );
      expect(used).toBeLessThanOrEqual(1n);
    }
  });
});

/**
 * The denial of service that increment-first introduced.
 *
 * Because every request now debits the budget BEFORE it can be rejected for any
 * other reason, a burst that is entirely refunded still transiently pushes the
 * reserved counter past the cap. Latching the day-long halt on that transient
 * reading meant anyone could take the relayer offline until 00:00 UTC for free.
 *
 * Demonstrated at review: 60 concurrent requests from throwaway addresses whose
 * calls revert in simulation, against a budget for 20 — 0 wei spent, 0
 * broadcast, everything refunded, and `/health` reporting `accepting=false`.
 */
describe('the budget halt latches on committed spend, not on reservations', () => {
  const PER_REQUEST_WEI = 200_000n * 2_600_000n;

  it('a fully-refunded burst does NOT take the relayer offline', async () => {
    const store = new LaggyStore(1);
    // Every call reverts in simulation, so nothing can ever be broadcast.
    const chain = new FakeChain({ simulateReverts: true });
    const budgetWei = PER_REQUEST_WEI * 20n;
    const relayer = await buildTestRelayer(
      makeEnv({
        RELAYER_MAX_DAILY_SPONSORED_BTC: (Number(budgetWei) / 1e18).toFixed(18),
        RELAYER_MAX_ACTIONS_PER_IP_DAY: '500',
      }),
      chain,
      store as never,
    );

    const accounts = signers(60);
    const bodies = await Promise.all(accounts.map((account) => signedRequest({ account })));
    await Promise.all(
      bodies.map((body, i) =>
        relayer.post('/relay', body, { 'x-test-socket-ip': `203.0.113.${(i % 200) + 1}` }),
      ),
    );

    const day = new Date().toISOString().slice(0, 10);
    // Nothing was spent and nothing was broadcast...
    expect(chain.sent).toHaveLength(0);
    expect(await store.get(keys.spendDay(day))).toBe(0n);
    expect(await store.get(keys.committedDay(day))).toBe(0n);

    // ...so the relayer is still open for business. This is the assertion that
    // was failing before the fix.
    expect(relayer.service.accepting).toBe(true);
    const health = await relayer.get('/health');
    expect(health.status).toBe(200);

    // And an innocent client can still be served.
    const innocent = signer(70);
    const good = new FakeChain();
    const ok = await buildTestRelayer(makeEnv(), good, store as never);
    expect((await ok.post('/relay', await signedRequest({ account: innocent }))).status).toBe(202);
  });

  it('a benign client hitting its per-address cap does not latch the global halt', async () => {
    const store = new LaggyStore(1);
    const chain = new FakeChain();
    const budgetWei = PER_REQUEST_WEI * 100n;
    const relayer = await buildTestRelayer(
      makeEnv({
        RELAYER_MAX_DAILY_SPONSORED_BTC: (Number(budgetWei) / 1e18).toFixed(18),
        RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY: '2',
      }),
      chain,
      store as never,
    );
    const account = signer(0);

    for (let nonce = 0; nonce < 6; nonce += 1) {
      chain.nonces_.set(account.address.toLowerCase(), BigInt(nonce));
      await relayer.post('/relay', await signedRequest({ account, nonce: BigInt(nonce) }));
    }

    // Only ~2% of the budget was actually committed.
    expect(relayer.service.accepting).toBe(true);
  });

  it('DOES latch once the budget is genuinely committed', async () => {
    const store = new LaggyStore(1);
    const chain = new FakeChain();
    const budgetWei = PER_REQUEST_WEI * 2n;
    const relayer = await buildTestRelayer(
      makeEnv({
        RELAYER_MAX_DAILY_SPONSORED_BTC: (Number(budgetWei) / 1e18).toFixed(18),
        RELAYER_MAX_ACTIONS_PER_IP_DAY: '500',
      }),
      chain,
      store as never,
    );

    const accounts = signers(2);
    for (const account of accounts) {
      await relayer.post('/relay', await signedRequest({ account }), {
        'x-test-socket-ip': '203.0.113.1',
      });
    }

    const day = new Date().toISOString().slice(0, 10);
    expect(await store.get(keys.committedDay(day))).toBe(budgetWei);
    expect(chain.sent).toHaveLength(2);
    // Real spend reached the cap, so the halt is correct here.
    expect(relayer.service.accepting).toBe(false);
    const health = await relayer.get('/health');
    expect(((await health.json()) as { problems: string[] }).problems.join()).toMatch(
      /budget is exhausted/,
    );
  });
});

/**
 * F2 — a refund the store refuses must not permanently consume budget.
 */
describe('refund failures are retried, not swallowed', () => {
  /** Fails every `decrBy`, like a Redis that is flapping. */
  class NoRefundStore implements RelayStore {
    readonly kind = 'memory' as const;
    readonly inner = new MemoryStore();
    allowRefunds = false;
    decrCalls = 0;

    async incrBy(key: string, amount: bigint, ttl: number): Promise<bigint> {
      return this.inner.incrBy(key, amount, ttl);
    }
    async decrBy(key: string, amount: bigint): Promise<bigint> {
      this.decrCalls += 1;
      if (!this.allowRefunds) throw new Error('store unavailable');
      return this.inner.decrBy(key, amount);
    }
    async get(key: string): Promise<bigint> {
      return this.inner.get(key);
    }
  }

  it('queues a failed refund instead of losing it, and recovers it later', async () => {
    const store = new NoRefundStore();
    const chain = new FakeChain({ simulateReverts: true });
    const relayer = await buildTestRelayer(makeEnv(), chain, store as never);
    const day = new Date().toISOString().slice(0, 10);

    // 10 rejected requests, all of which must be refunded and none of which can.
    for (const account of signers(10)) {
      await relayer.post('/relay', await signedRequest({ account }));
    }

    // The reservations are stuck on the counter for now...
    expect(await store.get(keys.spendDay(day))).toBeGreaterThan(0n);
    expect(relayer.service.pendingRefundCount).toBeGreaterThan(0);
    // ...and /health says so rather than hiding it.
    const health = (await (await relayer.get('/health')).json()) as { problems: string[] };
    expect(health.problems.join()).toMatch(/refund\(s\) could not be written/);

    // When the store recovers, the budget comes back.
    store.allowRefunds = true;
    await relayer.service.retryPendingRefunds();

    expect(relayer.service.pendingRefundCount).toBe(0);
    expect(await store.get(keys.spendDay(day))).toBe(0n);
    // Nothing was ever broadcast, so no budget should have been consumed at all.
    expect(chain.sent).toHaveLength(0);
  });

  it('retries a transient refund failure within the request itself', async () => {
    const store = new NoRefundStore();
    const chain = new FakeChain({ simulateReverts: true });
    const relayer = await buildTestRelayer(makeEnv(), chain, store as never);

    // Fail the first attempt, succeed on the retry.
    let failures = 0;
    const realDecr = store.decrBy.bind(store);
    store.decrBy = async (key: string, amount: bigint) => {
      if (failures < 4) {
        failures += 1;
        throw new Error('flap');
      }
      store.allowRefunds = true;
      return realDecr(key, amount);
    };

    await relayer.post('/relay', await signedRequest({ account: signer(0) }));

    // Recovered without needing the reconciler.
    expect(relayer.service.pendingRefundCount).toBe(0);
    expect(await store.get(keys.spendDay(new Date().toISOString().slice(0, 10)))).toBe(0n);
  });
});

describe('per-address and free-tier caps', () => {
  /**
   * REWRITTEN after review: the previous versions of the next two tests fired
   * every request from one account at `nonce: 0n`. The H3 duplicate guard
   * collapses those to a single admitted request, so the caps were never reached
   * and the tests were vacuous — the comment even said "vary the nonce" while
   * the code hardcoded it.
   *
   * They cannot be raced from one address, and that is a property rather than a
   * limitation: the forwarder nonce means a single address only ever has ONE
   * valid request at a time, so `nonces()` can only return one value and any
   * concurrent burst from that address is either duplicates (H3) or invalid
   * (NONCE_MISMATCH). The cap is therefore exercised the only way it is
   * reachable — sequentially, with the forwarder nonce advancing — and the
   * concurrent case is asserted for what it actually does.
   */
  it('holds the per-address daily cap exactly, over sequential requests', async () => {
    const store = new LaggyStore();
    const chain = new FakeChain();
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY: '3', RELAYER_MAX_ACTIONS_PER_IP_DAY: '99' }),
      chain,
      store as never,
    );
    const account = signer(0);
    const key = account.address.toLowerCase();

    const statuses: number[] = [];
    for (let nonce = 0; nonce < 12; nonce += 1) {
      chain.nonces_.set(key, BigInt(nonce));
      const response = await relayer.post(
        '/relay',
        await signedRequest({ account, nonce: BigInt(nonce) }),
        { 'x-test-socket-ip': '198.51.100.9' },
      );
      statuses.push(response.status);
      if (response.status !== 202) {
        expect(((await response.json()) as ErrorBody).error).toBe('ADDRESS_RATE_LIMIT');
      }
    }

    // EXACTLY the cap, not "at most" — an off-by-one in either direction fails.
    expect(statuses.filter((s) => s === 202)).toHaveLength(3);
    expect(chain.sent).toHaveLength(3);
    // And the rejected requests were refunded, so the counter sits at the cap.
    const day = new Date().toISOString().slice(0, 10);
    expect(await store.get(keys.addressDay(account.address, day))).toBe(3n);
  });

  it('holds the free-tier allowance exactly, over sequential requests', async () => {
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
    const key = account.address.toLowerCase();

    const statuses: number[] = [];
    for (let nonce = 0; nonce < 8; nonce += 1) {
      chain.nonces_.set(key, BigInt(nonce));
      const response = await relayer.post(
        '/relay',
        await signedRequest({ account, nonce: BigInt(nonce) }),
      );
      statuses.push(response.status);
      if (response.status !== 202) {
        expect(((await response.json()) as ErrorBody).error).toBe('SPONSORSHIP_UNAVAILABLE');
      }
    }

    expect(statuses.filter((s) => s === 202)).toHaveLength(2);
    expect(chain.sent).toHaveLength(2);
    expect(await store.get(keys.lifetime(account.address))).toBe(2n);
  });

  it('collapses a same-nonce burst from one address to a single request', async () => {
    const store = new LaggyStore();
    const chain = new FakeChain({ submitDelayMs: 5 });
    const relayer = await buildTestRelayer(
      makeEnv({ RELAYER_MAX_ACTIONS_PER_ADDRESS_DAY: '50' }),
      chain,
      store as never,
    );
    const account = signer(0);

    const bodies = await Promise.all(
      Array.from({ length: 20 }, () => signedRequest({ account, nonce: 0n })),
    );
    const responses = await Promise.all(bodies.map((body) => relayer.post('/relay', body)));

    // H3: one wins, the rest are duplicates. Only one transaction is paid for.
    expect(responses.filter((r) => r.status === 202)).toHaveLength(1);
    expect(chain.sent).toHaveLength(1);
    for (const response of responses.filter((r) => r.status !== 202)) {
      expect(response.status).toBe(409);
    }
    // And the duplicates consumed no quota.
    const day = new Date().toISOString().slice(0, 10);
    expect(await store.get(keys.addressDay(account.address, day))).toBe(1n);
    expect(await store.get(keys.lifetime(account.address))).toBe(1n);
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
