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
