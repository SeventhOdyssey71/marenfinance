import { CCR, MAREN_POLICY, MCR, MIN_NET_DEBT, MUSD_GAS_COMPENSATION, WAD } from './constants';

/**
 * Position math for MUSD troves.
 *
 * Everything here is integer math on 1e18 fixed-point values. No floats touch a number
 * that a liquidation decision depends on.
 *
 * Rounding rule, applied without exception: when a rounding choice exists, round so the
 * position looks LESS safe, never more. A user who is told 181% when they are at 180.6%
 * has been misled in the direction that costs them money.
 */

/** Collateral ratio = collateral * price / debt, as a 1e18 fixed-point ratio. */
export function collateralRatio(collateralWei: bigint, debtWei: bigint, priceWei: bigint): bigint {
  if (debtWei === 0n) return MAX_CR;
  // Truncating division rounds the CR down, which is the conservative direction.
  return (collateralWei * priceWei) / debtWei;
}

/** Sentinel for "no debt, therefore infinite collateral ratio". */
export const MAX_CR = 2n ** 255n - 1n;

/** Nominal ICR — price-independent, used for SortedTroves ordering. Matches Liquity's 1e20 scale. */
export function nominalCollateralRatio(collateralWei: bigint, debtWei: bigint): bigint {
  if (debtWei === 0n) return MAX_CR;
  return (collateralWei * 10n ** 20n) / debtWei;
}

/** USD value (1e18) of a BTC amount (1e18) at a price (1e18). */
export function collateralValue(collateralWei: bigint, priceWei: bigint): bigint {
  return (collateralWei * priceWei) / WAD;
}

/**
 * Total debt a trove will carry if it borrows `netDebt`, including the origination fee
 * and the 200 MUSD gas compensation. This is the number that CR is computed against —
 * quoting a user their net borrow as their debt understates their risk.
 */
export function totalDebtFor(netDebtWei: bigint, borrowingRateWei: bigint): bigint {
  const fee = (netDebtWei * borrowingRateWei) / WAD;
  return netDebtWei + fee + MUSD_GAS_COMPENSATION;
}

/**
 * Maximum net debt borrowable against `collateral` while staying at or above `targetCr`.
 *
 * DIRECT TROVES ONLY, for the same reason as `collateralRequiredFor` below: it subtracts the
 * gas compensation and divides out the origination fee. The pooled analogue is
 * `MarenVault.maxBorrowable`, which does neither. Both round DOWN.
 */
export function maxNetDebtAt(
  collateralWei: bigint,
  priceWei: bigint,
  targetCr: bigint,
  borrowingRateWei: bigint,
): bigint {
  if (targetCr === 0n) return 0n;
  const maxTotalDebt = (collateralWei * priceWei) / targetCr;
  if (maxTotalDebt <= MUSD_GAS_COMPENSATION) return 0n;
  // Invert totalDebtFor: total = net * (1 + rate) + gasComp
  const afterGasComp = maxTotalDebt - MUSD_GAS_COMPENSATION;
  const net = (afterGasComp * WAD) / (WAD + borrowingRateWei);
  return net;
}

/**
 * Collateral required to borrow `netDebt` at `targetCr`. Rounds UP — ask for more, not less.
 *
 * DIRECT TROVES ONLY. This grosses `netDebt` up by the origination fee and the 200 MUSD gas
 * compensation, because that is what a trove of one's own actually carries.
 *
 * The pooled route deliberately does NOT match this, and the asymmetry is correct rather than
 * a bug to be reconciled: see `MarenVault.collateralRequiredForDebt` in
 * `packages/contracts/src/MarenVault.sol`. A pooled position pays no per-user gas
 * compensation — one covers the whole pooled trove and the protocol's own seed position has
 * already paid it — and a borrow served from the vault's MUSD reserve pays no origination fee
 * at all. Applying this function to a pooled position would over-quote every user by 200 MUSD
 * of collateral they do not owe.
 *
 * Use `assessBorrowRoute` to decide which of the two a given user is being quoted.
 */
export function collateralRequiredFor(
  netDebtWei: bigint,
  priceWei: bigint,
  targetCr: bigint,
  borrowingRateWei: bigint,
): bigint {
  if (priceWei === 0n) return MAX_CR;
  const totalDebt = totalDebtFor(netDebtWei, borrowingRateWei);
  const numerator = totalDebt * targetCr;
  const denominator = priceWei;
  // Round up so we never under-quote the collateral a user needs.
  return (numerator + denominator - 1n) / denominator;
}

/**
 * The BTC price at which this position is liquidated by the MUSD protocol (ICR < 110%).
 * Rounds UP: a liquidation price quoted too low is a lie that costs a user their collateral.
 */
export function liquidationPrice(collateralWei: bigint, debtWei: bigint): bigint {
  if (collateralWei === 0n) return MAX_CR;
  if (debtWei === 0n) return 0n;
  const numerator = debtWei * MCR;
  const denominator = collateralWei;
  return (numerator + denominator - 1n) / denominator;
}

/** The price at which Maren's own keeper would liquidate a pooled position (140%). */
export function marenLiquidationPrice(collateralWei: bigint, debtWei: bigint): bigint {
  if (collateralWei === 0n) return MAX_CR;
  if (debtWei === 0n) return 0n;
  const numerator = debtWei * MAREN_POLICY.vaultLiquidationCr;
  return (numerator + collateralWei - 1n) / collateralWei;
}

/** How far BTC can fall, in basis points, before protocol liquidation. */
export function priceDropToLiquidationBps(
  collateralWei: bigint,
  debtWei: bigint,
  priceWei: bigint,
): number {
  if (debtWei === 0n || priceWei === 0n) return 10_000;
  const liq = liquidationPrice(collateralWei, debtWei);
  if (liq >= priceWei) return 0;
  return Number(((priceWei - liq) * 10_000n) / priceWei);
}

export type HealthStatus = 'none' | 'healthy' | 'caution' | 'warning' | 'danger' | 'liquidatable';

export interface PositionHealth {
  status: HealthStatus;
  collateralRatio: bigint;
  liquidationPrice: bigint;
  priceDropToLiquidationBps: number;
  /** True when the user may borrow more under Maren policy. */
  canBorrow: boolean;
}

/**
 * Classify a position. Thresholds are Maren's product policy and are deliberately far
 * stricter than the protocol's 110% cliff — see MAREN_POLICY in constants.ts.
 */
export function assessHealth(
  collateralWei: bigint,
  debtWei: bigint,
  priceWei: bigint,
): PositionHealth {
  const cr = collateralRatio(collateralWei, debtWei, priceWei);

  let status: HealthStatus;
  if (debtWei === 0n) status = 'none';
  else if (cr < MCR) status = 'liquidatable';
  else if (cr < MAREN_POLICY.vaultLiquidationCr) status = 'danger';
  else if (cr < MAREN_POLICY.warnCr) status = 'warning';
  else if (cr < MAREN_POLICY.minHealthyCr) status = 'caution';
  else status = 'healthy';

  return {
    status,
    collateralRatio: cr,
    liquidationPrice: liquidationPrice(collateralWei, debtWei),
    priceDropToLiquidationBps: priceDropToLiquidationBps(collateralWei, debtWei, priceWei),
    canBorrow: debtWei === 0n || cr >= MAREN_POLICY.minHealthyCr,
  };
}

/**
 * Simple, non-compounding interest accrued on a principal — matches MUSD's model exactly.
 * MUSD does NOT compound, and a trove keeps the rate it opened at for life.
 */
export function accruedInterest(
  principalWei: bigint,
  rateBps: number,
  elapsedSeconds: number,
): bigint {
  const SECONDS_IN_YEAR = 365n * 24n * 60n * 60n;
  return (BigInt(elapsedSeconds) * principalWei * BigInt(rateBps)) / (10_000n * SECONDS_IN_YEAR);
}

export type BorrowEligibility =
  | { eligible: true; route: 'direct' | 'pooled' }
  | { eligible: false; reason: string; shortfallWei: bigint };

/**
 * Decide how a user should borrow, and say plainly when they cannot.
 *
 * The 1,800 MUSD protocol minimum is the reason MarenVault exists: below it, a direct
 * trove is impossible, and the pooled vault is the only route.
 */
export function assessBorrowRoute(
  collateralWei: bigint,
  priceWei: bigint,
  targetCr: bigint = MAREN_POLICY.targetCr,
  borrowingRateWei: bigint = 1_000_000_000_000_000n,
): BorrowEligibility {
  const maxNet = maxNetDebtAt(collateralWei, priceWei, targetCr, borrowingRateWei);

  if (maxNet >= MIN_NET_DEBT) {
    // Enough for a direct trove — no pooling risk, so prefer it and say why.
    return { eligible: true, route: 'direct' };
  }

  const MIN_POOLED_COLLATERAL = 10n ** 15n; // 0.001 BTC
  if (collateralWei >= MIN_POOLED_COLLATERAL) {
    return { eligible: true, route: 'pooled' };
  }

  return {
    eligible: false,
    reason: 'Below the 0.001 BTC minimum deposit.',
    shortfallWei: MIN_POOLED_COLLATERAL - collateralWei,
  };
}

/** Would this operation put the system into Recovery Mode territory (TCR < 150%)? */
export function isRecoveryMode(tcr: bigint): boolean {
  return tcr < CCR;
}
