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
 * Web imports these helpers; the native Swift counterpart is pinned by matching regression cases.
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
   * Entire principal + interest, including pending redistribution, for the USER's
   * trove on the direct route, the WHOLE POOLED TROVE on the pooled route.
   *
   * This is the figure Mezo actually checks the ceiling against, and it is not
   * `principalWei`: it includes the 200 MUSD gas compensation and all accrued interest.
   * On the pooled route it belongs to every depositor at once, not to this user.
   */
  troveTotalDebtWei?: bigint;
  /** Shared reserve already borrowed by the pool: this portion creates no protocol debt. */
  reserveMusdWei?: bigint;
  /** Collateral actually in the shared trove; idle user deposits cannot back its ICR. */
  troveCollateralWei?: bigint;
  /** Current protocol origination rate, WAD. Defaults to the configured testnet rate. */
  borrowingRateWei?: bigint;
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
function feeRate(position: BorrowPosition): bigint {
  return position.borrowingRateWei ?? BORROWING_RATE;
}

/** Invert debt added, charging the fee only on the portion beyond a pooled reserve. */
function drawForDebtBudget(position: BorrowPosition, budget: bigint): bigint {
  if (budget <= 0n) return 0n;
  const reserve = position.route === 'pooled' ? (position.reserveMusdWei ?? 0n) : 0n;
  if (budget <= reserve) return budget;
  return reserve + ((budget - reserve) * WAD) / (WAD + feeRate(position));
}

function headroomAt(position: BorrowPosition, priceWei: bigint, targetCr: bigint): bigint {
  if (targetCr <= 0n || priceWei <= 0n || feeRate(position) < 0n) return 0n;
  const debtAllowed = (position.collateralWei * priceWei) / targetCr;
  return drawForDebtBudget(position, debtAllowed - position.debtWei);
}

export interface BorrowCeiling {
  /** The most MUSD this user may draw right now. The slider's hard stop. */
  amountWei: bigint;
  /** Which limit produced it — the one to name in the interface. */
  binding: 'ratio' | 'ceiling' | 'pool' | 'unavailable' | 'none';
  /** Headroom under Maren's 180% floor alone. */
  ratioHeadroomWei: bigint;
  /** Headroom under Mezo's per-trove ceiling alone. */
  mezoHeadroomWei: bigint;
  /** Additional draw allowed by the pooled trove’s 180% floor. */
  poolHeadroomWei?: bigint;
}

/**
 * The hard stop for the borrow control.
 *
 * User and pooled-trove 180% floors bind independently alongside Mezo's
 * per-trove `maxBorrowingCapacity` — which is fixed at the price the trove opened at and
 * does not move when collateral is added. Quoting only the first is how a borrow ends in
 * an opaque revert.
 */
export function borrowCeiling(position: BorrowPosition, priceWei: bigint): BorrowCeiling {
  const unavailable = (): BorrowCeiling => ({
    amountWei: 0n,
    binding: 'unavailable',
    ratioHeadroomWei: 0n,
    mezoHeadroomWei: 0n,
  });
  if (priceWei <= 0n || feeRate(position) < 0n || position.route === 'none') return unavailable();
  const pooled = position.route === 'pooled';
  // A user's debt is not a substitute for the debt owed by the entire pool.
  if (
    pooled &&
    (position.troveTotalDebtWei === undefined ||
      position.reserveMusdWei === undefined ||
      position.troveCollateralWei === undefined)
  )
    return unavailable();
  const reserve = pooled ? position.reserveMusdWei! : 0n;
  const troveDebt = position.troveTotalDebtWei ?? position.debtWei;
  if (reserve < 0n || troveDebt < 0n) return unavailable();
  const ratioHeadroomWei =
    pooled && position.vaultMaxBorrowableWei !== undefined
      ? drawForDebtBudget(position, position.vaultMaxBorrowableWei)
      : headroomAt(position, priceWei, MAREN_POLICY.minHealthyCr);
  const rawCapacity =
    position.maxBorrowingCapacityWei > troveDebt
      ? position.maxBorrowingCapacityWei - troveDebt
      : 0n;
  const mezoHeadroomWei = reserve + (rawCapacity * WAD) / (WAD + feeRate(position));
  let amountWei = ratioHeadroomWei < mezoHeadroomWei ? ratioHeadroomWei : mezoHeadroomWei;
  let binding: BorrowCeiling['binding'] =
    amountWei === 0n ? 'none' : ratioHeadroomWei <= mezoHeadroomWei ? 'ratio' : 'ceiling';
  let poolHeadroomWei: bigint | undefined;
  if (pooled) {
    const poolDebtAllowed = (position.troveCollateralWei! * priceWei) / MAREN_POLICY.minHealthyCr;
    // The contract checks pooled ICR even when all funds come out of the existing reserve.
    poolHeadroomWei =
      poolDebtAllowed < troveDebt
        ? 0n
        : reserve + ((poolDebtAllowed - troveDebt) * WAD) / (WAD + feeRate(position));
    if (poolHeadroomWei < amountWei || poolDebtAllowed < troveDebt) {
      amountWei = poolHeadroomWei;
      binding = 'pool';
    }
  }
  return {
    amountWei,
    binding,
    ratioHeadroomWei,
    mezoHeadroomWei,
    ...(poolHeadroomWei === undefined ? {} : { poolHeadroomWei }),
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
  const reserve = position.route === 'pooled' ? (position.reserveMusdWei ?? 0n) : 0n;
  const freshDraw = amountWei > reserve ? amountWei - reserve : 0n;
  const originationFeeWei = (freshDraw * feeRate(position)) / WAD;
  const debtWei = position.debtWei + amountWei + originationFeeWei;
  const health = assessHealth(position.collateralWei, debtWei, priceWei);
  if (position.route === 'pooled') {
    health.liquidationPrice =
      position.collateralWei > 0n
        ? (debtWei * MAREN_POLICY.vaultLiquidationCr + position.collateralWei - 1n) /
          position.collateralWei
        : 0n;
    health.priceDropToLiquidationBps =
      debtWei === 0n
        ? 10_000
        : priceWei <= health.liquidationPrice
          ? 0
          : Number(((priceWei - health.liquidationPrice) * 10_000n) / priceWei);
    if (debtWei > 0n && health.collateralRatio < MAREN_POLICY.vaultLiquidationCr)
      health.status = 'liquidatable';
  }

  return {
    debtWei,
    collateralRatio: collateralRatio(position.collateralWei, debtWei, priceWei),
    liquidationPriceWei: health.liquidationPrice,
    health,
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
