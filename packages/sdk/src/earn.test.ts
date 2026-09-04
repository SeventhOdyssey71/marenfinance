import { describe, expect, it } from 'vitest';

import { WAD } from './constants';
import { MIN_ANNUALISE_DAYS, MIN_ANNUALISE_EVENTS, realisedYield, valueBtcInMusd } from './earn';

/**
 * The Earn math, tested against the honesty rules it exists to enforce.
 *
 * The cases that matter most here are the ones that must NOT produce a number: an empty
 * window, no base, a single lumpy event. A regression that turned any of those into a
 * confident percentage is exactly the failure this whole feature is built to avoid.
 */

describe('valueBtcInMusd', () => {
  it('values BTC at the oracle price with floor division, matching the contract', () => {
    // 0.5 BTC at $60,000 -> 30,000 MUSD.
    const half = WAD / 2n;
    const price = 60_000n * WAD;
    expect(valueBtcInMusd(half, price)).toBe(30_000n * WAD);
  });

  it('returns zero for a zero price, the contract-safe understatement rather than a throw', () => {
    expect(valueBtcInMusd(WAD, 0n)).toBe(0n);
  });

  it('returns zero for a zero amount', () => {
    expect(valueBtcInMusd(0n, 60_000n * WAD)).toBe(0n);
  });
});

describe('realisedYield — insufficient data returns null, never a misleading zero', () => {
  it('is null with no base to divide by', () => {
    expect(
      realisedYield({ realisedWei: 100n * WAD, baseWei: 0n, windowDays: 90, events: 3 }),
    ).toBeNull();
  });

  it('is null with a zero-length window', () => {
    expect(
      realisedYield({ realisedWei: 0n, baseWei: 1_000n * WAD, windowDays: 0, events: 0 }),
    ).toBeNull();
  });

  it('is null for the today case: never deposited, nothing observed', () => {
    expect(realisedYield({ realisedWei: 0n, baseWei: 0n, windowDays: 0, events: 0 })).toBeNull();
  });

  it('rejects a negative realised figure as nonsense input', () => {
    expect(
      realisedYield({ realisedWei: -1n, baseWei: 1_000n * WAD, windowDays: 90, events: 1 }),
    ).toBeNull();
  });
});

describe('realisedYield — a measured window of zero gain is honestly zero', () => {
  it('reports ratio 0, not null, when a real window saw no liquidations', () => {
    const out = realisedYield({
      realisedWei: 0n,
      baseWei: 1_000n * WAD,
      windowDays: 90,
      events: 0,
    });
    expect(out).not.toBeNull();
    expect(out?.ratio).toBe(0);
    // Zero events, so still not annualisable even though the window is long enough.
    expect(out?.annualisable).toBe(false);
    expect(out?.annualisedRatio).toBeNull();
  });
});

describe('realisedYield — a single lumpy event is reported but never annualised', () => {
  it('gives the period ratio but withholds a yearly rate', () => {
    // 12 MUSD realised on a 1,200 MUSD base over 40 days, from one liquidation.
    const out = realisedYield({
      realisedWei: 12n * WAD,
      baseWei: 1_200n * WAD,
      windowDays: 40,
      events: 1,
    });
    expect(out).not.toBeNull();
    expect(out?.ratio).toBeCloseTo(0.01, 9); // 1% over the window
    expect(out?.annualisable).toBe(false); // one event < MIN_ANNUALISE_EVENTS
    expect(out?.annualisedRatio).toBeNull();
  });

  it('also withholds when there are enough events but the window is too short', () => {
    const out = realisedYield({
      realisedWei: 5n * WAD,
      baseWei: 1_000n * WAD,
      windowDays: MIN_ANNUALISE_DAYS - 1,
      events: MIN_ANNUALISE_EVENTS + 2,
    });
    expect(out?.annualisable).toBe(false);
    expect(out?.annualisedRatio).toBeNull();
  });
});

describe('realisedYield — a long, event-rich window is defensibly annualised', () => {
  it('scales the period ratio to a year once both thresholds are met', () => {
    // 30 MUSD on a 1,000 MUSD base over 90 days, across several liquidations.
    const out = realisedYield({
      realisedWei: 30n * WAD,
      baseWei: 1_000n * WAD,
      windowDays: 90,
      events: MIN_ANNUALISE_EVENTS,
    });
    expect(out?.ratio).toBeCloseTo(0.03, 9); // 3% over 90 days
    expect(out?.annualisable).toBe(true);
    expect(out?.annualisedRatio).toBeCloseTo((0.03 * 365) / 90, 9); // ~12.2%/yr
  });
});
