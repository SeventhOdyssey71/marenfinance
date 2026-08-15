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

/** Relayer sponsorship budget — the number that makes the gasless claim checkable. */
export interface Sponsorship {
  freeActionsRemaining: number;
  freeActionsPerMonth: number;
  /** MUSD fee charged inside the transaction once the free tier is exhausted. */
  feeAfterFreeTierWei: bigint;
}
