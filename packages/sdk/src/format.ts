import { WAD } from './constants';
import { MAX_CR } from './position';

/**
 * Number formatting. This implements docs/BRAND.md §8, which is design policy, not
 * decoration — how a balance is rendered changes what a user believes about their risk.
 *
 * Rules enforced here:
 *   - Always show the unit. Never a bare number.
 *   - Health figures round toward the conservative side.
 *   - Tabular figures upstream (font-variant-numeric: tabular-nums) so digits do not
 *     jitter as values update; this module only produces the strings.
 */

/** Format a 1e18 BTC amount. Max 6 decimals, trailing zeros trimmed. */
export function formatBtc(wei: bigint, opts: { unit?: boolean } = {}): string {
  const { unit = true } = opts;
  const s = trimTrailingZeros(fixedPointToString(wei, 18, 6));
  return unit ? `${s} BTC` : s;
}

/** Format a 1e18 MUSD amount. Exactly 2 decimals, thousands separated. */
export function formatMusd(wei: bigint, opts: { unit?: boolean } = {}): string {
  const { unit = true } = opts;
  const s = groupThousands(fixedPointToString(wei, 18, 2));
  return unit ? `${s} MUSD` : s;
}

/** Format a 1e18 USD value. Two decimals, grouped, leading `$`. */
export function formatUsd(wei: bigint): string {
  const negative = wei < 0n;
  const s = groupThousands(fixedPointToString(negative ? -wei : wei, 18, 2));
  return `${negative ? '-' : ''}$${s}`;
}

/**
 * Format a 1e18 collateral ratio as a percentage, e.g. 2259300000000000000n -> "225.9%".
 *
 * Rounds DOWN, always. A position at 179.99% must never display as 180%, because 180% is
 * our borrow threshold and the user would believe they can act when they cannot.
 */
export function formatCollateralRatio(cr: bigint): string {
  if (cr >= MAX_CR) return '∞'; // infinity, for a position with no debt
  const tenths = (cr * 1000n) / WAD; // truncating division rounds down
  const whole = tenths / 10n;
  const frac = tenths % 10n;
  return `${groupThousands(whole.toString())}.${frac}%`;
}

/**
 * Format a percentage supplied as integer TENTHS of a percent: 137 -> "13.7%".
 *
 * Integer in, string out, with no floating-point step anywhere between. The obvious
 * alternative — carrying 13.7 as a `number` and calling `toFixed(1)` — rounds to nearest
 * and does it on a value that is already inexact, so a truncated 0.7 stored as
 * 0.6999999999999999 renders as "0.7" today and could render as "0.6" after one more
 * arithmetic step. The callers in `vault.ts` truncate in bigint and hand the tenths
 * straight here, so what is computed is what is shown.
 */
export function formatPercentTenths(tenths: number): string {
  const negative = tenths < 0;
  const abs = Math.trunc(Math.abs(tenths));
  return `${negative ? '-' : ''}${groupThousands(String(Math.trunc(abs / 10)))}.${abs % 10}%`;
}

/** Format a basis-point rate, e.g. 100 -> "1.00%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** Format an APR from basis points, e.g. 100 -> "1.00% APR". */
export function formatApr(bps: number): string {
  return `${formatBps(bps)} APR`;
}

/** Truncate an address for display: 0x1234…cdef. Never used where the full value matters. */
export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** Truncate a transaction hash for display. */
export function shortHash(hash: string): string {
  return shortAddress(hash, 10, 8);
}

/**
 * Abbreviate a large 1e18 USD figure for headline display: $1.2M, $4.2B.
 * Callers must expose the exact value on hover or long-press — see BRAND.md §8.
 */
export function abbreviateUsd(wei: bigint): string {
  const units = (wei < 0n ? -wei : wei) / WAD;
  const sign = wei < 0n ? '-' : '';
  const tiers: Array<[bigint, string]> = [
    [1_000_000_000_000n, 'T'],
    [1_000_000_000n, 'B'],
    [1_000_000n, 'M'],
    [1_000n, 'K'],
  ];
  for (const [threshold, suffix] of tiers) {
    if (units >= threshold) {
      const scaled = (units * 10n) / threshold;
      const whole = scaled / 10n;
      const frac = scaled % 10n;
      return frac === 0n ? `${sign}$${whole}${suffix}` : `${sign}$${whole}.${frac}${suffix}`;
    }
  }
  return `${sign}$${units}`;
}

/** Human-readable price drop, e.g. 3200 bps -> "32% below today's price". */
export function formatPriceDrop(bps: number): string {
  if (bps <= 0) return 'at or below liquidation';
  return `${(bps / 100).toFixed(0)}% below today's price`;
}

// ── the em-dash guard ────────────────────────────────────────────────────────

/**
 * The placeholder for a figure that does not exist. BRAND.md §8 says always show the
 * unit and never a bare number; the corollary this section adds is that a number which
 * has no meaning must not be rendered at all.
 */
export const EM_DASH = '—';

/**
 * The largest figure that can be a real BTC price. Anything at or above this is a
 * sentinel, an overflow, or a bug, and is rendered as an em dash rather than printed.
 *
 * A live screenshot once showed a liquidation price of
 * $57,896,044,618,658,097,711,785,492,504,343,953,926,634,992,332,820,282,019,728.79 —
 * `MAX_CR` (2^255 - 1) formatted as dollars. The root cause is fixed in `position.ts`,
 * but a formatter that will faithfully print a 60-digit dollar amount is a loaded gun
 * pointed at every future caller, so the ceiling is enforced here as well. One trillion
 * dollars a coin is many orders of magnitude above any plausible price and many orders
 * below any sentinel, so it separates the two cleanly.
 */
export const DISPLAY_CEILING = 1_000_000_000_000n * WAD;

/** True when `wei` is a figure we are willing to put on screen. */
export function isDisplayable(wei: bigint): boolean {
  return wei > 0n && wei < DISPLAY_CEILING;
}

/**
 * A USD figure, or an em dash when there is no figure to show.
 *
 * Use this for anything DERIVED from a position rather than measured: liquidation
 * prices, break-even prices, projected values. A measured balance of zero is a fact and
 * should render as `$0.00` through `formatUsd`; a liquidation price of zero is the
 * absence of a fact and must render as `—`.
 */
export function formatUsdOrDash(wei: bigint | null | undefined): string {
  if (wei === null || wei === undefined) return EM_DASH;
  return isDisplayable(wei) ? formatUsd(wei) : EM_DASH;
}

/**
 * The liquidation price of a position, or an em dash when the position has no debt.
 *
 * A position with no debt cannot be liquidated, so it has no liquidation price. Zero is
 * the wrong answer and so is any number: `$0.00` reads as "liquidated at zero", which a
 * user could reasonably take to mean "safe until Bitcoin is worthless" — true, but only
 * because the statement is empty. The em dash says the honest thing, which is that the
 * question does not apply.
 */
export function formatLiquidationPrice(liquidationPriceWei: bigint, debtWei: bigint): string {
  if (debtWei <= 0n) return EM_DASH;
  return formatUsdOrDash(liquidationPriceWei);
}

/**
 * How far BTC can fall before liquidation, as a whole percent — or an em dash when the
 * position has no debt and the question does not apply.
 *
 * Rounds DOWN, so a position with 32.9% of headroom is never flattered to 33%.
 * `Number.isFinite` catches an `Infinity` or `NaN` arriving from a division upstream:
 * `Math.floor(NaN)` is `NaN` and `${NaN}%` renders as the string "NaN%", which is how a
 * broken figure ends up on screen wearing a unit.
 */
export function formatDropToLiquidation(bps: number, debtWei: bigint): string {
  if (debtWei <= 0n) return EM_DASH;
  if (!Number.isFinite(bps)) return EM_DASH;
  if (bps <= 0) return '0%';
  return `${Math.floor(bps / 100)}%`;
}

/**
 * A collateral ratio, or an em dash when there is no debt to measure it against.
 *
 * `formatCollateralRatio` renders the no-debt sentinel as `∞`, which is correct in
 * isolation but reads as a boast in a metric grid beside real figures. Where the ratio
 * is one of several derived readouts, the em dash is the quieter and more honest form.
 */
export function formatCollateralRatioOrDash(cr: bigint, debtWei: bigint): string {
  if (debtWei <= 0n) return EM_DASH;
  if (cr >= MAX_CR) return EM_DASH;
  return formatCollateralRatio(cr);
}

// ── internals ────────────────────────────────────────────────────────────────

/** Render a fixed-point bigint with `decimals` precision, truncated to `places`. */
function fixedPointToString(value: bigint, decimals: number, places: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fracFull = (abs % base).toString().padStart(decimals, '0');
  const frac = fracFull.slice(0, places);
  const sign = negative ? '-' : '';
  return places === 0 ? `${sign}${whole}` : `${sign}${whole}.${frac}`;
}

function trimTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

function groupThousands(s: string): string {
  const negative = s.startsWith('-');
  const body = negative ? s.slice(1) : s;
  const [whole = '', frac] = body.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const out = frac === undefined ? grouped : `${grouped}.${frac}`;
  return negative ? `-${out}` : out;
}
