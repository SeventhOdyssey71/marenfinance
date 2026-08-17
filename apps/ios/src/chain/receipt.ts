import type { Hash, PublicClient, TransactionReceipt } from 'viem';

/**
 * R15 — "A transaction hash is not a success."
 *
 * SECURITY-LESSONS.md R15: Talise's broadcast paths returned HTTP 200 carrying a
 * digest-bearing `FailedTransaction`, which forced every call site to invent its own
 * abort detection. Maren does the check in exactly one place: here.
 *
 * Nothing in this app may render a payment, deposit, borrow, repay or withdraw as
 * delivered except by holding a `Delivered` value returned from `confirmTransaction`.
 * The `Delivered` type is intentionally not constructible outside this module — the
 * only way to obtain one is to have gone through the receipt check.
 */

declare const receiptChecked: unique symbol;

/** Proof that an on-chain receipt was fetched and its status was literally 'success'. */
export interface Delivered {
  readonly [receiptChecked]: true;
  readonly hash: Hash;
  readonly blockNumber: bigint;
  readonly gasUsed: bigint;
  /** Effective gas paid, in wei of BTC. Zero when a relayer sponsored the transaction. */
  readonly gasPaidByUser: bigint;
}

export type TxOutcome =
  | { kind: 'delivered'; receipt: Delivered }
  /** The chain accepted the transaction and then reverted it. Funds did not move. */
  | { kind: 'reverted'; hash: Hash; blockNumber: bigint }
  /** We never saw a receipt inside the timeout. The transaction may still land. */
  | { kind: 'timeout'; hash: Hash }
  /** We could not reach the chain at all. Says nothing about whether it landed. */
  | { kind: 'unreachable'; hash: Hash; error: string };

export interface ConfirmOptions {
  /** Number of confirmations to wait for. One is enough on Mezo's instant finality. */
  confirmations?: number;
  timeoutMs?: number;
  /** True when a Maren relayer paid the BTC gas under ERC-2771. */
  sponsored?: boolean;
}

/**
 * The one and only success check.
 *
 * Deliberately returns a discriminated union rather than throwing: R16 says prefer an
 * explicit typed failure over a silent fallback, and a thrown error at a call site is
 * far too easy to swallow into a generic "something went wrong" that then renders as a
 * spinner which never resolves.
 */
export async function confirmTransaction(
  client: Pick<PublicClient, 'waitForTransactionReceipt'>,
  hash: Hash,
  options: ConfirmOptions = {},
): Promise<TxOutcome> {
  const { confirmations = 1, timeoutMs = 60_000, sponsored = false } = options;

  let receipt: TransactionReceipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash, confirmations, timeout: timeoutMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // viem throws a distinct error for the timeout case; anything else is a transport
    // failure and must not be reported as if the transaction failed.
    if (/timed out|Timeout/i.test(message)) return { kind: 'timeout', hash };
    return { kind: 'unreachable', hash, error: message };
  }

  // This is the line the whole module exists for. Nothing else counts as success.
  if (receipt.status !== 'success') {
    return { kind: 'reverted', hash, blockNumber: receipt.blockNumber };
  }

  return {
    kind: 'delivered',
    receipt: {
      hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      gasPaidByUser: sponsored ? 0n : receipt.gasUsed * receipt.effectiveGasPrice,
    } as Delivered,
  };
}

/** Copy for each outcome. Stated plainly — BRAND.md §1 voice, and R15's whole point. */
export function describeOutcome(outcome: TxOutcome): { title: string; detail: string } {
  switch (outcome.kind) {
    case 'delivered':
      return { title: 'Delivered', detail: 'Confirmed on Mezo.' };
    case 'reverted':
      return {
        title: 'Failed on-chain',
        detail: 'The transaction was mined and then reverted. No funds moved.',
      };
    case 'timeout':
      return {
        title: 'Not confirmed yet',
        detail:
          'No receipt within the timeout. This is not a failure. The transaction may still be included. Check Activity before retrying.',
      };
    case 'unreachable':
      return {
        title: 'Cannot reach Mezo',
        detail:
          'We could not read a receipt. This says nothing about whether the transaction landed. Do not retry until Activity shows its outcome.',
      };
  }
}
