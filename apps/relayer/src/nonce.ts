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
 *
 * SINGLE-INSTANCE ASSUMPTION. This is in-process, so it serialises submissions
 * only within one running relayer. It is correct because this service is
 * deployed as exactly ONE process holding exactly ONE key: `docker-compose.yml`
 * pins `replicas: 1`, `fly.toml` pins one machine with no autoscaling, and the
 * serverless target is refused outright in `create.ts`. Run two copies of this
 * process against one key and both allocate from their own cached counter; the
 * second transaction at a given nonce is dropped by the node. `/healthz` reports
 * `singleInstance: true` so this assumption is visible at runtime rather than
 * only in a comment. A shared nonce lease is the fix if this ever needs to scale
 * horizontally, and it is deliberately not built here.
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
  /** The UTC day the reservation was debited against. Reconciliation must use
   *  this, not "today" — a tx submitted at 23:59 can settle after midnight. */
  readonly reservedDay: string;
  readonly payer: Address;
}

export interface NonceManagerOptions {
  readonly address: Address;
  readonly getTransactionCount: (address: Address) => Promise<number>;
  readonly logger: Logger;
}

/** What a submission looked like, for `/healthz`. Never carries a signature. */
export interface LastSubmission {
  readonly nonce: number;
  readonly hash: Hash;
  /** Epoch milliseconds. */
  readonly at: number;
  readonly requestId: string;
}

/**
 * Errors that mean "the nonce you used is not the nonce the node wants".
 *
 * Matched on the message because there is no portable code for it: geth,
 * erigon, reth and Mezo's own gateway all phrase it differently, and viem wraps
 * whatever the node said into `shortMessage`. A miss here is not a correctness
 * problem: it costs one lazy resync on the next allocation instead of an
 * immediate retry.
 */
const NONCE_MISMATCH =
  /nonce (?:too low|too high|has already been used)|invalid (?:transaction )?nonce/i;

function looksLikeNonceMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return NONCE_MISMATCH.test(message);
}

export class NonceManager {
  readonly #options: NonceManagerOptions;
  #queue: Promise<unknown> = Promise.resolve();
  #next: number | null = null;
  #inFlight = 0;
  #queued = 0;
  #resyncs = 0;
  #lastSubmission: LastSubmission | null = null;

  constructor(options: NonceManagerOptions) {
    this.#options = options;
  }

  get inFlight(): number {
    return this.#inFlight;
  }

  /**
   * Submissions accepted and not yet finished, including the one running.
   * Because submission is serialised, anything above 1 is queue depth: the
   * number of users waiting behind one slow broadcast.
   */
  get queued(): number {
    return this.#queued;
  }

  /** How many times a failed broadcast forced a nonce refetch. */
  get resyncs(): number {
    return this.#resyncs;
  }

  get lastSubmission(): LastSubmission | null {
    return this.#lastSubmission;
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
    this.#queued += 1;
    const run = this.#queue.then(job, job).finally(() => {
      this.#queued -= 1;
    });
    // Swallow rejections on the CHAIN only — the caller still receives them via
    // `run`. Without this a single failure would poison every later job.
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Read the PENDING nonce from the chain, for stuck-nonce recovery.
   *
   * Called from inside the critical section, so no other submission can
   * interleave with the read. `pending` (see `chain.ts`) counts transactions
   * sitting in the mempool, so a nonce this process already broadcast is not
   * handed out again after a transport error that lost the response.
   *
   * The result is deliberately NOT cached into `#next` by this method. It is
   * used for the one immediate retry below, and only a retry that actually
   * broadcasts is allowed to set the cached nonce, because a value read at failure time
   * is stale the moment the transaction we thought had failed lands.
   *
   * Returns the refetched nonce, or null if the chain could not be read.
   */
  async #refetchPendingNonce(cause: unknown): Promise<number | null> {
    try {
      const chainNonce = await this.#options.getTransactionCount(this.#options.address);
      this.#options.logger.warn(
        {
          event: 'nonce.refetched',
          address: this.#options.address,
          nonce: chainNonce,
          resyncs: this.#resyncs,
          err: cause,
        },
        'the node rejected our nonce; refetched the pending nonce from the chain',
      );
      return chainNonce;
    } catch (error) {
      this.#options.logger.error(
        { event: 'nonce.refetch_failed', address: this.#options.address, err: error },
        'could not refetch the pending nonce; the next allocation will read it from the chain',
      );
      return null;
    }
  }

  /**
   * Allocate the next nonce and broadcast inside the critical section.
   *
   * On any error the cached nonce is invalidated rather than decremented: if the
   * transaction was in fact broadcast before the error surfaced, reusing its
   * nonce would replace a transaction we already told a user about. Refetching
   * from the chain is the only safe recovery. Every invalidation is counted and
   * reported on `/healthz` as `nonce.resyncs`, so a key whose nonce keeps
   * slipping is visible before it becomes a stalled queue.
   *
   * STUCK-NONCE RECOVERY. When the node's rejection specifically says the nonce
   * was wrong, the pending nonce is refetched immediately, inside this critical
   * section, so nothing else can allocate against a number we already know is
   * stale, and the broadcast is retried ONCE at the refetched nonce. Both
   * conditions are required. A blanket retry on any broadcast error is how a
   * transaction the node actually accepted gets sent twice; "nonce too low"
   * specifically means this transaction was NOT accepted, because something else
   * already occupies that slot. Only a retry that actually broadcasts is allowed
   * to set the cached nonce; every other path leaves it null for the next
   * allocation to resolve against the chain, because a number read at failure
   * time is stale as soon as the transaction we thought had failed lands.
   *
   * KNOWN GAP — a throw here is treated by the caller as "not broadcast", and
   * that is not always true. If the RPC accepted the transaction but the
   * response was lost (connection reset, timeout after the node queued it), the
   * transaction lands and burns gas while the caller refunds the reservation, so
   * the budget is credited back for spend that really happened. Bounded to one
   * request's gas, and it under-counts spend rather than over-counting it, which
   * is the unsafe direction for the budget but not for the user. Closing it
   * needs the caller to re-read the nonce and check for a landed transaction
   * before refunding; recorded rather than silently accepted.
   */
  async submit(
    fees: GasFees,
    submitter: Submitter,
    meta: { requestId: string; reservedWei: bigint; reservedDay: string; payer: Address },
  ): Promise<PendingTx> {
    return this.#enqueue(async () => {
      this.#inFlight += 1;
      try {
        if (this.#next === null) {
          this.#next = await this.#options.getTransactionCount(this.#options.address);
        }
        let nonce = this.#next;
        let hash: Hash;
        try {
          hash = await submitter({ nonce, ...fees });
        } catch (error) {
          // Invalidate FIRST and unconditionally. Everything after this line is
          // recovery; if any of it throws, the next allocation still reads the
          // nonce from the chain instead of reusing one we no longer trust.
          this.invalidate();
          this.#resyncs += 1;
          if (!looksLikeNonceMismatch(error)) {
            this.#options.logger.warn(
              {
                event: 'nonce.invalidated',
                requestId: meta.requestId,
                nonce,
                resyncs: this.#resyncs,
              },
              'broadcast failed; the next allocation will refetch the pending nonce from the chain',
            );
            throw error;
          }
          const refetched = await this.#refetchPendingNonce(error);
          if (refetched === null || refetched === nonce) throw error;
          try {
            hash = await submitter({ nonce: refetched, ...fees });
          } catch (retryError) {
            this.invalidate();
            throw retryError;
          }
          this.#options.logger.warn(
            {
              event: 'nonce.recovered',
              requestId: meta.requestId,
              staleNonce: nonce,
              nonce: refetched,
              hash,
            },
            'broadcast rejected a stale nonce; resubmitted at the chain nonce',
          );
          nonce = refetched;
        }
        this.#next = nonce + 1;
        this.#lastSubmission = { nonce, hash, at: Date.now(), requestId: meta.requestId };
        return {
          nonce,
          hash,
          fees,
          submitter,
          submittedAt: Date.now(),
          replacements: 0,
          requestId: meta.requestId,
          reservedWei: meta.reservedWei,
          reservedDay: meta.reservedDay,
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
  /**
   * Called at the start of every sweep, whether or not anything is pending.
   * Used to drain deferred quota refunds, which must not wait for a
   * transaction to settle — a store outage can leave refunds owed while no
   * transaction is in flight at all.
   */
  readonly onSweep?: () => void | Promise<void>;
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
  #onSweep: TxWatcherOptions['onSweep'];

  constructor(options: TxWatcherOptions) {
    this.#options = options;
    this.#onSettled = options.onSettled;
    this.#onSweep = options.onSweep;
  }

  setOnSweep(handler: NonNullable<TxWatcherOptions['onSweep']>): void {
    this.#onSweep = handler;
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
    await this.#onSweep?.();
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
