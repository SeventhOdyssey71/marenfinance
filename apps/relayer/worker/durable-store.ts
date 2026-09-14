import type { DurableObjectStorage, DurableObjectTransaction } from '@cloudflare/workers-types';
import { DAY_SECONDS, keys, type RelayStore } from '../src/store.js';
import { conflict } from '../src/errors.js';
import type { RecoveryJournal, RecoveryRecord, ReservationTotals } from '../src/recovery.js';

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

export class DurableStore implements RelayStore, RecoveryJournal {
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
      const expiresAt =
        existing?.expiresAt ?? (ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0);
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

  async listRecovery(): Promise<RecoveryRecord[]> {
    return [
      ...(await this.#storage.list<RecoveryRecord>({ prefix: 'maren:recovery:active:' })).values(),
    ];
  }

  async reserveRecovery(record: RecoveryRecord): Promise<ReservationTotals> {
    return this.#storage.transaction(async (txn) => {
      const duplicate = await txn.get<string>(record.dedupeKey);
      if (duplicate !== undefined) {
        throw conflict(
          'DUPLICATE_REQUEST_IN_FLIGHT',
          'this signed nonce already has a durable relay record',
        );
      }
      const lifetime = await adjust(txn, keys.lifetime(record.payer), 1n, 0);
      const addressDay = await adjust(
        txn,
        keys.addressDay(record.payer, record.day),
        1n,
        DAY_SECONDS,
      );
      const ipDay = await adjust(txn, keys.ipDay(record.ipHash, record.day), 1n, DAY_SECONDS);
      // Spend history must outlive a pending transaction, however long it takes.
      const spendDay = await adjust(txn, keys.spendDay(record.day), record.reservedWei, 0);
      await txn.put(activeKey(record.id), record);
      await txn.put(record.dedupeKey, record.id);
      return { lifetime, addressDay, ipDay, spendDay };
    });
  }

  async prepareRecovery(
    id: string,
    transaction: NonNullable<RecoveryRecord['transaction']>,
  ): Promise<void> {
    await this.#storage.transaction(async (txn) => {
      const record = await txn.get<RecoveryRecord>(activeKey(id));
      if (!record) throw new Error('missing durable reservation');
      if (record.state === 'prepared') {
        if (record.transaction?.hash !== transaction.hash)
          throw new Error('cannot replace a prepared recovery transaction');
        return;
      }
      await adjust(txn, keys.committedDay(record.day), record.reservedWei, 0);
      await txn.put(activeKey(id), {
        ...record,
        state: 'prepared',
        transaction,
      } satisfies RecoveryRecord);
    });
  }

  async releaseRecovery(id: string): Promise<void> {
    await this.#storage.transaction(async (txn) => {
      const record = await txn.get<RecoveryRecord>(activeKey(id));
      // A prepared tx might already be mined despite a timeout. Never refund it.
      if (!record || record.state !== 'reserved') return;
      await adjust(txn, keys.lifetime(record.payer), -1n);
      await adjust(txn, keys.addressDay(record.payer, record.day), -1n);
      await adjust(txn, keys.ipDay(record.ipHash, record.day), -1n);
      await adjust(txn, keys.spendDay(record.day), -record.reservedWei);
      await txn.delete(activeKey(id));
      await txn.delete(record.dedupeKey);
    });
  }

  async settleRecovery(id: string, actualCostWei: bigint): Promise<void> {
    if (actualCostWei < 0n) throw new Error('negative settlement cost');
    await this.#storage.transaction(async (txn) => {
      const record = await txn.get<RecoveryRecord>(activeKey(id));
      if (!record) return; // Already reconciled, including a lost commit response.
      if (record.state !== 'prepared') throw new Error('cannot settle an unsigned reservation');
      const delta = actualCostWei - record.reservedWei;
      await adjust(txn, keys.spendDay(record.day), delta, 0);
      await adjust(txn, keys.committedDay(record.day), delta, 0);
      await txn.delete(activeKey(id));
      // The forwarder validates consumed user nonces. Release this guard so a
      // reverted call (whose user nonce may be unchanged) can be corrected and
      // retried; accounting idempotency is keyed by the unique intent ID.
      await txn.delete(record.dedupeKey);
    });
  }
}

const activeKey = (id: string): string => `maren:recovery:active:${id}`;

async function adjust(
  txn: DurableObjectTransaction,
  key: string,
  delta: bigint,
  ttl?: number,
): Promise<bigint> {
  const entry = fresh(await txn.get<Entry>(key));
  // A late refund must not resurrect an expired daily quota as a negative key.
  if (!entry && ttl === undefined) return 0n;
  const next = (entry?.value ?? 0n) + delta;
  const value = next < 0n ? 0n : next;
  const expiresAt = ttl === 0 ? 0 : (entry?.expiresAt ?? (ttl ? Date.now() + ttl * 1000 : 0));
  await txn.put(key, { value, expiresAt } satisfies Entry);
  return value;
}
