import { keccak256, type Address, type Hash, type Hex } from 'viem';
import type { ChainAdapter } from './chain.js';
import type { Logger } from './logger.js';
import type { NonceManager, SubmitContext } from './nonce.js';
import { settle } from './receipt.js';
import { isRelayError, unavailable } from './errors.js';
import type { ForwardRequest } from './forwarder.js';

export interface ReservationTotals {
  lifetime: bigint;
  addressDay: bigint;
  ipDay: bigint;
  spendDay: bigint;
}

/** No secret key is stored. The raw signed transaction is sensitive relay intent:
 * keep it in private DO storage, never logs, HTTP responses, or release evidence. */
export interface RecoveryRecord {
  readonly id: string;
  readonly requestId: string;
  readonly scope: string;
  readonly dedupeKey: string;
  readonly payer: Address;
  readonly ipHash: string;
  readonly day: string;
  readonly reservedWei: bigint;
  readonly createdAt: number;
  readonly state: 'reserved' | 'prepared';
  readonly transaction?: { readonly raw: Hex; readonly hash: Hash; readonly nonce: number };
}

/** Each mutation includes its counter changes in ONE storage transaction. A
 * caller may retry after losing a storage response without applying it twice. */
export interface RecoveryJournal {
  listRecovery(): Promise<RecoveryRecord[]>;
  reserveRecovery(record: RecoveryRecord): Promise<ReservationTotals>;
  prepareRecovery(
    id: string,
    transaction: NonNullable<RecoveryRecord['transaction']>,
  ): Promise<void>;
  releaseRecovery(id: string): Promise<void>;
  settleRecovery(id: string, actualCostWei: bigint): Promise<void>;
}

export function hasRecoveryJournal(value: unknown): value is RecoveryJournal {
  return typeof (value as Partial<RecoveryJournal> | null)?.reserveRecovery === 'function';
}

/** One coordinator per signer, backed by the same DO storage as its budget.
 * Broadcast is at-least-once; exact signed bytes make repeats the same Ethereum
 * transaction. Receipt accounting is atomic/idempotent. No fee replacements:
 * unknown outcomes retain their reservation until a receipt proves the cost. */
export class RecoveryCoordinator {
  readonly #journal: RecoveryJournal;
  readonly #chain: ChainAdapter;
  readonly #logger: Logger;
  readonly scope: string;
  readonly #live = new Set<string>();
  #sweeping = false;
  #blocked = false;
  #pending = 0;
  #refunds = 0;
  #oldest: number | null = null;

  constructor(journal: RecoveryJournal, chain: ChainAdapter, forwarder: Address, logger: Logger) {
    this.#journal = journal;
    this.#chain = chain;
    this.#logger = logger;
    this.scope = `${chain.chainId}:${chain.account.toLowerCase()}:${forwarder.toLowerCase()}`;
    if (!chain.prepareExecute || !chain.broadcastRaw) {
      throw new Error('durable recovery requires local signing and raw transaction broadcast');
    }
  }

  get accepting(): boolean {
    return !this.#blocked;
  }

  get summary() {
    return {
      durable: true as const,
      blocked: this.#blocked,
      pending: this.#pending,
      pendingRefunds: this.#refunds,
      oldestPendingAt: this.#oldest === null ? null : new Date(this.#oldest).toISOString(),
      replacementPolicy: 'rebroadcast-identical' as const,
    };
  }

  async #records(): Promise<RecoveryRecord[]> {
    const records = await this.#journal.listRecovery();
    if (records.some((record) => record.scope !== this.scope)) {
      throw new Error(
        'recovery journal belongs to another signer, chain, or forwarder; restore its configuration before relaying',
      );
    }
    const pending = records.filter((record) => record.state === 'prepared');
    this.#pending = pending.length;
    this.#refunds = records.filter(
      (record) => record.state === 'reserved' && !this.#live.has(record.id),
    ).length;
    this.#oldest = pending.length ? Math.min(...pending.map((record) => record.createdAt)) : null;
    return records;
  }

  async initialize(nonces: NonceManager): Promise<void> {
    const records = await this.#records();
    // No request is active during composition. A reserved record has never been
    // externally submitted; a prepared record MAY have been, even without ACK.
    for (const record of records) {
      if (record.state === 'reserved') await this.#journal.releaseRecovery(record.id);
      else if (record.transaction) nonces.reserveThrough(record.transaction.nonce);
      else throw new Error('prepared recovery record is missing its signed transaction');
    }
    await this.#records();
  }

  async reserve(record: RecoveryRecord): Promise<ReservationTotals> {
    this.#live.add(record.id);
    try {
      return await this.#journal.reserveRecovery(record);
    } catch (error) {
      this.#live.delete(record.id);
      if (isRelayError(error)) throw error;
      throw unavailable('STORE_UNAVAILABLE', 'could not reserve durable relay quota');
    }
  }

  async release(id: string): Promise<void> {
    this.#live.delete(id);
    try {
      await this.#journal.releaseRecovery(id);
    } catch {
      // Intent and counters remain together; a sweep/restart retries the
      // transition. Never retry an anonymous decrement after a lost response.
      this.#logger.warn(
        { event: 'relay.durable_refund_deferred', id },
        'reservation retained for durable recovery',
      );
    }
  }

  async submit(
    id: string,
    request: ForwardRequest,
    ctx: SubmitContext,
    gasLimit: bigint,
  ): Promise<Hash> {
    if (this.#blocked)
      throw unavailable('STORE_UNAVAILABLE', 'transaction journal requires recovery restart');
    const raw = await this.#chain.prepareExecute!(request, ctx, gasLimit);
    const hash = keccak256(raw);
    // Failure (including an ambiguous storage response) MUST NOT trigger nonce
    // retry. releaseRecovery only refunds state=reserved, never prepared.
    try {
      await this.#journal.prepareRecovery(id, { raw, hash, nonce: ctx.nonce });
    } catch {
      // A commit may have succeeded even if its response failed. Halt new
      // nonce allocations until boot reloads the journal and restores its floor.
      this.#blocked = true;
      throw unavailable(
        'SUBMISSION_UNCERTAIN',
        'transaction journal write uncertain; check the known hash before retrying',
        { hash, statusUrl: `/status/${hash}` },
      );
    }
    this.#live.delete(id);
    this.#pending += 1;
    this.#oldest ??= Date.now();
    try {
      await this.#chain.broadcastRaw!(raw);
    } catch {
      this.#logger.warn(
        { event: 'relay.broadcast_uncertain', hash, nonce: ctx.nonce },
        'broadcast response unavailable; retaining reservation and tracking the signed hash',
      );
    }
    return hash;
  }

  async sweep(): Promise<void> {
    if (this.#sweeping) return;
    this.#sweeping = true;
    try {
      for (const record of await this.#records()) {
        if (this.#live.has(record.id)) continue;
        if (record.state === 'reserved') {
          await this.#journal.releaseRecovery(record.id);
          continue;
        }
        const transaction = record.transaction;
        if (!transaction) throw unavailable('STORE_UNAVAILABLE', 'incomplete recovery transaction');
        const receipt = await settle(this.#chain, transaction.hash);
        if (receipt.state === 'confirmed' || receipt.state === 'reverted') {
          if (receipt.gasUsed === null || receipt.effectiveGasPrice === null) continue;
          await this.#journal.settleRecovery(
            record.id,
            receipt.gasUsed * receipt.effectiveGasPrice,
          );
        } else if (receipt.state === 'submitted') {
          // Never use a newer nonce or bump fees. An old signed request might
          // already be mined; only its exact bytes are safe to resend.
          try {
            await this.#chain.broadcastRaw!(transaction.raw);
          } catch {
            this.#logger.warn(
              { event: 'relay.rebroadcast_pending', hash: transaction.hash },
              'receipt still pending; keeping durable reservation',
            );
          }
        }
      }
      await this.#records();
    } finally {
      this.#sweeping = false;
    }
  }
}
