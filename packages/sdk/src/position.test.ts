import { describe, expect, it } from 'vitest';
import {
  MCR,
  MIN_NET_DEBT,
  MUSD_GAS_COMPENSATION,
  BORROWING_RATE,
  MAREN_POLICY,
  WAD,
} from './constants';
import {
  assessBorrowRoute,
  assessHealth,
  collateralRatio,
  collateralRequiredFor,
  liquidationPrice,
  marenLiquidationPrice,
  maxNetDebtAt,
  nominalCollateralRatio,
  priceDropToLiquidationBps,
  totalDebtFor,
  accruedInterest,
  MAX_CR,
} from './position';

/** BTC at $63,071.83, the live price read from Mezo's oracle on 2026-08-15. */
const PRICE = 63_071_830_000_000_000_000_000n;
const btc = (n: string) => BigInt(Math.round(parseFloat(n) * 1e6)) * 10n ** 12n;
const musd = (n: number) => BigInt(n) * WAD;

describe('collateralRatio', () => {
  it('computes a known ratio', () => {
    // 1 BTC at $63,071.83 against 31,535.915 MUSD of debt = exactly 200%
    const cr = collateralRatio(WAD, musd(31_535) + 915n * 10n ** 15n, PRICE);
    expect(cr).toBeGreaterThan(1_999_000_000_000_000_000n);
    expect(cr).toBeLessThan(2_001_000_000_000_000_000n);
  });

  it('returns MAX_CR for zero debt rather than dividing by zero', () => {
    expect(collateralRatio(WAD, 0n, PRICE)).toBe(MAX_CR);
  });

  it('rounds down, never up — a position must never look safer than it is', () => {
    // Construct a ratio with a truncated remainder and assert we lost it downward.
    const cr = collateralRatio(3n, 7n, WAD);
    expect(cr).toBe((3n * WAD) / 7n);
    expect(cr * 7n).toBeLessThanOrEqual(3n * WAD);
  });
});

describe('nominalCollateralRatio', () => {
  it('is price-independent and uses the 1e20 scale SortedTroves expects', () => {
    expect(nominalCollateralRatio(WAD, musd(1000))).toBe((WAD * 10n ** 20n) / musd(1000));
  });
});

describe('totalDebtFor', () => {
  it('adds the origination fee and the 200 MUSD gas compensation', () => {
    const net = musd(10_000);
    const total = totalDebtFor(net, BORROWING_RATE);
    // 0.1% of 10,000 = 10 MUSD fee, plus 200 gas comp
    expect(total).toBe(net + musd(10) + MUSD_GAS_COMPENSATION);
  });

  it('never understates debt — CR computed on net debt alone would flatter the user', () => {
    const net = musd(5_000);
    expect(totalDebtFor(net, BORROWING_RATE)).toBeGreaterThan(net);
  });
});

describe('liquidationPrice', () => {
  it('is the price at which ICR falls to exactly MCR', () => {
    const coll = WAD; // 1 BTC
    const debt = musd(20_000);
    const liq = liquidationPrice(coll, debt);
    const crAtLiq = collateralRatio(coll, debt, liq);
    // At the quoted liquidation price the position is at (or a hair above) MCR.
    expect(crAtLiq).toBeGreaterThanOrEqual(MCR);
  });

  it('rounds UP — quoting a liquidation price too low would cost a user their collateral', () => {
    const liq = liquidationPrice(3n, 7n);
    expect(liq * 3n).toBeGreaterThanOrEqual(7n * MCR);
  });

  it('returns zero when there is no debt', () => {
    expect(liquidationPrice(WAD, 0n)).toBe(0n);
  });

  it('never returns the MAX_CR sentinel for an empty account', () => {
    // Regression. The guards used to check collateral before debt, so a brand-new
    // wallet — no collateral, no debt — got MAX_CR back, and the dApp rendered it
    // literally as a $5.79e58 liquidation price next to "the protocol liquidates
    // below 110%". An empty account is at no risk, not infinite risk.
    expect(liquidationPrice(0n, 0n)).toBe(0n);
    expect(marenLiquidationPrice(0n, 0n)).toBe(0n);

    // And the value a UI would format must stay small enough to render.
    expect(liquidationPrice(0n, 0n)).toBeLessThan(MAX_CR);
  });

  it('still reports MAX_CR for the genuinely impossible case: debt with no collateral', () => {
    expect(liquidationPrice(0n, musd(100))).toBe(MAX_CR);
  });
});

describe('marenLiquidationPrice', () => {
  it('triggers strictly earlier than the protocol, because our threshold is 140% vs 110%', () => {
    const coll = WAD;
    const debt = musd(20_000);
    expect(marenLiquidationPrice(coll, debt)).toBeGreaterThan(liquidationPrice(coll, debt));
  });
});

describe('maxNetDebtAt and collateralRequiredFor round-trip', () => {
  it('collateral required for the max borrow reproduces the collateral', () => {
    const coll = btc('1.0');
    const maxNet = maxNetDebtAt(coll, PRICE, MAREN_POLICY.targetCr, BORROWING_RATE);
    const required = collateralRequiredFor(maxNet, PRICE, MAREN_POLICY.targetCr, BORROWING_RATE);
    // Round-trip must not require MORE collateral than we started with (allow 1 wei of rounding).
    expect(required).toBeLessThanOrEqual(coll + 1n);
  });

  it('borrowing the max at target CR lands at or above the target', () => {
    const coll = btc('1.0');
    const maxNet = maxNetDebtAt(coll, PRICE, MAREN_POLICY.targetCr, BORROWING_RATE);
    const cr = collateralRatio(coll, totalDebtFor(maxNet, BORROWING_RATE), PRICE);
    expect(cr).toBeGreaterThanOrEqual(MAREN_POLICY.targetCr - 10n ** 12n);
  });

  it('returns zero when collateral cannot even cover the gas compensation', () => {
    expect(maxNetDebtAt(1n, PRICE, MAREN_POLICY.targetCr, BORROWING_RATE)).toBe(0n);
  });

  it('rounds collateral requirements UP so we never under-quote', () => {
    const required = collateralRequiredFor(
      musd(1_800),
      PRICE,
      MAREN_POLICY.targetCr,
      BORROWING_RATE,
    );
    const totalDebt = totalDebtFor(musd(1_800), BORROWING_RATE);
    expect(required * PRICE).toBeGreaterThanOrEqual(totalDebt * MAREN_POLICY.targetCr);
  });
});

describe('assessBorrowRoute — the 1,800 MUSD minimum is the reason MarenVault exists', () => {
  it('routes a large holder to a direct trove', () => {
    const result = assessBorrowRoute(btc('1.0'), PRICE);
    expect(result).toEqual({ eligible: true, route: 'direct' });
  });

  it('routes a small holder to the pooled vault', () => {
    // 0.01 BTC ~= $630. Nowhere near the 1,800 MUSD minimum at any sane CR.
    const result = assessBorrowRoute(btc('0.01'), PRICE);
    expect(result).toEqual({ eligible: true, route: 'pooled' });
  });

  it('rejects a deposit below the 0.001 BTC floor and reports the shortfall', () => {
    const result = assessBorrowRoute(btc('0.0005'), PRICE);
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.shortfallWei).toBe(10n ** 15n - btc('0.0005'));
    }
  });

  it('the direct/pooled boundary sits near 0.079 BTC at $63k — the number we quote publicly', () => {
    // Just below the boundary -> pooled; well above -> direct.
    expect(assessBorrowRoute(btc('0.07'), PRICE)).toEqual({ eligible: true, route: 'pooled' });
    expect(assessBorrowRoute(btc('0.09'), PRICE)).toEqual({ eligible: true, route: 'direct' });
  });

  it('the boundary collateral really does correspond to the protocol minimum', () => {
    const required = collateralRequiredFor(
      MIN_NET_DEBT,
      PRICE,
      MAREN_POLICY.targetCr,
      BORROWING_RATE,
    );
    // ~0.0793 BTC. Assert the public "~0.079 BTC" claim is honest to 3 decimal places.
    expect(required).toBeGreaterThan(btc('0.078'));
    expect(required).toBeLessThan(btc('0.080'));
  });
});

describe('assessHealth', () => {
  const coll = btc('1.0');

  it('reports no position when there is no debt', () => {
    expect(assessHealth(coll, 0n, PRICE).status).toBe('none');
  });

  it('classifies a 250% position as healthy and borrowable', () => {
    const debt = (coll * PRICE) / MAREN_POLICY.targetCr;
    const h = assessHealth(coll, debt, PRICE);
    expect(h.status).toBe('healthy');
    expect(h.canBorrow).toBe(true);
  });

  it('blocks further borrowing below 180%', () => {
    const debt = (coll * PRICE) / 1_700_000_000_000_000_000n; // 170%
    const h = assessHealth(coll, debt, PRICE);
    expect(h.canBorrow).toBe(false);
  });

  it('escalates through caution, warning, danger, liquidatable', () => {
    const at = (cr: bigint) => assessHealth(coll, (coll * PRICE) / cr, PRICE).status;
    expect(at(1_700_000_000_000_000_000n)).toBe('caution'); // 170%, below 180
    expect(at(1_500_000_000_000_000_000n)).toBe('warning'); // 150%, below 160
    expect(at(1_200_000_000_000_000_000n)).toBe('danger'); // 120%, below 140
    expect(at(1_050_000_000_000_000_000n)).toBe('liquidatable'); // 105%, below MCR
  });

  it('never reports healthy for a position the protocol could liquidate', () => {
    const debt = (coll * PRICE) / (MCR - 1n);
    expect(assessHealth(coll, debt, PRICE).status).toBe('liquidatable');
  });
});

describe('priceDropToLiquidationBps', () => {
  it('is 0 for a position already at or past liquidation', () => {
    const coll = btc('1.0');
    const debt = (coll * PRICE) / MCR;
    expect(priceDropToLiquidationBps(coll, debt, PRICE)).toBe(0);
  });

  it('a 250% position tolerates roughly a 56% drop', () => {
    const coll = btc('1.0');
    const debt = (coll * PRICE) / MAREN_POLICY.targetCr;
    const bps = priceDropToLiquidationBps(coll, debt, PRICE);
    expect(bps).toBeGreaterThan(5_500);
    expect(bps).toBeLessThan(5_700);
  });
});

describe('accruedInterest — MUSD is simple, not compounding', () => {
  it('accrues 1% of principal over a year at 100 bps', () => {
    const principal = musd(10_000);
    const year = 365 * 24 * 60 * 60;
    const interest = accruedInterest(principal, 100, year);
    expect(interest).toBe(musd(100));
  });

  it('is linear in time — two years is exactly twice one year, not more', () => {
    const principal = musd(10_000);
    const year = 365 * 24 * 60 * 60;
    expect(accruedInterest(principal, 100, year * 2)).toBe(
      accruedInterest(principal, 100, year) * 2n,
    );
  });

  it('is zero for zero elapsed time', () => {
    expect(accruedInterest(musd(10_000), 100, 0)).toBe(0n);
  });
});
