import type { Hash, TransactionReceipt } from 'viem';

import { mutate } from '../data/mock';
import { isSponsoredKind as isSponsoredKindImpl } from './sponsorship';
import { accessKey } from '../wallet/keystore';
import { confirmTransaction, type TxOutcome } from './receipt';

/**
 * Every value-moving action in the app.
 *
 * Each one follows the same three steps, in this order, with no shortcuts:
 *
 *   1. Biometric-gated key access. `accessKey()` prompts for Face ID and returns the
 *      key for the duration of the signature only.
 *   2. Submit, yielding a transaction hash.
 *   3. `confirmTransaction` — the single R15 checkpoint. A hash is not a success, so
 *      nothing here returns until a receipt has been read and found to say 'success'.
 *
 * Local state is mutated *after* step 3 and only in the 'delivered' branch. That
 * ordering is the entire point: a reverted transaction must leave the UI showing the
 * pre-transaction balance, not an optimistic one it then has to walk back.
 */

export type ActionResult =
  | { kind: 'ok'; outcome: Extract<TxOutcome, { kind: 'delivered' }> }
  | { kind: 'declined'; reason: string }
  | { kind: 'failed'; outcome: TxOutcome };

export type ActionKind =
  | { type: 'deposit'; btcWei: bigint }
  | { type: 'withdraw'; btcWei: bigint }
  | { type: 'borrow'; musdWei: bigint }
  | { type: 'repay'; musdWei: bigint }
  | { type: 'send'; musdWei: bigint; to: string; memo?: string }
  | { type: 'earn-deposit'; musdWei: bigint }
  | { type: 'earn-withdraw'; musdWei: bigint };

/**
 * Whether the relayer sponsors this action.
 *
 * The rule and its justification live in `./sponsorship`, which has no dependencies so
 * that it can be tested without pulling in the Keychain. Re-exported here so call sites
 * that already hold an `ActionKind` do not have to reach for the string themselves.
 */
export { isSponsoredKind, type ActionType } from './sponsorship';

export function isSponsored(action: ActionKind): boolean {
  return isSponsoredKindImpl(action.type);
}

export async function submitAction(action: ActionKind): Promise<ActionResult> {
  // 1 — Face ID on every signing action, without exception.
  const key = await accessKey();
  if (key.kind === 'denied') return { kind: 'declined', reason: key.reason };
  if (key.kind === 'missing') {
    return { kind: 'declined', reason: 'No signing key is available on this device.' };
  }

  const sponsored = isSponsored(action);

  // 2 — Submit. Replaced by walletClient.writeContract / a POST to the relayer.
  const hash = await submitMock(action);

  // 3 — The R15 checkpoint. Nothing bypasses this.
  const outcome = await confirmTransaction(mockClient, hash, { sponsored });

  if (outcome.kind !== 'delivered') return { kind: 'failed', outcome };

  applyLocalEffect(action);
  return { kind: 'ok', outcome };
}

function applyLocalEffect(action: ActionKind): void {
  switch (action.type) {
    case 'deposit':
      return mutate.depositBtc(action.btcWei);
    case 'withdraw':
      return mutate.withdrawBtc(action.btcWei);
    case 'borrow':
      return mutate.borrow(action.musdWei);
    case 'repay':
      return mutate.repay(action.musdWei);
    case 'send':
      return mutate.send(action.musdWei);
    case 'earn-deposit':
      return mutate.earnDeposit(action.musdWei);
    case 'earn-withdraw':
      return mutate.earnWithdraw(action.musdWei);
  }
}

// ── mock transport ───────────────────────────────────────────────────────────
//
// Stands in for viem's PublicClient. It is deliberately shaped as the narrow
// `Pick<PublicClient, 'waitForTransactionReceipt'>` that confirmTransaction accepts, so
// dropping in a real client is a one-line change in this file.

async function submitMock(action: ActionKind): Promise<Hash> {
  await delay(900);
  const seed = `${action.type}:${Date.now()}`;
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const body = h.toString(16).padStart(8, '0').repeat(8).slice(0, 64);
  return `0x${body}` as Hash;
}

const mockClient = {
  async waitForTransactionReceipt({ hash }: { hash: Hash }): Promise<TransactionReceipt> {
    await delay(1_400);
    return {
      status: 'success',
      blockNumber: 4_281_907n,
      gasUsed: 148_213n,
      effectiveGasPrice: 1_200_000_000n,
      transactionHash: hash,
    } as unknown as TransactionReceipt;
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
