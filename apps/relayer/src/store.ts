import { unavailable } from './errors.js';

/**
 * Counter storage for quotas and the daily spend cap.
 *
 * Two implementations:
 *   - `memory`   — a Map. Correct for `pnpm dev` and tests. On a multi-instance
 *                  deployment it is per-instance, so the effective limits are
 *                  multiplied by the instance count. Stated plainly in the README.
 *   - `redis`    — Upstash REST over plain `fetch`, no client dependency. This is
 *                  the one to use on Vercel.
 *
 * R8/R16: a store that errors must DENY, not degrade to "allow". `RedisStore`
 * throws a typed STORE_UNAVAILABLE and the relay handler turns that into a 503.
 * It never silently falls back to the in-memory counters, because that fallback
 * would reset an attacker's quota on every cold start.
 */
export interface RelayStore {
  readonly kind: 'memory' | 'redis';
  /** Atomically add `amount` and return the new value. Sets a TTL on creation. */
  incrBy(key: string, amount: bigint, ttlSeconds: number): Promise<bigint>;
  get(key: string): Promise<bigint>;
  /** Best-effort compensation when a reserved action never made it on-chain. */
  decrBy(key: string, amount: bigint): Promise<bigint>;
}

export class MemoryStore implements RelayStore {
  readonly kind = 'memory' as const;
  readonly #values = new Map<string, { value: bigint; expiresAt: number }>();

  #live(key: string): { value: bigint; expiresAt: number } | undefined {
    const entry = this.#values.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt !== 0 && entry.expiresAt <= Date.now()) {
      this.#values.delete(key);
      return undefined;
    }
    return entry;
  }

  async incrBy(key: string, amount: bigint, ttlSeconds: number): Promise<bigint> {
    const existing = this.#live(key);
    const next = (existing?.value ?? 0n) + amount;
    this.#values.set(key, {
      value: next,
      expiresAt: existing?.expiresAt ?? (ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0),
    });
    return next;
  }

  async decrBy(key: string, amount: bigint): Promise<bigint> {
    return this.incrBy(key, -amount, 0);
  }

  async get(key: string): Promise<bigint> {
    return this.#live(key)?.value ?? 0n;
  }

  /** Test helper. Not part of the interface. */
  clear(): void {
    this.#values.clear();
  }
}

interface UpstashResult {
  result?: unknown;
  error?: string;
}

/**
 * Upstash Redis over its REST API.
 *
 * Counters are 64-bit signed on the Redis side. Spend is tracked in wei, so the
 * daily BTC cap must stay below 9.22 BTC (2^63-1 wei) for the counter not to
 * overflow. At Mezo's 1,300,000 wei base fee that is roughly ten billion
 * sponsored transactions per day, so the ceiling is theoretical — but it is a
 * real ceiling and config.ts is where it would need enforcing if that changed.
 */
export class RedisStore implements RelayStore {
  readonly kind = 'redis' as const;
  readonly #url: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(url: string, token: string, fetchImpl: typeof fetch = fetch) {
    this.#url = url.replace(/\/+$/, '');
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  async #pipeline(commands: Array<Array<string | number>>): Promise<unknown[]> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#url}/pipeline`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(commands),
      });
    } catch (cause) {
      throw unavailable('STORE_UNAVAILABLE', 'quota store is unreachable', {
        reason: cause instanceof Error ? cause.name : 'unknown',
      });
    }
    if (!response.ok) {
      throw unavailable('STORE_UNAVAILABLE', 'quota store returned an error status', {
        status: response.status,
      });
    }
    const payload = (await response.json()) as UpstashResult[] | UpstashResult;
    const results = Array.isArray(payload) ? payload : [payload];
    for (const entry of results) {
      if (entry.error !== undefined) {
        throw unavailable('STORE_UNAVAILABLE', 'quota store rejected a command');
      }
    }
    return results.map((entry) => entry.result);
  }

  async incrBy(key: string, amount: bigint, ttlSeconds: number): Promise<bigint> {
    const commands: Array<Array<string | number>> = [['INCRBY', key, amount.toString()]];
    if (ttlSeconds > 0) commands.push(['EXPIRE', key, ttlSeconds, 'NX']);
    const [value] = await this.#pipeline(commands);
    return BigInt(String(value ?? '0'));
  }

  async decrBy(key: string, amount: bigint): Promise<bigint> {
    const [value] = await this.#pipeline([['DECRBY', key, amount.toString()]]);
    return BigInt(String(value ?? '0'));
  }

  async get(key: string): Promise<bigint> {
    const [value] = await this.#pipeline([['GET', key]]);
    if (value === null || value === undefined) return 0n;
    return BigInt(String(value));
  }
}

// ---------------------------------------------------------------------------
// key layout
// ---------------------------------------------------------------------------

export const DAY_SECONDS = 86_400;
/** Lifetime counters never expire; 0 means "no TTL". */
export const NO_TTL = 0;

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export const keys = {
  /** Lifetime sponsored actions for an address — drives the free-25 allowance. */
  lifetime: (address: string): string => `maren:relay:lifetime:${address.toLowerCase()}`,
  addressDay: (address: string, day: string): string =>
    `maren:relay:addr:${address.toLowerCase()}:${day}`,
  ipDay: (ipHash: string, day: string): string => `maren:relay:ip:${ipHash}:${day}`,
  spendDay: (day: string): string => `maren:relay:spend:${day}`,
} as const;
