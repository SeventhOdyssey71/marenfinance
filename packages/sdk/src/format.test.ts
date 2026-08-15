import { describe, expect, it } from 'vitest';
import { MAREN_POLICY, WAD } from './constants';
import { MAX_CR, assessHealth, liquidationPrice } from './position';
import {
  DISPLAY_CEILING,
  EM_DASH,
  formatCollateralRatioOrDash,
  formatDropToLiquidation,
  formatLiquidationPrice,
  formatUsd,
  formatUsdOrDash,
  isDisplayable,
} from './format';

const musd = (n: number) => BigInt(n) * WAD;

/** BTC at $63,071.83, the live price read from Mezo's oracle on 2026-08-15. */
const PRICE = 63_071_830_000_000_000_000_000n;

/**
 * The no-debt display contract.
 *
 * These are regression tests for a live bug: an empty account rendered its liquidation
 * price as
 * $57,896,044,618,658,097,711,785,492,504,343,953,926,634,992,332,820,282,019,728.79,
 * which is MAX_CR (2^255 - 1) formatted as dollars. The root cause was an argument-order
 * bug in `liquidationPrice`; these tests cover the display layer, which must refuse to
 * print a meaningless figure even if the layer beneath it regresses again.
 *
 * The rule under test: when there is no debt, there is no liquidation price, and the
 * interface renders an em dash — never `$0.00`, and never a number.
 */
describe('no-debt positions render no numeric liquidation price', () => {
  it('renders an em dash for a brand-new account', () => {
    const health = assessHealth(0n, 0n, PRICE);
    expect(formatLiquidationPrice(health.liquidationPrice, 0n)).toBe(EM_DASH);
  });

  it('renders an em dash for collateral deposited but nothing borrowed', () => {
    const collateral = WAD / 2n; // 0.5 BTC, no debt
    const health = assessHealth(collateral, 0n, PRICE);
    expect(health.status).toBe('none');
    expect(formatLiquidationPrice(health.liquidationPrice, 0n)).toBe(EM_DASH);
  });

  it('renders no digit at all — not "$0.00", not "0"', () => {
    const rendered = formatLiquidationPrice(liquidationPrice(0n, 0n), 0n);
    expect(rendered).toBe(EM_DASH);
    expect(rendered).not.toMatch(/\d/);
    expect(rendered).not.toContain('$');
  });

  it('dashes the drop-to-liquidation readout too, rather than claiming 0%', () => {
    expect(formatDropToLiquidation(0, 0n)).toBe(EM_DASH);
    expect(formatDropToLiquidation(5_000, 0n)).toBe(EM_DASH);
  });

  it('dashes the collateral ratio rather than boasting an infinity symbol', () => {
    expect(formatCollateralRatioOrDash(MAX_CR, 0n)).toBe(EM_DASH);
  });

  it('still renders a real liquidation price once debt exists', () => {
    const collateral = WAD;
    const debt = musd(20_000);
    const rendered = formatLiquidationPrice(liquidationPrice(collateral, debt), debt);
    expect(rendered).not.toBe(EM_DASH);
    expect(rendered).toMatch(/^\$[\d,]+\.\d{2}$/);
  });

  it('still renders a real drop percentage once debt exists', () => {
    expect(formatDropToLiquidation(3_249, musd(20_000))).toBe('32%');
  });
});

/**
 * The ceiling. Nothing derived from a position may print an unbounded number, whatever
 * arrives from upstream — a sentinel, an overflow, or a future bug.
 */
describe('the display ceiling clamps anything unbounded to an em dash', () => {
  it('refuses the MAX_CR sentinel even when a caller claims there is debt', () => {
    expect(formatLiquidationPrice(MAX_CR, musd(1_000))).toBe(EM_DASH);
    expect(formatUsdOrDash(MAX_CR)).toBe(EM_DASH);
  });

  it('refuses anything at or above one trillion dollars a coin', () => {
    expect(formatUsdOrDash(DISPLAY_CEILING)).toBe(EM_DASH);
    expect(formatUsdOrDash(DISPLAY_CEILING + 1n)).toBe(EM_DASH);
    expect(isDisplayable(DISPLAY_CEILING)).toBe(false);
  });

  it('accepts every plausible Bitcoin price', () => {
    for (const price of [1n, WAD, PRICE, 10_000_000n * WAD]) {
      expect(isDisplayable(price)).toBe(true);
      expect(formatUsdOrDash(price)).toBe(formatUsd(price));
    }
  });

  it('never emits a string longer than a human can read', () => {
    // The bug shipped a 66-character figure into a two-column grid. Any derived USD
    // readout now fits a column at 390px.
    for (const wei of [MAX_CR, DISPLAY_CEILING, 2n ** 200n, 0n]) {
      expect(formatUsdOrDash(wei).length).toBeLessThanOrEqual(20);
    }
  });

  it('dashes null and undefined rather than printing "$NaN"', () => {
    expect(formatUsdOrDash(null)).toBe(EM_DASH);
    expect(formatUsdOrDash(undefined)).toBe(EM_DASH);
  });
});

/**
 * Numeric hazards from the JS side of the boundary. `priceDropToLiquidationBps` returns
 * a `number`, and a number can be `Infinity` or `NaN` in a way a bigint cannot.
 */
describe('Infinity and NaN never reach the screen wearing a unit', () => {
  it('dashes a non-finite drop rather than rendering "NaN%" or "Infinity%"', () => {
    const debt = musd(20_000);
    expect(formatDropToLiquidation(Number.NaN, debt)).toBe(EM_DASH);
    expect(formatDropToLiquidation(Number.POSITIVE_INFINITY, debt)).toBe(EM_DASH);
    expect(formatDropToLiquidation(Number.NEGATIVE_INFINITY, debt)).toBe(EM_DASH);
  });

  it('clamps a negative drop to 0% rather than a negative percentage', () => {
    expect(formatDropToLiquidation(-4_200, musd(20_000))).toBe('0%');
  });

  it('rounds the drop DOWN, never flattering the position', () => {
    // 32.99% of headroom must not display as 33%.
    expect(formatDropToLiquidation(3_299, musd(20_000))).toBe('32%');
  });
});

/**
 * A zero that IS a fact still renders as a number. The em dash means "does not apply",
 * and overusing it would hide real information — a wallet holding no MUSD holds
 * $0.00, and saying so is the point of a balance row.
 */
describe('measured zeroes are still rendered as numbers', () => {
  it('formats a genuine zero balance as $0.00 through formatUsd', () => {
    expect(formatUsd(0n)).toBe('$0.00');
  });

  it('renders a real ratio once debt exists', () => {
    const cr = MAREN_POLICY.targetCr;
    expect(formatCollateralRatioOrDash(cr, musd(1_000))).toBe('250.0%');
  });
});
