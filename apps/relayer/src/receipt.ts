import type { Address, Hash } from 'viem';

/**
 * R15 — "A transaction hash is not a success."
 *
 * Talise returned HTTP 200 with a digest-bearing `FailedTransaction` on both of
 * its broadcast paths, which meant every call site had to grow its own abort
 * detection, and one of them eventually did not. This module is the ONE place in
 * the relayer that decides whether something succeeded. Nothing else in this
 * codebase reads `receipt.status`; grep for it and you should find only this file.
 *
 * The states are deliberately four, not two. "submitted" and "unknown" are real
 * outcomes and collapsing either of them into success or failure is how the
 * original bug happened.
 */

export type SettlementState =
  /** Broadcast, no receipt yet. NOT a success. */
  | 'submitted'
  /** On-chain receipt with status === 'success'. The only success. */
  | 'confirmed'
  /** On-chain receipt with status === 'reverted'. We paid gas; the user's call failed. */
  | 'reverted'
  /** We could not determine the state — RPC error, or the node has never seen it. */
  | 'unknown';

export interface Settlement {
  readonly hash: Hash;
  readonly state: SettlementState;
  /** True only for `confirmed`. Read this, do not re-derive it. */
  readonly success: boolean;
  readonly blockNumber: bigint | null;
  readonly gasUsed: bigint | null;
  readonly effectiveGasPrice: bigint | null;
  /** Actual BTC (wei) this transaction cost the relayer. Null until confirmed/reverted. */
  readonly gasCostWei: bigint | null;
  readonly from: Address | null;
}

/** Minimal shape of the receipt fields we consume, so this is testable without a chain. */
export interface ReceiptLike {
  status: 'success' | 'reverted';
  blockNumber: bigint;
  gasUsed: bigint;
  effectiveGasPrice?: bigint | null | undefined;
  from?: Address | undefined;
}

export interface ReceiptReader {
  /** Resolves to null when the node has no receipt for the hash yet. */
  getReceipt(hash: Hash): Promise<ReceiptLike | null>;
}

const pending = (hash: Hash, state: SettlementState): Settlement => ({
  hash,
  state,
  success: false,
  blockNumber: null,
  gasUsed: null,
  effectiveGasPrice: null,
  gasCostWei: null,
  from: null,
});

/**
 * Resolve the settlement state of a transaction hash.
 *
 * Note what this never does: it never returns `success: true` without having
 * read `status === 'success'` off an on-chain receipt, and it never converts an
 * RPC failure into either verdict — that becomes `unknown`, and callers must
 * treat `unknown` as "not delivered".
 */
export async function settle(reader: ReceiptReader, hash: Hash): Promise<Settlement> {
  let receipt: ReceiptLike | null;
  try {
    receipt = await reader.getReceipt(hash);
  } catch {
    return pending(hash, 'unknown');
  }
  if (receipt === null) {
    return pending(hash, 'submitted');
  }

  const effectiveGasPrice = receipt.effectiveGasPrice ?? null;
  const gasCostWei = effectiveGasPrice === null ? null : receipt.gasUsed * effectiveGasPrice;

  return {
    hash,
    state: receipt.status === 'success' ? 'confirmed' : 'reverted',
    success: receipt.status === 'success',
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    effectiveGasPrice,
    gasCostWei,
    from: receipt.from ?? null,
  };
}

/** HTTP status for a settlement lookup. `submitted` is 202, never 200. */
export function settlementHttpStatus(state: SettlementState): 200 | 202 | 502 {
  switch (state) {
    case 'confirmed':
      return 200;
    case 'reverted':
      // The lookup itself succeeded; the payload says the transaction failed.
      return 200;
    case 'submitted':
      return 202;
    case 'unknown':
      return 502;
  }
}
