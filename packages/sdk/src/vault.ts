import { BORROWING_RATE, MAREN_POLICY, MAREN_VAULT } from './constants';
import { directTroveThreshold } from './borrow';
import { assessBorrowRoute } from './position';

/**
 * The social vault, as arithmetic.
 *
 * MarenVault is one MUSD trove that many people share. Everything a screen needs to say
 * about it that is not a single contract read lives here: how full it is against its own
 * `depositCap`, how much of it belongs to one depositor, and which of the two ways into
 * MUSD a given amount of Bitcoin can actually take.
 *
 * WHY THIS IS NOT IN THE APP. The route decision was already being made in three places
 * with three shapes — the deposit form's "route after" row, the pooled-position card, and
 * the borrow panel — each calling `assessBorrowRoute` and `directTroveThreshold` and
 * assembling its own sentence. A fourth caller would have been a fourth chance to quote a
 * different threshold. There is one implementation, and it is this one.
 *
 * ROUNDING. Percentages are returned as INTEGER TENTHS of a percent and are truncated,
 * never rounded to nearest. A vault at 99.97% of its cap reports 99.9%, and a share of
 * 0.04% reports 0.0%. Truncation is the conservative direction for a share (never
 * flatter someone's stake) and the honest one for a fill bar, which is read as "how much
 * room is left" and must not reach the end before the cap does.
 */

/** The two ways to hold MUSD debt against Bitcoin on Mezo. */
export type VaultRoute = 'own-trove' | 'social-vault';

export interface RouteChoice {
  /** The route this much collateral can actually take today. */
  recommended: VaultRoute;
  /** The collateral the choice was made against. */
  collateralWei: bigint;
  /** Collateral a trove of your own needs at the recommended ratio. */
  ownTroveFromWei: bigint;
  /** `MarenVault.MIN_DEPOSIT`, the social vault's floor. */
  socialVaultFromWei: bigint;
  /** Collateral still missing for a trove of your own. Zero once it is reachable. */
  shortfallWei: bigint;
  /** True when the amount clears neither minimum, so there is no route at all. */
  belowBothMinimums: boolean;
}

/**
 * Which route this much Bitcoin can take, with both thresholds beside it.
 *
 * Returns `null` without a live price rather than a route computed from zero. Every
 * figure in the answer is priced, and a threshold of "0 BTC" rendered next to "your own
 * trove" would be an invitation to try something that reverts.
 *
 * The decision itself is `assessBorrowRoute`'s, not a second opinion: this function adds
 * the thresholds and the shortfall a screen has to state, and nothing else.
 */
export function chooseVaultRoute(collateralWei: bigint, priceWei: bigint): RouteChoice | null {
  if (priceWei <= 0n) return null;

  const ownTroveFromWei = directTroveThreshold(priceWei);
  const assessment = assessBorrowRoute(
    collateralWei,
    priceWei,
    MAREN_POLICY.targetCr,
    BORROWING_RATE,
  );

  const recommended: VaultRoute =
    assessment.eligible && assessment.route === 'direct' ? 'own-trove' : 'social-vault';

  return {
    recommended,
    collateralWei,
    ownTroveFromWei,
    socialVaultFromWei: MAREN_VAULT.minDeposit,
    shortfallWei: collateralWei >= ownTroveFromWei ? 0n : ownTroveFromWei - collateralWei,
    belowBothMinimums: collateralWei < MAREN_VAULT.minDeposit,
  };
}

export interface VaultCapacity {
  /** `MarenVault.totalCollateral()`. */
  usedWei: bigint;
  /** `MarenVault.depositCap()`. */
  capWei: bigint;
  /** Room left under the cap, floored at zero. */
  headroomWei: bigint;
  /** Capacity used, in TENTHS of a percent, truncated. 137 is 13.7%. */
  filledTenths: number;
  /** True when the room left cannot fit even a minimum deposit, so no deposit succeeds. */
  full: boolean;
}

/**
 * How full the social vault is.
 *
 * `full` is the same condition `preflightDeposit` blocks on, expressed once: the cap is
 * reached for practical purposes as soon as the headroom drops under `MIN_DEPOSIT`, not
 * when it reaches zero, because every deposit between those two points reverts.
 *
 * A cap of zero reports 100% and full. That is the fail-closed reading: a vault that
 * cannot say what its cap is has no room to offer.
 */
export function vaultCapacity(usedWei: bigint, capWei: bigint): VaultCapacity {
  const headroomWei = capWei > usedWei ? capWei - usedWei : 0n;
  const raw = capWei === 0n ? 1000n : (usedWei * 1000n) / capWei;
  const filledTenths = raw > 1000n ? 1000n : raw;

  return {
    usedWei,
    capWei,
    headroomWei,
    filledTenths: Number(filledTenths),
    full: headroomWei < MAREN_VAULT.minDeposit,
  };
}

/**
 * One depositor's share of the pooled collateral, in TENTHS of a percent, truncated.
 *
 * Measured against `MarenVault.totalCollateral()` rather than the trove's collateral:
 * the two differ by whatever is sitting idle after a deposit the keeper has not pushed
 * yet, and the credited total is the one the user's own balance is part of.
 */
export function vaultShareTenths(collateralWei: bigint, vaultCollateralWei: bigint): number {
  if (collateralWei <= 0n || vaultCollateralWei <= 0n) return 0;
  const raw = (collateralWei * 1000n) / vaultCollateralWei;
  return Number(raw > 1000n ? 1000n : raw);
}
