import type { RelayStore } from '../src/store.js';

// A RelayStore backed by Durable Object storage.
//
// This is the whole reason the relayer belongs in a Durable Object rather than a
// plain Worker: the quota and daily-spend counters need a single authoritative,
// durable home. DO storage is exactly that — one instance, transactional, and it
// survives hibernation, so an attacker cannot reset their free-action allowance
// or the daily BTC cap by forcing a cold start (which the in-memory store would
// allow). Semantics mirror MemoryStore: a TTL is fixed when a key is first
// created and checked on read; expired keys read as zero.

interface Entry {
  readonly value: bigint;
  /** Epoch ms; 0 means no expiry. */
  readonly expiresAt: number;
}

function fresh(entry: Entry | undefined): Entry | undefined {
  if (entry === undefined) return undefined;
  if (entry.expiresAt !== 0 && entry.expiresAt <= Date.now()) return undefined;
  return entry;
}

export class DurableStore implements RelayStore {
  readonly kind = 'durable' as const;
  readonly #storage: DurableObjectStorage;

  constructor(storage: DurableObjectStorage) {
    this.#storage = storage;
  }

  // Atomic read-modify-write. A single DO can still interleave two requests at
  // await points, so the increment runs inside a storage transaction rather than
  // a bare get-then-put — otherwise two concurrent relays could both read the
  // same counter and one increment would be lost, quietly widening the budget.
  async incrBy(key: string, amount: bigint, ttlSeconds: number): Promise<bigint> {
    return this.#storage.transaction(async (txn) => {
      const existing = fresh(await txn.get<Entry>(key));
      const next = (existing?.value ?? 0n) + amount;
      const expiresAt = existing?.expiresAt ?? (ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0);
      await txn.put(key, { value: next, expiresAt } satisfies Entry);
      return next;
    });
  }

  async decrBy(key: string, amount: bigint): Promise<bigint> {
    return this.incrBy(key, -amount, 0);
  }

  async get(key: string): Promise<bigint> {
    return fresh(await this.#storage.get<Entry>(key))?.value ?? 0n;
  }
}
