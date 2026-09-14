import {
  BORROWING_RATE,
  MAREN_POLICY,
  MIN_NET_DEBT,
  MUSD_GAS_COMPENSATION,
  WAD,
} from './constants';
import {
  assessHealth,
  collateralRatio,
  collateralRequiredFor,
  liquidationPrice,
  type PositionHealth,
} from './position';

/**
 * Borrow-route arithmetic for an EXISTING position.
 *
 * `position.ts` sizes a trove being opened. This module answers the different question
 * every borrow screen actually asks: given a position that already exists and has already
 * accrued interest, how much more can it draw, and what does it become if it does?
 *
 * Nothing here re-implements a collateral ratio, a liquidation price or a formatter —
 * those live beside it in this package and are shared with the contracts' own test
 * vectors. What this module does is compose them for the two routes, which genuinely
 * differ:
 *
 *   DIRECT — the user's own trove. Debt carries the 0.1% origination fee and the 200 MUSD
 *            gas compensation, so `collateralRequiredFor` / `maxNetDebtAt` apply exactly
 *            as written.
 *   POOLED — a share of MarenVault's trove. There is one gas compensation for the whole
 *            trove, already paid by the protocol's seed position, and a borrow served
 *            from the vault's MUSD reserve pays no origination fee. Applying the direct
 *            formulas would over-quote every pooled user by 200 MUSD of collateral they
 *            do not owe.
 *
 * That asymmetry is deliberate on all sides: see the counterpart comments on
 * `collateralRequiredFor` in `./position.ts` and `MarenVault.collateralRequiredForDebt`
 * in `packages/contracts/src/MarenVault.sol`. If you change one, change all three.
 *
 * This lives in the SDK rather than in an app because it was previously implemented twice
 * — once here (as `apps/web/src/lib/vault.ts`) and once inline in the iOS vault screen,
 * where the second copy worked from `principalWei` and so ignored accrued interest. That
 * over-quoted the maximum borrow and put the slider's "180% floor" stop below the floor.
 * One implementation, imported by both apps, is the fix.
 */

/**
 * The minimum shape this module needs. Both apps' `Position` satisfies it structurally,
 * so neither has to convert. Kept deliberately narrow: it is the money-bearing subset.
 */
export interface BorrowPosition {
  /** BTC collateral, 1e18. */
  collateralWei: bigint;
  /** TOTAL debt: principal + accrued interest + gas compensation. CR is computed on this. */
  debtWei: bigint;
  /** Net principal drawn, excluding fee and gas compensation. */
  principalWei: bigint;
  /** Mezo's per-trove ceiling, fixed at the price the trove opened at. */
  maxBorrowingCapacityWei: bigint;
  /** 'direct' = the user's own trove. 'pooled' = a share of MarenVault's trove. */
  route: 'direct' | 'pooled' | 'none';
  /** `MarenVault.maxBorrowable`, when the pooled route has been read from chain. */
  vaultMaxBorrowableWei?: bigint;
  /**
   * `TroveManager.getTroveDebt()` for the trove this position draws against — the USER's
   * trove on the direct route, the WHOLE POOLED TROVE on the pooled route.
   *
   * This is the figure Mezo actually checks the ceiling against, and it is not
   * `principalWei`: it includes the 200 MUSD gas compensation and all accrued interest.
   * On the pooled route it belongs to every depositor at once, not to this user.
   */
  troveTotalDebtWei?: bigint;
}

/**
 * The collateral a position needs to hold `debtWei` at `targetCr`, taking TOTAL debt and
 * grossing nothing up.
 *
 * Use this — not `collateralRequiredFor` — whenever the debt already exists. That
 * function takes NET debt and reconstructs the total by adding the origination fee and
 * the 200 MUSD gas compensation, which is right for a trove being opened and wrong for
 * one that has been open long enough to accrue interest: the reconstruction silently
 * drops the accrued interest, under-reserving collateral by exactly that amount.
 */
export function collateralRequiredForTotalDebt(
  debtWei: bigint,
  priceWei: bigint,
  targetCr: bigint,
) {
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
function headroomAt(position: BorrowPosition, priceWei: bigint, targetCr: bigint): bigint {
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
export function borrowCeiling(position: BorrowPosition, priceWei: bigint): BorrowCeiling {
  /**
   * On the pooled route the contract answers this itself — `MarenVault.maxBorrowable`
   * is the same 180% calculation done on-chain against the same ledger, so we use its
   * number rather than a second opinion that could disagree with it by a wei.
   */
  const ratioHeadroomWei =
    position.route === 'pooled'
      ? (position.vaultMaxBorrowableWei ??
        headroomAt(position, priceWei, MAREN_POLICY.minHealthyCr))
      : headroomAt(position, priceWei, MAREN_POLICY.minHealthyCr);

  /**
   * Mezo checks `maxBorrowingCapacity >= netDebtChange + getTroveDebt(borrower)`
   * (BorrowerOperations `_requireHasBorrowingCapacity`), where `netDebtChange` is the draw
   * PLUS its origination fee. So two corrections against the obvious formula:
   *
   * 1. Subtract the trove's TOTAL debt, not the user's drawn principal. Total debt carries
   *    the 200 MUSD gas compensation and accrued interest, and on the pooled route it is
   *    the whole shared trove's debt rather than this user's slice — comparing a trove-wide
   *    ceiling against one user's balance is a category error that makes the ceiling
   *    effectively unbounded.
   * 2. Divide out the fee, because the protocol adds it to the draw before comparing.
   *    Quoting a gross number means the last MUSD of the range always reverts.
   *
   * Measured on matsnet before this fix: `maxBorrowable()` quoted 1,556.98 MUSD for a
   * position whose true limit simulated at 834.68 — the button labelled "Max" reverted by
   * construction. `troveTotalDebtWei` is optional only so an unmigrated caller still
   * compiles; when it is absent the ceiling falls back to the conservative direction by
   * using total debt from `debtWei`, never the old under-subtraction.
   */
  const troveDebtWei = position.troveTotalDebtWei ?? position.debtWei;
  const rawHeadroomWei =
    position.maxBorrowingCapacityWei > troveDebtWei
      ? position.maxBorrowingCapacityWei - troveDebtWei
      : 0n;
  // The pooled route draws through MarenVault, which pays no origination fee on the
  // reserve-served portion; the direct route always pays it. Gross down only where charged.
  const mezoHeadroomWei =
    position.route === 'pooled' ? rawHeadroomWei : (rawHeadroomWei * WAD) / (WAD + BORROWING_RATE);

  const amountWei = ratioHeadroomWei < mezoHeadroomWei ? ratioHeadroomWei : mezoHeadroomWei;

  return {
    amountWei,
    binding: amountWei === 0n ? 'none' : ratioHeadroomWei <= mezoHeadroomWei ? 'ratio' : 'ceiling',
    ratioHeadroomWei,
    mezoHeadroomWei,
  };
}

/** Where the recommended 250% target sits on the slider's track. */
export function recommendedBorrow(
  position: BorrowPosition,
  priceWei: bigint,
  ceiling: bigint,
): bigint {
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
  position: BorrowPosition,
  priceWei: bigint,
  amountWei: bigint,
): BorrowPreview {
  const originationFeeWei = position.route === 'pooled' ? 0n : (amountWei * BORROWING_RATE) / WAD;
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
 *
 * Both routes reserve against `position.debtWei` — the TOTAL debt — because a withdrawal
 * creates no new debt and so incurs no origination fee on either route. The direct branch
 * used to call `collateralRequiredFor(position.principalWei, …)`, which rebuilds a total
 * from the NET principal by adding the fee and the 200 MUSD gas compensation. That
 * reconstruction silently omits accrued interest, so it under-reserved collateral and
 * quoted a maximum withdrawal that left the position BELOW the 180% floor it claims to
 * respect — 179.14% on a position 214 days old. Regression-tested in `borrow.test.ts`.
 */
export function maxWithdrawable(position: BorrowPosition, priceWei: bigint): bigint {
  if (position.debtWei === 0n) return position.collateralWei;

  const required = collateralRequiredForTotalDebt(
    position.debtWei,
    priceWei,
    MAREN_POLICY.minHealthyCr,
  );

  return position.collateralWei > required ? position.collateralWei - required : 0n;
}

/**
 * The collateral a DIRECT trove needs, at the recommended ratio, to clear the protocol's
 * 1,800 MUSD minimum net debt. This is the number that decides a user's route, and it is
 * the single largest constraint on who can use Mezo at all — around 0.079 BTC at $63k.
 */
export function directTroveThreshold(priceWei: bigint): bigint {
  return collateralRequiredFor(MIN_NET_DEBT, priceWei, MAREN_POLICY.targetCr, BORROWING_RATE);
}

/** The liquidation reserve a direct trove escrows at open and gets back on close. */
export const LIQUIDATION_RESERVE = MUSD_GAS_COMPENSATION;
