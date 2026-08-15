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
}: {
  /** Already formatted by an @maren/sdk formatter, unit included. */
  value: string;
  size: Size;
  unitTone: 'btc' | 'musd' | 'muted' | 'primary';
  hidden?: boolean;
  align?: 'left' | 'right';
}) {
  const shown = hidden ? mask(value) : value;
  const [numeral, unit] = splitUnit(shown);

  return (
    <View
      style={[styles.amount, align === 'right' ? styles.alignRight : styles.alignLeft]}
      accessible
      accessibilityLabel={spoken(value, hidden)}
    >
      <Num size={size} tone="primary" accessibilityElementsHidden>
        {numeral}
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
}: AmountProps & { align?: 'left' | 'right' }) {
  return (
    <Amount
      value={formatBtc(wei)}
      size={size}
      unitTone={plain ? 'muted' : 'btc'}
      hidden={hidden}
      align={align}
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
}: AmountProps & { align?: 'left' | 'right' }) {
  return (
    <Amount
      value={formatMusd(wei)}
      size={size}
      unitTone={plain ? 'muted' : 'musd'}
      hidden={hidden}
      align={align}
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
});
