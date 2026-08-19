import type { Address, Hash } from 'viem';
import type { MezoNetwork } from '@maren/sdk';

/**
 * The shape of everything the app reads from chain.
 *
 * These types are written as if they came from viem reads against the MUSD contracts at
 * the addresses in `@maren/sdk`, because that is what will produce them. All amounts are
 * 1e18 fixed-point bigints — the SDK's math and formatters take nothing else, and a
 * `number` anywhere in this file would be a bug waiting to round someone's collateral.
 */

/** Mirrors TroveManager.getEntireDebtAndColl() plus Maren's own routing. */
export interface Position {
  /** BTC collateral, 1e18. Native gas token, 18 decimals — not 8. */
  collateralWei: bigint;
  /**
   * TOTAL debt: principal + accrued interest + the 200 MUSD gas compensation.
   * This is what CR is computed against. Quoting net debt here understates risk.
   */
  debtWei: bigint;
  /** Net principal drawn, excluding fee and gas compensation. */
  principalWei: bigint;
  /** Accrued simple interest at the trove's fixed opening rate. */
  interestWei: bigint;
  /** The rate this trove opened at, in bps. Fixed for the life of the loan. */
  interestRateBps: number;
  /**
   * Mezo-only per-trove ceiling, fixed at the price when the trove opened. Adding
   * collateral does NOT raise it — only refinance() does. Always shown as the real
   * borrow limit, never an ICR-derived number. (LIQUITY_DIVERGENCES #3)
   */
  maxBorrowingCapacityWei: bigint;
  /** 'direct' = the user's own trove. 'pooled' = a share of MarenVault's trove. */
  route: 'direct' | 'pooled' | 'none';
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

/**
 * Every kind of row a log scan can produce.
 *
 * The last three were added when Activity started reading real logs. MarenPay emits
 * `RequestCreated`, `LinkCreated` and `LinkClaimed` whether or not this app has a screen
 * for them, and an address that used the web app has them in its history. Dropping those
 * logs on the floor would have been the quiet kind of wrong: the coverage line says
 * "read every block from X to Y", and a list that silently discards events inside that
 * range makes the sentence false. A row the app can describe plainly is better than a
 * gap, so they are decoded and named.
 */
export type ActivityKind =
  | 'deposit'
  | 'withdraw'
  | 'borrow'
  | 'repay'
  | 'send'
  | 'receive'
  | 'earn-deposit'
  | 'earn-withdraw'
  | 'request-created'
  | 'link-created'
  | 'link-claimed';

/**
 * R15 lives in this type. `status` is never derived from "we got a hash back" — it is
 * 'pending' until a receipt is read, and 'failed' when that receipt says `reverted`.
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
   * The block this row's log was in. See the web copy of this file — it is what lets the
   * Activity cache resume a scan without duplicating or trusting rows a reorg may have
   * rewritten. Mirrored here so the two type files do not drift.
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

/**
 * A list of activity, plus the span it was actually read over.
 *
 * `readActivity()` returns this rather than a bare `ActivityItem[]` because THE SPAN IS
 * PART OF THE ANSWER. "Nothing here" means something different when the scan reached the
 * block Maren was deployed at than when it only reached three days back, and the screen
 * renders a different empty state for each. Flattening this to an array would throw the
 * distinction away and let the UI round "nothing recent" up to "nothing ever".
 *
 * The web app's reader returns the identical shape, for the identical reason. See
 * `apps/web/src/lib/chain/logs.ts`.
 */
export interface ActivityWindow {
  items: ActivityItem[];
  /** Oldest block actually scanned, inclusive. */
  fromBlock: bigint;
  /** Newest block actually scanned, inclusive. */
  toBlock: bigint;
  /**
   * True when `fromBlock` is the deployment block, so an empty `items` is a complete
   * answer about this account rather than a recent one.
   */
  complete: boolean;
}
