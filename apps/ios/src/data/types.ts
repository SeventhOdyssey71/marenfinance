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

export type ActivityKind =
  | 'deposit'
  | 'withdraw'
  | 'borrow'
  | 'repay'
  | 'send'
  | 'receive'
  | 'earn-deposit'
  | 'earn-withdraw';

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
