import { WAD } from './constants';

/**
 * Realised, backward-looking trailing yield for MarenEarn. THE MATH ONLY.
 *
 * MarenEarn is an ERC-4626 wrapper over the MUSD Stability Pool. That pool has NO token
 * emissions: its entire return is the native BTC seized when a trove is liquidated, which
 * is lumpy, arrives in discrete events, and can be zero for months. There is no forward
 * APY to quote and this module never invents one. What it does is take a realised gain
 * that has already happened over an observed window and express it honestly, including
 * refusing to express it at all when there is not enough to be defensible.
 *
 * Everything here is pure: bigint fixed-point in, plain numbers or null out, no I/O. The
 * web layer reads the chain, the contracts do the seizing, this file only does arithmetic.
 */

/**
 * Value a native-BTC amount at a BTC/USD price, both 1e18 fixed-point, giving MUSD 1e18.
 *
 * This mirrors `MarenEarn._valueBtc` exactly: floor division, and a zero price yields zero
 * rather than throwing. Valuing at zero UNDERSTATES the gain, which is the safe direction
 * for a figure shown to a depositor, and it is the same fallback the contract itself uses
 * when the oracle has never reported. Keeping the two in step means the realised figure a
 * user sees and the share price the vault mints against move on one definition, not two.
 */
export function valueBtcInMusd(btcWei: bigint, priceWei: bigint): bigint {
  if (btcWei <= 0n || priceWei <= 0n) return 0n;
  return (btcWei * priceWei) / WAD;
}

/**
 * A window is only long enough, and eventful enough, to annualise once it clears both of
 * these. Below either bar, extrapolating a lumpy realised gain to a yearly rate would turn
 * one liquidation into a headline percentage that says nothing about the next twelve
 * months. These are the documented "defensible" thresholds referenced by the Earn screen's
 * decision to keep its forward-rate cell blank.
 */
export const MIN_ANNUALISE_DAYS = 30;
export const MIN_ANNUALISE_EVENTS = 4;

export interface RealisedYieldInput {
  /** MUSD realised over the window, 1e18. Already valued from seized BTC by the caller. */
  realisedWei: bigint;
  /** MUSD base the gain is measured against, 1e18. Typically the vault's total assets. */
  baseWei: bigint;
  /** Length of the observed window, in days. */
  windowDays: number;
  /** Discrete liquidation events that produced the gain. Governs whether we may annualise. */
  events: number;
}

export interface RealisedYield {
  /**
   * The period return over the window: realised / base, as a decimal ratio (0.012 = 1.2%).
   * This is a fact about a window that happened, so it is always present once there is a
   * base and a window to divide by.
   */
  ratio: number;
  /**
   * The period return scaled to a year, `ratio * 365 / windowDays`, as a decimal ratio.
   * Null unless the window is both long enough and eventful enough for that scaling to
   * mean anything. Null is not zero: it is "we will not put a yearly rate on this".
   */
  annualisedRatio: number | null;
  /** Whether `annualisedRatio` is populated, i.e. whether annualising is defensible here. */
  annualisable: boolean;
}

/**
 * Turn a realised gain over a window into a trailing yield.
 *
 * Returns `null` for INSUFFICIENT DATA rather than a misleading zero: no base to divide by,
 * or no window. A zero here would read as "we measured, it was 0%", which is a different
 * and stronger claim than "there is nothing to measure yet", and this screen's whole point
 * is not to blur the two. A real window with a real base and no liquidations, by contrast,
 * DID measure zero and returns `ratio: 0` truthfully.
 *
 * `annualisedRatio` is only filled in when `MIN_ANNUALISE_DAYS` and `MIN_ANNUALISE_EVENTS`
 * are both met. That is the single place the "you may not annualise a lumpy gain" rule
 * lives; callers ask for a yearly rate and get `null` back when it would be a guess.
 */
export function realisedYield(input: RealisedYieldInput): RealisedYield | null {
  const { realisedWei, baseWei, windowDays, events } = input;

  // No base and no window are the two ways to have nothing to divide, and a negative
  // realised figure is nonsense a caller should never hand us; all three are "no answer".
  if (baseWei <= 0n || windowDays <= 0 || realisedWei < 0n) return null;

  // Ratio in bigint before touching floats, so a 1e18 base does not lose the small
  // numerator. 1e9 of fixed-point precision is far more than a percentage ever renders.
  const SCALE = 1_000_000_000n;
  const ratio = Number((realisedWei * SCALE) / baseWei) / Number(SCALE);

  const annualisable = windowDays >= MIN_ANNUALISE_DAYS && events >= MIN_ANNUALISE_EVENTS;
  const annualisedRatio = annualisable ? (ratio * 365) / windowDays : null;

  return { ratio, annualisedRatio, annualisable };
}
