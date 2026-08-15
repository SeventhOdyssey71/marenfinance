import {
  BORROWING_RATE,
  MAREN_POLICY,
  MUSD_GAS_COMPENSATION,
  WAD,
  assessHealth,
  collateralRatio,
  collateralRequiredFor,
  liquidationPrice,
  type PositionHealth,
} from '@maren/sdk';

import type { Position } from './data/types';

/**
 * Vault arithmetic, assembled from `@maren/sdk`.
 *
 * Nothing here re-implements a collateral ratio, a liquidation price or a formatter —
 * those live in the SDK and are shared with iOS and the contracts' own test vectors.
 * What this module does is compose them for the two routes, which genuinely differ:
 *
 *   DIRECT — the user's own trove. Debt carries the 0.1% origination fee and the 200 MUSD
 *            gas compensation, so the SDK's `collateralRequiredFor` / `maxNetDebtAt`
 *            apply exactly as written.
 *   POOLED — a share of MarenVault's trove. There is one gas compensation for the whole
 *            trove, already paid by the protocol's seed position, and a borrow served
 *            from the vault's MUSD reserve pays no origination fee. Applying the direct
 *            formulas would over-quote every pooled user by 200 MUSD of collateral they
 *            do not owe.
 *
 * That asymmetry is deliberate on both sides: see the counterpart comments on
 * `collateralRequiredFor` in `packages/sdk/src/position.ts` and
 * `MarenVault.collateralRequiredForDebt` in `packages/contracts/src/MarenVault.sol`. If
 * you change one, change all three.
 */

/** The pooled mirror of `collateralRequiredFor`, taking TOTAL debt and grossing nothing up. */
export function pooledCollateralRequiredFor(debtWei: bigint, priceWei: bigint, targetCr: bigint) {
  if (debtWei === 0n || priceWei === 0n) return 0n;
  // Round UP, exactly as the contract does: quoting a user a wei less than the ratio
  // they asked for makes the transaction revert.
  const numerator = debtWei * targetCr;
  return (numerator + priceWei - 1n) / priceWei;
}

/**
 * The additional MUSD that lands an EXISTING position exactly on `targetCr`.
 *
 * Why this is not `maxNetDebtAt`: that function sizes a trove being opened, so it
 * subtracts the 200 MUSD gas compensation and divides out the origination fee across the
 * whole borrow. Applied to a position that already exists, it subtracts a reserve
 * `position.debtWei` is already carrying and ignores the interest that has accrued since
 * — which quotes a "recommended" amount that lands the user at 248.6% when they asked
 * for 250%. Flattering by 1.4 points is still wrong, and it is wrong in the direction
 * that costs money.
 *
 * So: work from total debt, which is what the ratio is actually computed against, and
 * gross up only the NEW draw by the origination fee.
 */
function headroomAt(position: Position, priceWei: bigint, targetCr: bigint): bigint {
  if (targetCr === 0n) return 0n;
  const debtAllowed = (position.collateralWei * priceWei) / targetCr;
  if (debtAllowed <= position.debtWei) return 0n;
  const room = debtAllowed - position.debtWei;

  // A pooled borrow served from the vault's MUSD reserve pays no origination fee.
  if (position.route === 'pooled') return room;

  // Invert `draw + draw * rate <= room`, rounding down so the quote never overshoots.
  return (room * WAD) / (WAD + BORROWING_RATE);
}

export interface BorrowCeiling {
  /** The most MUSD this user may draw right now. The slider's hard stop. */
  amountWei: bigint;
  /** Which limit produced it — the one to name in the interface. */
  binding: 'ratio' | 'ceiling' | 'none';
  /** Headroom under Maren's 180% floor alone. */
  ratioHeadroomWei: bigint;
  /** Headroom under Mezo's per-trove ceiling alone. */
  mezoHeadroomWei: bigint;
}

/**
 * The hard stop for the borrow control.
 *
 * Two limits bind independently and the smaller wins: Maren's 180% floor, and Mezo's
 * per-trove `maxBorrowingCapacity` — which is fixed at the price the trove opened at and
 * does not move when collateral is added. Quoting only the first is how a borrow ends in
 * an opaque revert.
 */
export function borrowCeiling(position: Position, priceWei: bigint): BorrowCeiling {
  const drawn = position.principalWei;

  /**
   * On the pooled route the contract answers this itself — `MarenVault.maxBorrowable`
   * is the same 180% calculation done on-chain against the same ledger, so we use its
   * number rather than a second opinion that could disagree with it by a wei.
   */
  const ratioHeadroomWei =
    position.route === 'pooled'
      ? (position.vaultMaxBorrowableWei ?? headroomAt(position, priceWei, MAREN_POLICY.minHealthyCr))
      : headroomAt(position, priceWei, MAREN_POLICY.minHealthyCr);

  const mezoHeadroomWei =
    position.maxBorrowingCapacityWei > drawn ? position.maxBorrowingCapacityWei - drawn : 0n;

  const amountWei = ratioHeadroomWei < mezoHeadroomWei ? ratioHeadroomWei : mezoHeadroomWei;

  return {
    amountWei,
    binding: amountWei === 0n ? 'none' : ratioHeadroomWei <= mezoHeadroomWei ? 'ratio' : 'ceiling',
    ratioHeadroomWei,
    mezoHeadroomWei,
  };
}

/** Where the recommended 250% target sits on the slider's track. */
export function recommendedBorrow(position: Position, priceWei: bigint, ceiling: bigint): bigint {
  const target = headroomAt(position, priceWei, MAREN_POLICY.targetCr);
  return target > ceiling ? ceiling : target;
}

export interface BorrowPreview {
  /** Total debt after this borrow — the number CR is computed against. */
  debtWei: bigint;
  collateralRatio: bigint;
  liquidationPriceWei: bigint;
  health: PositionHealth;
  /** 0.1% origination fee on the new draw. Zero on a pooled borrow from the reserve. */
  originationFeeWei: bigint;
}

/**
 * What the position becomes if this borrow goes through.
 *
 * The fee is applied to the NEW draw only, and the 200 MUSD gas compensation is not
 * re-added: `position.debtWei` already carries both from when the trove was opened.
 * Grossing the whole principal up again would overstate the resulting debt and
 * understate the ratio — flattering in the wrong direction is still wrong.
 */
export function previewBorrow(
  position: Position,
  priceWei: bigint,
  amountWei: bigint,
): BorrowPreview {
  const originationFeeWei =
    position.route === 'pooled' ? 0n : (amountWei * BORROWING_RATE) / WAD;
  const debtWei = position.debtWei + amountWei + originationFeeWei;

  return {
    debtWei,
    collateralRatio: collateralRatio(position.collateralWei, debtWei, priceWei),
    liquidationPriceWei: liquidationPrice(position.collateralWei, debtWei),
    health: assessHealth(position.collateralWei, debtWei, priceWei),
    originationFeeWei,
  };
}

/**
 * The most collateral that can leave while the position stays at or above 180%.
 *
 * A debt-free position can withdraw everything; there is no ratio to protect.
 */
export function maxWithdrawable(position: Position, priceWei: bigint): bigint {
  if (position.debtWei === 0n) return position.collateralWei;

  const required =
    position.route === 'pooled'
      ? pooledCollateralRequiredFor(position.debtWei, priceWei, MAREN_POLICY.minHealthyCr)
      : collateralRequiredFor(
          position.principalWei,
          priceWei,
          MAREN_POLICY.minHealthyCr,
          BORROWING_RATE,
        );

  return position.collateralWei > required ? position.collateralWei - required : 0n;
}

/**
 * The collateral a DIRECT trove needs, at the recommended ratio, to clear the protocol's
 * 1,800 MUSD minimum net debt. This is the number that decides a user's route, and it is
 * the single largest constraint on who can use Mezo at all — around 0.079 BTC at $63k.
 */
export function directTroveThreshold(priceWei: bigint): bigint {
  return collateralRequiredFor(
    1_800n * WAD,
    priceWei,
    MAREN_POLICY.targetCr,
    BORROWING_RATE,
  );
}

/** The liquidation reserve a direct trove escrows at open and gets back on close. */
export const LIQUIDATION_RESERVE = MUSD_GAS_COMPENSATION;
