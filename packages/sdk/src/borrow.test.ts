import { describe, expect, it } from 'vitest';

import { BORROWING_RATE, MAREN_POLICY, MUSD_GAS_COMPENSATION, WAD } from './constants';
import { accruedInterest, collateralRatio, maxNetDebtAt, totalDebtFor } from './position';
import {
  borrowCeiling,
  directTroveThreshold,
  maxWithdrawable,
  previewBorrow,
  recommendedBorrow,
  type BorrowPosition,
} from './borrow';

/** BTC at $63,071.83, the live price read from Mezo's oracle on 2026-08-15. */
const PRICE = 63_071_830_000_000_000_000_000n;

const DAY = 24 * 60 * 60;

/**
 * A direct trove that has been open long enough to accrue interest. The accrual is the
 * whole point: every bug this suite guards against comes from working off `principalWei`
 * and silently dropping it.
 */
function directPosition(): BorrowPosition {
  const principalWei = 12_000n * WAD;
  const interestWei = accruedInterest(principalWei, 100, 214 * DAY);
  // Composed exactly as the apps compose it: principal + origination fee + accrued
  // interest + the 200 MUSD gas compensation.
  const originationFeeWei = (principalWei * BORROWING_RATE) / WAD;
  return {
    collateralWei: WAD / 2n, // 0.5 BTC
    principalWei,
    debtWei: principalWei + originationFeeWei + interestWei + MUSD_GAS_COMPENSATION,
    maxBorrowingCapacityWei: 40_000n * WAD, // far away, so the ratio binds
    route: 'direct',
  };
}

/** The accrued interest carried by `directPosition()` — the term every bug here drops. */
const ACCRUED_INTEREST = accruedInterest(12_000n * WAD, 100, 214 * DAY);

describe('borrowCeiling', () => {
  it('never quotes a draw that lands below Maren’s 180% floor', () => {
    const position = directPosition();
    const { amountWei } = borrowCeiling(position, PRICE);

    const after = previewBorrow(position, PRICE, amountWei);
    expect(after.collateralRatio).toBeGreaterThanOrEqual(MAREN_POLICY.minHealthyCr);
  });

  /**
   * THE REGRESSION THIS MODULE EXISTS FOR.
   *
   * The iOS vault screen used to compute its ceiling as
   * `maxNetDebtAt(collateral, price, minHealthyCr, rate) - principalWei`. That sizes a
   * trove being OPENED, so against an existing position it ignores accrued interest and
   * over-quotes the maximum. Drawing the over-quoted amount lands the user BELOW the
   * 180% floor, where `MarenVault.MIN_BORROW_CR` reverts.
   *
   * This test pins both halves: the naive figure is genuinely unsafe, and the shared
   * implementation is genuinely safe. If someone reintroduces the shortcut, this fails.
   */
  it('is strictly more conservative than the naive open-a-trove formula', () => {
    const position = directPosition();

    const naive =
      maxNetDebtAt(position.collateralWei, PRICE, MAREN_POLICY.minHealthyCr, BORROWING_RATE) -
      position.principalWei;
    const correct = borrowCeiling(position, PRICE).amountWei;

    expect(naive).toBeGreaterThan(correct);

    // The naive quote is unsafe: drawing it puts the REAL position — the one carrying
    // accrued interest — below the floor the quote claims to respect.
    const naiveCr = previewBorrow(position, PRICE, naive).collateralRatio;
    expect(naiveCr).toBeLessThan(MAREN_POLICY.minHealthyCr);

    // The gap is exactly the interest the naive formula forgot, net of the fee it would
    // have charged on that much extra draw.
    const gap = naive - correct;
    expect(gap).toBeGreaterThan((ACCRUED_INTEREST * 99n) / 100n);
    expect(gap).toBeLessThanOrEqual(ACCRUED_INTEREST);
  });

  it('lets Mezo’s per-trove ceiling bind when it is the smaller limit', () => {
    const position = { ...directPosition(), maxBorrowingCapacityWei: 12_100n * WAD };
    const ceiling = borrowCeiling(position, PRICE);

    expect(ceiling.binding).toBe('ceiling');
    expect(ceiling.amountWei).toBe(100n * WAD);
  });

  it('reports no headroom rather than a negative one', () => {
    const position = { ...directPosition(), collateralWei: WAD / 100n };
    const ceiling = borrowCeiling(position, PRICE);

    expect(ceiling.amountWei).toBe(0n);
    expect(ceiling.binding).toBe('none');
  });

  it('prefers the vault’s own answer on the pooled route', () => {
    const position: BorrowPosition = {
      ...directPosition(),
      route: 'pooled',
      vaultMaxBorrowableWei: 42n * WAD,
    };

    expect(borrowCeiling(position, PRICE).ratioHeadroomWei).toBe(42n * WAD);
  });
});

describe('recommendedBorrow', () => {
  it('lands the position on the 250% target, not merely near it', () => {
    const position = directPosition();
    const ceiling = borrowCeiling(position, PRICE).amountWei;
    const recommended = recommendedBorrow(position, PRICE, ceiling);

    const after = previewBorrow(position, PRICE, recommended);

    // Within a wei-rounding of the target, and never under it.
    expect(after.collateralRatio).toBeGreaterThanOrEqual(MAREN_POLICY.targetCr);
    expect(after.collateralRatio - MAREN_POLICY.targetCr).toBeLessThan(WAD / 1_000n);
  });

  it('never exceeds the hard ceiling', () => {
    const position = { ...directPosition(), maxBorrowingCapacityWei: 12_050n * WAD };
    const ceiling = borrowCeiling(position, PRICE).amountWei;

    expect(recommendedBorrow(position, PRICE, ceiling)).toBeLessThanOrEqual(ceiling);
  });
});

describe('previewBorrow', () => {
  it('charges the origination fee on the new draw only, never on the whole principal', () => {
    const position = directPosition();
    const draw = 1_000n * WAD;
    const preview = previewBorrow(position, PRICE, draw);

    expect(preview.originationFeeWei).toBe((draw * BORROWING_RATE) / WAD);
    expect(preview.debtWei).toBe(position.debtWei + draw + preview.originationFeeWei);
  });

  it('does not re-add the 200 MUSD gas compensation already carried by the position', () => {
    const position = directPosition();
    const preview = previewBorrow(position, PRICE, 0n);

    expect(preview.debtWei).toBe(position.debtWei);
  });

  it('charges no origination fee on a pooled draw from the reserve', () => {
    const position: BorrowPosition = { ...directPosition(), route: 'pooled' };
    const preview = previewBorrow(position, PRICE, 1_000n * WAD);

    expect(preview.originationFeeWei).toBe(0n);
  });
});

describe('maxWithdrawable', () => {
  it('returns the whole balance when there is no debt to protect', () => {
    const position: BorrowPosition = {
      ...directPosition(),
      debtWei: 0n,
      principalWei: 0n,
    };

    expect(maxWithdrawable(position, PRICE)).toBe(position.collateralWei);
  });

  it('leaves the position at or above the 180% floor', () => {
    const position = directPosition();
    const out = maxWithdrawable(position, PRICE);
    const remaining = position.collateralWei - out;

    expect(collateralRatio(remaining, position.debtWei, PRICE)).toBeGreaterThanOrEqual(
      MAREN_POLICY.minHealthyCr,
    );
  });
});

describe('directTroveThreshold', () => {
  it('is the ~0.079 BTC that gates access to a direct trove', () => {
    const required = directTroveThreshold(PRICE);

    // 0.0785 – 0.0795 BTC at this price. The headline number in the thesis.
    expect(required).toBeGreaterThan((785n * WAD) / 10_000n);
    expect(required).toBeLessThan((795n * WAD) / 10_000n);
  });
});
