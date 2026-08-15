import type { Address, Hash } from 'viem';
import type { Logger } from './logger.js';
import { settle, type ReceiptReader, type Settlement } from './receipt.js';

/**
 * Nonce serialisation and stuck-transaction replacement for one hot key.
 *
 * Two concurrent `POST /relay` calls that both read `getTransactionCount` see
 * the same number, sign two transactions with the same nonce, and one of them is
 * dropped — silently, after the user was told it was submitted. The fix is not
 * "retry on collision", it is to never allocate the same nonce twice: every
 * allocation AND its broadcast happen inside one serialised critical section per
 * key.
 *
 * The queue is a promise chain rather than a lock library so there is nothing to
 * leak: a rejected job still advances the chain (see `#enqueue`).
 */

export interface GasFees {
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

export interface SubmitContext extends GasFees {
  readonly nonce: number;
}

export type Submitter = (ctx: SubmitContext) => Promise<Hash>;

export interface PendingTx {
  readonly nonce: number;
  hash: Hash;
  fees: GasFees;
  readonly submitter: Submitter;
  readonly submittedAt: number;
  replacements: number;
  readonly requestId: string;
  /** BTC (wei) provisionally debited from the daily budget when we submitted. */
  readonly reservedWei: bigint;
  readonly payer: Address;
}

export interface NonceManagerOptions {
  readonly address: Address;
  readonly getTransactionCount: (address: Address) => Promise<number>;
  readonly logger: Logger;
}

export class NonceManager {
  readonly #options: NonceManagerOptions;
  #queue: Promise<unknown> = Promise.resolve();
  #next: number | null = null;
  #inFlight = 0;

  constructor(options: NonceManagerOptions) {
    this.#options = options;
  }

  get inFlight(): number {
    return this.#inFlight;
  }

  /** Last nonce we believe we have used, or null before the first sync. */
  get nextNonce(): number | null {
    return this.#next;
  }

  /** Force a resync from the chain on the next allocation. */
  invalidate(): void {
    this.#next = null;
  }

  #enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(job, job);
    // Swallow rejections on the CHAIN only — the caller still receives them via
    // `run`. Without this a single failure would poison every later job.
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Allocate the next nonce and broadcast inside the critical section.
   *
   * On any error the cached nonce is invalidated rather than decremented: if the
   * transaction was in fact broadcast before the error surfaced, reusing its
   * nonce would replace a transaction we already told a user about. A resync
   * from the chain is the only safe recovery.
   */
  async submit(
    fees: GasFees,
    submitter: Submitter,
    meta: { requestId: string; reservedWei: bigint; payer: Address },
  ): Promise<PendingTx> {
    return this.#enqueue(async () => {
      this.#inFlight += 1;
      try {
        if (this.#next === null) {
          this.#next = await this.#options.getTransactionCount(this.#options.address);
        }
        const nonce = this.#next;
        let hash: Hash;
        try {
          hash = await submitter({ nonce, ...fees });
        } catch (error) {
          this.invalidate();
          throw error;
        }
        this.#next = nonce + 1;
        return {
          nonce,
          hash,
          fees,
          submitter,
          submittedAt: Date.now(),
          replacements: 0,
          requestId: meta.requestId,
          reservedWei: meta.reservedWei,
          payer: meta.payer,
        } satisfies PendingTx;
      } finally {
        this.#inFlight -= 1;
      }
    });
  }
}

// ---------------------------------------------------------------------------
// stuck transaction replacement
// ---------------------------------------------------------------------------

/** Geth requires a >=10% bump to replace. 12.5% + 1 wei clears it with margin. */
export function bumpFees(fees: GasFees): GasFees {
  const bump = (value: bigint): bigint => (value * 1125n) / 1000n + 1n;
  return {
    maxFeePerGas: bump(fees.maxFeePerGas),
    maxPriorityFeePerGas: bump(fees.maxPriorityFeePerGas),
  };
}

export interface TxWatcherOptions {
  readonly reader: ReceiptReader;
  readonly logger: Logger;
  /** Age at which a transaction with no receipt is considered stuck. */
  readonly stuckAfterMs: number;
  /** Give up replacing after this many attempts and just keep watching. */
  readonly maxReplacements: number;
  readonly now?: () => number;
  /**
   * Called once per transaction when a receipt finally exists. Used to reconcile
   * the provisional gas reservation against what the transaction actually cost.
   */
  readonly onSettled?: (tx: PendingTx, settlement: Settlement) => void | Promise<void>;
}

/**
 * Watches broadcast transactions and replaces the ones that stall.
 *
 * "Stuck" here means: broadcast, older than `stuckAfterMs`, and the node still
 * has no receipt. The replacement reuses the SAME nonce with bumped fees, which
 * is the only way to clear a stuck nonce — everything behind it in the queue is
 * blocked until it lands.
 *
 * This runs only in the standalone server. On Vercel Functions there is no
 * process to run it in; see the README for the operational consequence.
 */
export class TxWatcher {
  readonly #options: TxWatcherOptions;
  readonly #pending = new Map<Hash, PendingTx>();
  #timer: NodeJS.Timeout | null = null;
  #onSettled: TxWatcherOptions['onSettled'];

  constructor(options: TxWatcherOptions) {
    this.#options = options;
    this.#onSettled = options.onSettled;
  }

  /**
   * The settlement callback is set after construction because the service that
   * consumes it also owns this watcher. One of the two has to be wired second.
   */
  setOnSettled(handler: NonNullable<TxWatcherOptions['onSettled']>): void {
    this.#onSettled = handler;
  }

  get size(): number {
    return this.#pending.size;
  }

  track(tx: PendingTx): void {
    this.#pending.set(tx.hash, tx);
  }

  forget(hash: Hash): void {
    this.#pending.delete(hash);
  }

  start(intervalMs: number): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => {
      void this.sweep();
    }, intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** One pass. Exposed so tests can drive it deterministically. */
  async sweep(): Promise<void> {
    const now = this.#options.now?.() ?? Date.now();
    for (const tx of [...this.#pending.values()]) {
      const settlement = await settle(this.#options.reader, tx.hash);
      if (settlement.state === 'confirmed' || settlement.state === 'reverted') {
        this.#pending.delete(tx.hash);
        await this.#onSettled?.(tx, settlement);
        continue;
      }
      if (settlement.state === 'unknown') continue;
      if (now - tx.submittedAt < this.#options.stuckAfterMs) continue;
      if (tx.replacements >= this.#options.maxReplacements) continue;

      const fees = bumpFees(tx.fees);
      try {
        const hash = await tx.submitter({ nonce: tx.nonce, ...fees });
        this.#pending.delete(tx.hash);
        this.#pending.set(hash, {
          ...tx,
          hash,
          fees,
          replacements: tx.replacements + 1,
        });
        this.#options.logger.warn(
          {
            event: 'tx.replaced',
            requestId: tx.requestId,
            nonce: tx.nonce,
            previousHash: tx.hash,
            hash,
            maxFeePerGas: fees.maxFeePerGas,
            attempt: tx.replacements + 1,
          },
          'replaced a stuck transaction with a bumped fee',
        );
      } catch (error) {
        this.#options.logger.error(
          { event: 'tx.replace_failed', requestId: tx.requestId, nonce: tx.nonce, err: error },
          'could not replace a stuck transaction',
        );
      }
    }
  }
}
