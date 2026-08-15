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
 * All formatting comes from @maren/sdk. None of it is reimplemented — the rounding
 * rules in there are conservative by design, and a second implementation would
 * eventually disagree with the first in the direction that flatters a position.
 */

type Size = NonNullable<NumProps['size']>;

export interface AmountProps {
  wei: bigint;
  size?: Size;
  /** Hide the digits behind a mask, for the shoulder-surfing toggle. */
  hidden?: boolean;
  /** Suppress the semantic colour where the surrounding row already carries it. */
  plain?: boolean;
}

/** A BTC amount. Orange, 6 decimals, trailing zeros trimmed, never a ₿ glyph. */
export function Btc({ wei, size = 'numeric', hidden = false, plain = false }: AmountProps) {
  const value = formatBtc(wei);
  return (
    <Num size={size} tone={plain ? 'primary' : 'btc'} accessibilityLabel={spoken(value, hidden)}>
      {hidden ? mask(value) : value}
    </Num>
  );
}

/** A MUSD amount. Green, exactly 2 decimals, thousands separated. */
export function Musd({ wei, size = 'numeric', hidden = false, plain = false }: AmountProps) {
  const value = formatMusd(wei);
  return (
    <Num size={size} tone={plain ? 'primary' : 'musd'} accessibilityLabel={spoken(value, hidden)}>
      {hidden ? mask(value) : value}
    </Num>
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
  return (
    <Num size={size} tone="muted" accessibilityLabel={value}>
      {value}
    </Num>
  );
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
