import { StyleSheet, View } from 'react-native';
import { formatBtc, formatCollateralRatio, formatMusd, formatUsd } from '@maren/sdk';

import { Num, type NumProps } from './Text';

/**
 * Money primitives.
 *
 * Two BRAND.md rules are enforced structurally here rather than by convention:
 *
 *   §8 — "Always show the unit. Never a bare number." The unit comes from the SDK
 *        formatter, so there is no code path that renders a bare figure.
 *   §2 — BTC orange is "reserved exclusively for BTC-denominated values"; MUSD green
 *        for MUSD values. The colour is attached to the component that knows the
 *        denomination, so a BTC figure cannot be rendered green by accident.
 *
 * ── Why the numeral and the unit are two elements ──────────────────────────────
 *
 * The SDK formatters return one string ("0.5 BTC"), and rendering that string as a
 * single run of text caused two real defects, both visible in the simulator:
 *
 *   1. At `numericXl` the unit inherited a 44px mono face, so "2,553.50 MUSD" wrapped
 *      onto a second line with "MUSD" alone on it.
 *   2. The unit inherited the asset colour at full size, so a screen of balances was a
 *      screen of large orange and green words. BRAND.md §2 is explicit: "the only
 *      saturated colour on a default screen is the violet CTA… A screen where
 *      everything is coloured is a screen where nothing is important."
 *
 * So the numeral carries the value and renders in `text.primary`, and the unit — which
 * IS the asset mark §2 reserves the colour for — renders small, beside it, on the shared
 * baseline. This is the same shape the shipped web app uses for a hero statistic
 * (`flex items-baseline gap-2`, numeral `text-text`, unit smaller and quieter), so the
 * two apps read as one product rather than two readings of the spec.
 *
 * All formatting still comes from @maren/sdk. None of it is reimplemented — the rounding
 * rules in there are conservative by design, and a second implementation would
 * eventually disagree with the first in the direction that flatters a position.
 */

type Size = NonNullable<NumProps['size']>;

/** The unit sits a step or two down the scale, never at the numeral's size. */
const unitSizeFor: Record<Size, Size> = {
  numericXl: 'numeric',
  numericLg: 'numericSm',
  numericMd: 'numericSm',
  numeric: 'numericSm',
  numericSm: 'numericSm',
};

export interface AmountProps {
  wei: bigint;
  size?: Size;
  /** Hide the digits behind a mask, for the shoulder-surfing toggle. */
  hidden?: boolean;
  /** Suppress the semantic colour where the surrounding row already carries it. */
  plain?: boolean;
  /**
   * Grey the fractional part (the ".24" in "$42,890.24") so the eye lands on the whole
   * number first — the reference wallet's hero-numeral treatment. Defaults on at the two
   * hero sizes (`numericXl`/`numericLg`) and off everywhere else, so a row of small
   * figures does not get a second colour it did not ask for. Opt in explicitly at
   * `numericMd` where a balance is still the loudest thing on its card.
   */
  dimFraction?: boolean;
}

/**
 * A formatted amount, split into its numeral and its unit.
 *
 * `align="right"` matters for BRAND.md §7's "numeric columns right-aligned in mono" —
 * in a label/value row the pair must hug the right edge, not the left.
 */
export function Amount({
  value,
  size,
  unitTone,
  hidden = false,
  align = 'right',
  dimFraction,
}: {
  /** Already formatted by an @maren/sdk formatter, unit included. */
  value: string;
  size: Size;
  unitTone: 'btc' | 'musd' | 'muted' | 'primary';
  hidden?: boolean;
  align?: 'left' | 'right';
  dimFraction?: boolean;
}) {
  const shown = hidden ? mask(value) : value;
  const [numeral, unit] = splitUnit(shown);

  // Default the treatment on at the hero sizes, off below them. A masked value has no
  // decimal point to dim, so it falls through splitFraction unchanged either way.
  const dim = (dimFraction ?? (size === 'numericXl' || size === 'numericLg')) && !hidden;
  const [intPart, fracPart] = dim ? splitFraction(numeral) : [numeral, null];
  /**
   * The greyed run is the UGLYCASH trailing-decimal treatment: `subtle` (#9A9AA2) at the
   * two hero sizes (≥24px large text), a deliberately light grey so the eye lands on the
   * whole number first; everything smaller takes `muted`, which stays legible at body
   * scale.
   */
  const fractionTone = size === 'numericXl' || size === 'numericLg' ? 'subtle' : 'muted';

  return (
    <View
      style={[styles.amount, align === 'right' ? styles.alignRight : styles.alignLeft]}
      accessible
      accessibilityLabel={spoken(value, hidden)}
    >
      <Num size={size} tone="primary" accessibilityElementsHidden>
        {intPart}
        {fracPart ? (
          <Num size={size} tone={fractionTone} accessibilityElementsHidden>
            {fracPart}
          </Num>
        ) : null}
      </Num>
      {unit ? (
        <Num size={unitSizeFor[size]} tone={unitTone} accessibilityElementsHidden>
          {unit}
        </Num>
      ) : null}
    </View>
  );
}

/** A BTC amount. 6 decimals, trailing zeros trimmed, never a ₿ glyph. */
export function Btc({
  wei,
  size = 'numeric',
  hidden = false,
  plain = false,
  align,
  dimFraction,
}: AmountProps & { align?: 'left' | 'right' }) {
  return (
    <Amount
      value={formatBtc(wei)}
      size={size}
      unitTone={plain ? 'muted' : 'btc'}
      hidden={hidden}
      align={align}
      dimFraction={dimFraction}
    />
  );
}

/** A MUSD amount. Exactly 2 decimals, thousands separated. */
export function Musd({
  wei,
  size = 'numeric',
  hidden = false,
  plain = false,
  align,
  dimFraction,
}: AmountProps & { align?: 'left' | 'right' }) {
  return (
    <Amount
      value={formatMusd(wei)}
      size={size}
      unitTone={plain ? 'muted' : 'musd'}
      hidden={hidden}
      align={align}
      dimFraction={dimFraction}
    />
  );
}

/**
 * A plain USD value — the dollar worth of something, not a MUSD balance.
 *
 * Rendered in muted grey, never green: it is not a MUSD-denominated value and colouring
 * it as one would break §2's reservation.
 */
export function Usd({ wei, size = 'numericSm', hidden = false }: AmountProps) {
  const value = formatUsd(wei);
  return (
    <Num size={size} tone="muted" accessibilityLabel={spoken(value, hidden)}>
      {hidden ? mask(value) : value}
    </Num>
  );
}

/**
 * A collateral ratio. Colour is passed in by the caller from the health assessment,
 * because a CR is only meaningful against the thresholds — see BRAND.md §2's rule that
 * health colours appear only when they carry meaning.
 */
export function Ratio({
  cr,
  size = 'numeric',
  color,
}: {
  cr: bigint;
  size?: Size;
  color?: string;
}) {
  const value = formatCollateralRatio(cr);
  return (
    <Num
      size={size}
      tone="inherit"
      style={color ? { color } : undefined}
      accessibilityLabel={`Collateral ratio ${value}`}
    >
      {value}
    </Num>
  );
}

/**
 * Gas, shown in sats rather than a raw BTC decimal.
 *
 * TALISE-BLUEPRINT §7 #36: "show gas in sats — never a raw BTC decimal." A gas cost
 * written as 0.000000148 BTC is unreadable; 148 sats is not.
 */
export function Sats({ wei, size = 'numericSm' }: { wei: bigint; size?: Size }) {
  const sats = wei / 10_000_000_000n; // 1e18 wei per BTC, 1e8 sats per BTC.
  const value = `${sats.toLocaleString('en-US')} sats`;
  // Gas is a cost, not a holding: it stays muted rather than taking BTC orange, which
  // §2 reserves for BTC-denominated *values*.
  return <Amount value={value} size={size} unitTone="muted" hidden={false} align="right" />;
}

/**
 * A signed ledger figure — the History row's and the receipt's amount.
 *
 * One renderer, shared by both, so a row and the receipt it opens can never disagree
 * about a sign, a decimal, or a colour. It carries §2's asset mark (green MUSD, orange
 * BTC on the unit only) and the reference wallet's greyed fraction so the eye lands on
 * the whole number first — the same treatment `Amount` gives a hero balance, applied to
 * a ledger line.
 *
 * A FAILED ROW IS STRUCK THROUGH AND DROPPED TO MUTED. R15's read-path half: a reverted
 * transaction moved no funds, so its amount reads as withdrawn rather than as money that
 * changed hands, and it never wears the asset colour a settled value would.
 */
export function LedgerAmount({
  musdWei,
  btcWei,
  direction,
  failed = false,
  size = 'numeric',
}: {
  musdWei?: bigint;
  btcWei?: bigint;
  /** The sign the caller derived from the kind — an en dash for outflow, never a hyphen. */
  direction: '+' | '−';
  failed?: boolean;
  size?: Size;
}) {
  const value =
    musdWei !== undefined ? formatMusd(musdWei) : btcWei !== undefined ? formatBtc(btcWei) : null;

  if (value === null) {
    return (
      <Num size={size} tone="muted">
        —
      </Num>
    );
  }

  const [numeral, unit] = splitUnit(value);
  const [intPart, fracPart] = splitFraction(numeral);
  const assetTone: 'musd' | 'btc' = musdWei !== undefined ? 'musd' : 'btc';

  // Visual-only: it groups under the row's Pressable or the receipt hero, each of which
  // owns the spoken label (see `signedAmountText`), so the figure is announced once.
  if (failed) {
    return (
      <View style={[styles.amount, styles.alignRight]}>
        <Num size={size} tone="muted" style={styles.struck}>
          {direction}
          {value}
        </Num>
      </View>
    );
  }

  return (
    <View style={[styles.amount, styles.alignRight]}>
      <Num size={size} tone="primary">
        {direction}
        {intPart}
        {fracPart ? (
          <Num size={size} tone="muted">
            {fracPart}
          </Num>
        ) : null}
      </Num>
      {unit ? (
        <Num size={unitSizeFor[size]} tone={assetTone}>
          {unit}
        </Num>
      ) : null}
    </View>
  );
}

/**
 * Split "1,234.00 MUSD" into ["1,234.00", "MUSD"].
 *
 * Splits on the last space only when the tail is a unit word, so a `$`-prefixed USD
 * figure ("$31,358.50") and a masked value both survive unchanged.
 */
function splitUnit(value: string): [string, string | null] {
  const at = value.lastIndexOf(' ');
  if (at < 0) return [value, null];
  const tail = value.slice(at + 1);
  return /^[A-Za-z]+$/.test(tail) ? [value.slice(0, at), tail] : [value, null];
}

/**
 * Split a numeral into its integer part and its fractional tail, including the point:
 * "1,234.56" → ["1,234", ".56"], "$31,358.50" → ["$31,358", ".50"], "42" → ["42", null].
 *
 * Splits on the LAST '.', so a thousands separator that is a dot in some locales would
 * still leave the true fraction alone — the SDK formatters use a comma, so this is belt
 * and braces rather than a live concern.
 */
function splitFraction(numeral: string): [string, string | null] {
  const at = numeral.lastIndexOf('.');
  if (at < 0) return [numeral, null];
  return [numeral.slice(0, at), numeral.slice(at)];
}

function mask(value: string): string {
  // Keep the unit visible so a hidden balance still says what it is denominated in.
  const parts = value.split(' ');
  const unit = parts.length > 1 ? ` ${parts.slice(1).join(' ')}` : '';
  return `••••${unit}`;
}

function spoken(value: string, hidden: boolean): string {
  return hidden ? 'Amount hidden' : value;
}

const styles = StyleSheet.create({
  amount: {
    flexDirection: 'row',
    // Shared baseline, so the unit sits on the numeral's feet rather than its centre.
    alignItems: 'baseline',
    gap: 6,
    flexShrink: 1,
  },
  alignRight: { justifyContent: 'flex-end' },
  alignLeft: { justifyContent: 'flex-start' },
  struck: { textDecorationLine: 'line-through' },
});
