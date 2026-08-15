import { describe, expect, it, vi } from 'vitest';
import { isRelayError } from '../src/errors.js';
import { keys, MemoryStore, RedisStore } from '../src/store.js';
import { buildTestRelayer, FakeChain, makeEnv, signedRequest, type ErrorBody } from './helpers.js';

/**
 * M4 — `RedisStore` is the RECOMMENDED production configuration and had no tests.
 *
 * store.ts claims "a store that errors must DENY, not degrade to allow". That
 * claim is the only thing standing between a Redis outage and an open budget
 * gate, so it is tested here rather than asserted in a comment (R13).
 */

function upstash(handler: (commands: unknown[][]) => unknown) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const commands = JSON.parse(String(init?.body)) as unknown[][];
    const result = handler(commands);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('RedisStore', () => {
  it('increments and returns the new value', async () => {
    const fetchImpl = upstash(() => [{ result: 7 }, { result: 1 }]);
    const store = new RedisStore('https://redis.test/', 'token', fetchImpl);
    expect(await store.incrBy('k', 5n, 86_400)).toBe(7n);
  });

  it('sends INCRBY with a TTL that does not extend an existing key', async () => {
    let seen: unknown[][] = [];
    const fetchImpl = upstash((commands) => {
      seen = commands;
      return [{ result: 1 }, { result: 1 }];
    });
    const store = new RedisStore('https://redis.test', 'token', fetchImpl);
    await store.incrBy('maren:relay:spend:2026-08-15', 12n, 86_400);

    expect(seen[0]).toEqual(['INCRBY', 'maren:relay:spend:2026-08-15', '12']);
    // NX so a long-lived counter's expiry is not pushed forward on every write.
    expect(seen[1]).toEqual(['EXPIRE', 'maren:relay:spend:2026-08-15', 86_400, 'NX']);
  });

  it('omits EXPIRE for lifetime counters', async () => {
    let seen: unknown[][] = [];
    const fetchImpl = upstash((commands) => {
      seen = commands;
      return [{ result: 1 }];
    });
    const store = new RedisStore('https://redis.test', 'token', fetchImpl);
    await store.incrBy(keys.lifetime('0xabc'), 1n, 0);
    expect(seen).toHaveLength(1);
  });

  it('reads a missing key as zero', async () => {
    const store = new RedisStore('https://redis.test', 'token', upstash(() => [{ result: null }]));
    expect(await store.get('nope')).toBe(0n);
  });

  it('sends the bearer token', async () => {
    let auth: string | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>)['authorization'];
      return new Response(JSON.stringify([{ result: 1 }]), { status: 200 });
    }) as unknown as typeof fetch;
    await new RedisStore('https://redis.test', 'sekret', fetchImpl).get('k');
    expect(auth).toBe('Bearer sekret');
  });

  describe('a store that errors must DENY, not degrade to allow', () => {
    it('throws STORE_UNAVAILABLE on a non-OK HTTP status — it does NOT return zero', async () => {
      const store = new RedisStore(
        'https://redis.test',
        'token',
        upstash(() => new Response('nope', { status: 500 })),
      );
      // Returning 0n here would read as "no quota used" and open the gate.
      await expect(store.get(keys.spendDay('2026-08-15'))).rejects.toSatisfy(
        (e: unknown) => isRelayError(e) && e.code === 'STORE_UNAVAILABLE',
      );
      await expect(store.incrBy('k', 1n, 60)).rejects.toSatisfy(
        (e: unknown) => isRelayError(e) && e.code === 'STORE_UNAVAILABLE',
      );
    });

    it('throws STORE_UNAVAILABLE when the network is unreachable', async () => {
      const fetchImpl = (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch;
      const store = new RedisStore('https://redis.test', 'token', fetchImpl);
      await expect(store.get('k')).rejects.toSatisfy(
        (e: unknown) => isRelayError(e) && e.code === 'STORE_UNAVAILABLE',
      );
    });

    it('throws STORE_UNAVAILABLE when Redis rejects a command', async () => {
      const store = new RedisStore(
        'https://redis.test',
        'token',
        upstash(() => [{ error: 'ERR value is not an integer or out of range' }]),
      );
      await expect(store.get('k')).rejects.toSatisfy(
        (e: unknown) => isRelayError(e) && e.code === 'STORE_UNAVAILABLE',
      );
    });

    it('a failing store makes POST /relay refuse rather than sponsor unmetered', async () => {
      const failing = new RedisStore(
        'https://redis.test',
        'token',
        upstash(() => new Response('down', { status: 503 })),
      );
      const relayer = await buildTestRelayer(makeEnv(), new FakeChain(), failing as never);

      const response = await relayer.post('/relay', await signedRequest(), {
        'x-test-socket-ip': '203.0.113.9',
      });

      expect(response.status).toBe(503);
      expect(((await response.json()) as ErrorBody).error).toBe('STORE_UNAVAILABLE');
      // The decisive assertion: an unmeterable request is an unsent request.
      expect(relayer.chainFake.sent).toHaveLength(0);
    });
  });
});

describe('MemoryStore', () => {
  it('expires day-scoped keys and keeps lifetime keys', async () => {
    const store = new MemoryStore();
    await store.incrBy('day', 1n, 1);
    await store.incrBy('life', 1n, 0);
    expect(await store.get('day')).toBe(1n);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2_000);
    expect(await store.get('day')).toBe(0n);
    expect(await store.get('life')).toBe(1n);
    vi.useRealTimers();
  });

  it('does not extend the TTL of an existing key on later increments', async () => {
    const store = new MemoryStore();
    await store.incrBy('k', 1n, 10);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5_000);
    await store.incrBy('k', 1n, 10);
    vi.setSystemTime(Date.now() + 6_000);
    expect(await store.get('k')).toBe(0n);
    vi.useRealTimers();
  });
});
