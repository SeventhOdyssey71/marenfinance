import type { MezoNetwork } from '@maren/sdk';
import type { Address, Hash } from 'viem';

/**
 * The shape of everything the app reads from chain.
 *
 * Written as if it came from viem reads against the contracts at the addresses in
 * `@maren/sdk`, because that is what will produce it. All amounts are 1e18 fixed-point
 * bigints — the SDK's math and formatters take nothing else, and a `number` anywhere in
 * this file would be a bug waiting to round someone's collateral.
 *
 * Shared with `apps/ios/src/data/types.ts`. Where the two differ, that is a bug.
 */

/** Mirrors TroveManager.getEntireDebtAndColl() plus Maren's own routing. */
export interface Position {
  /** BTC collateral, 1e18. Native gas token, 18 decimals — not 8. */
  collateralWei: bigint;
  /**
   * TOTAL debt: principal + accrued interest + the 200 MUSD gas compensation. This is
   * what CR is computed against. Quoting net debt here understates risk.
   */
  debtWei: bigint;
  /** Net principal drawn, excluding fee and gas compensation. */
  principalWei: bigint;
  /** Accrued simple interest at the trove's fixed opening rate. */
  interestWei: bigint;
  /** The rate this trove opened at, in bps. Fixed for the life of the loan. */
  interestRateBps: number;
  /**
   * `TroveManager.getTroveMaxBorrowingCapacity()` — the Mezo-only per-trove ceiling,
   * fixed at the price when the trove opened. Adding collateral does NOT raise it; only
   * `refinance()` does. Always shown as the real borrow limit, never an ICR-derived
   * number. (LIQUITY_DIVERGENCES #3)
   */
  maxBorrowingCapacityWei: bigint;
  /**
   * Pooled route only: `MarenVault.maxBorrowable(user)`, the additional MUSD this user
   * may draw before hitting the vault's 180% floor. The pooled trove's own
   * `getTroveMaxBorrowingCapacity()` sits above it as the umbrella constraint, and both
   * are shown — whichever binds first is the one that will stop the transaction.
   */
  vaultMaxBorrowableWei?: bigint;
  /** 'direct' = the user's own trove. 'pooled' = a share of MarenVault's trove. */
  route: 'direct' | 'pooled' | 'none';
  /** Unix seconds the position was opened, for the interest narrative. */
  openedAt: number;
}

export interface Balances {
  /** Spendable MUSD in the user's wallet. */
  musdWei: bigint;
  /** BTC held outside the vault, in wei. Usually zero — that is the whole product. */
  btcWei: bigint;
}

/** MarenEarn — an ERC-4626 vault over the MUSD Stability Pool. */
export interface EarnPosition {
  /** Shares held, 1e18. */
  sharesWei: bigint;
  /** convertToAssets(shares) — current MUSD value. */
  assetsWei: bigint;
  /** Total MUSD the user has ever deposited, for computing realised return. */
  depositedWei: bigint;
  /**
   * Realised yield over a trailing window. Backward-looking, and labelled as such
   * everywhere it is shown. The Stability Pool has NO token emissions — yield is
   * liquidation gains only, so it is lumpy and is never an APY we may advertise.
   */
  trailing: TrailingYield;
}

export interface TrailingYield {
  /** Length of the window actually observed, in days. */
  windowDays: number;
  /** MUSD realised across the window, 1e18. Can be zero for long stretches. */
  realisedWei: bigint;
  /** Number of liquidation events that produced the gains in this window. */
  liquidationEvents: number;
  /** Unix seconds of the most recent realised gain, or null if there has been none. */
  lastGainAt: number | null;
}

export type ActivityKind =
  | 'deposit'
  | 'withdraw'
  | 'borrow'
  | 'repay'
  | 'send'
  | 'receive'
  | 'earn-deposit'
  | 'earn-withdraw'
  | 'link-created'
  | 'link-claimed'
  | 'request-created';

/**
 * `status` is never derived from "we got a hash back" — it is 'pending' until a receipt
 * is read, and 'failed' when that receipt says `reverted`. See `lib/chain/receipt.ts`.
 */
export type ActivityStatus = 'pending' | 'confirmed' | 'failed';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  status: ActivityStatus;
  /** Unix seconds. */
  at: number;
  /** MUSD amount for MUSD-denominated actions, 1e18. */
  musdWei?: bigint;
  /** BTC amount for BTC-denominated actions, 1e18. */
  btcWei?: bigint;
  /** Counterparty handle (`@sele`) or address, for sends and receives. */
  counterparty?: string;
  counterpartyAddress?: Address;
  /** On-chain memo, capped at 80 bytes by MarenPay. */
  memo?: string;
  hash?: Hash;
  /**
   * The block this row's log was in.
   *
   * Optional because a row can also come from a store that predates the field, never
   * because it can be unknown for a decoded log — a log without a block is a pending log
   * and pending logs do not reach here.
   *
   * It exists for the Activity cache, which resumes a scan from the last block it read and
   * re-reads the most recent stretch in case of a reorg. Without the block number a cached
   * row cannot be told from a row the rescan is about to supply again, and the choice is
   * between duplicating rows and trusting a chain that may have rewritten them.
   */
  blockNumber?: bigint;
  /** True when a Maren relayer paid the BTC gas. */
  sponsored: boolean;
  /** Gas the user actually paid, in wei of BTC. Zero for sponsored actions. */
  gasPaidWei: bigint;
  network: MezoNetwork;
}

export interface Handle {
  handle: string;
  address: Address;
}

/** MarenPay.requests(id) — an ask, not an obligation. Moves no funds until fulfilled. */
export interface PaymentRequest {
  id: string;
  amountWei: bigint;
  /** Null means "anyone may fulfil this". */
  payer: Address | null;
  payerHandle: string | null;
  memo: string;
  createdAt: number;
  status: 'open' | 'fulfilled' | 'cancelled';
  direction: 'outgoing' | 'incoming';
}

/** MarenPay.links(id) — hash-locked claimable escrow. The secret never touches the chain. */
export interface PaymentLink {
  id: string;
  amountWei: bigint;
  /** The one-time public key the escrow is locked to. */
  linkKey: Address;
  /**
   * The private key that travels in the URL fragment. Held only in this session — a
   * link that has been shown once cannot be shown again, which is the honest behaviour
   * for a bearer secret.
   */
  secret: string;
  expiry: number;
  createdAt: number;
  memo: string;
  status: 'unclaimed' | 'claimed' | 'reclaimed' | 'expired';
}

/**
 * The protocol's own state, readable by anyone with an RPC and no wallet at all.
 *
 * This exists so a disconnected visitor is shown something TRUE rather than something
 * seeded. Every field is a single contract read: the pooled trove as MUSD's TroveManager
 * reports it, and the vault's MUSD reserve. None of it is about the visitor, and the
 * screen that renders it says so.
 */
export interface ProtocolStats {
  /** Total BTC collateral credited across every user of the pooled vault. */
  totalCollateralWei: bigint;
  /** The pooled trove's collateral as the sorted list sees it. */
  troveCollateralWei: bigint;
  /** The pooled trove's net debt. */
  troveNetDebtWei: bigint;
  /** The pooled trove's individual collateral ratio, 1e18. */
  troveIcrWei: bigint;
  /** MUSD sitting in the vault's reserve, available to serve borrows without new debt. */
  reserveMusdWei: bigint;
  /** The trove's Mezo-fixed borrowing ceiling. */
  troveMaxBorrowingCapacityWei: bigint;
  /**
   * `MarenVault.troveOpen`. False before the pooled trove is seeded, when `borrow` reverts
   * with TroveNotOpen() and `troveStatus()` reports an ICR of `type(uint256).max`. Carried
   * as its own flag so a preflight can tell "there is no trove" from "the trove is
   * enormously overcollateralised".
   */
  troveOpen: boolean;
  /** `MarenVault.depositCap` — the collateral ceiling `deposit` refuses to cross. */
  depositCapWei: bigint;
  /** BTC credited to users but not yet pushed into the trove. */
  idleCollateralWei: bigint;
  /** True when the vault has paused new deposits. */
  depositsPaused: boolean;
  /** True when the vault has paused new borrowing. */
  borrowingPaused: boolean;
  /**
   * MUSD's system-wide Total Collateral Ratio, 1e18, and whether it has fallen under the
   * 150% CCR. These are about the WHOLE PROTOCOL, not about Maren's pooled trove, and they
   * are the only fields here that describe something no Maren contract can influence.
   *
   * They exist because Recovery Mode closes doors that Maren's own preflight otherwise
   * reports as open. Read out of the deployed BorrowerOperations bytecode, three separate
   * require strings fire once TCR < CCR, and two of them sit directly under user actions:
   * "Collateral withdrawal not permitted Recovery Mode" kills every `withdrawColl`, and
   * "Cannot decrease your Trove's ICR in Recovery Mode" kills every bare `withdrawMUSD`
   * because adding debt without collateral always lowers ICR. Without these fields the
   * borrow and withdraw controls stay enabled and the user pays gas to discover a refusal
   * that was knowable for free.
   *
   * `null` means UNKNOWN rather than false. `checkRecoveryMode` needs a price argument, so
   * when the oracle read fails there is no honest answer, and a `false` there would be a
   * guess dressed as a fact. Callers must treat null as "cannot say" and lean on the price
   * gate, which is failing for the same reason.
   */
  systemTcrWei: bigint | null;
  recoveryMode: boolean | null;
}
