import {
  EM_DASH,
  WAD,
  formatBtc,
  formatCollateralRatio,
  formatCollateralRatioOrDash,
  formatDropToLiquidation,
  formatLiquidationPrice,
  formatMusd,
  formatUsd,
} from '@maren/sdk';
import type { ReactNode } from 'react';

/**
 * Numerals.
 *
 * BRAND.md §3 and §8, enforced in one place: every figure is Geist Mono with tabular
 * figures so digits do not jitter as values update, every figure carries its unit, and
 * anything abbreviated exposes its exact value on hover.
 *
 * Colour is NOT a prop by default. BRAND.md §2: in a multi-metric display the figures
 * are `text` and only the health chip is coloured. Where an asset colour is genuinely
 * warranted — a single balance headline that is the subject of its own component — the
 * caller opts in explicitly with `tone`, and no component here applies one on its own.
 */

type Size = 'sm' | 'md' | 'lg' | 'xl';

const sizes: Record<Size, string> = {
  sm: 'text-[0.8125rem]',
  md: 'text-[0.9375rem]',
  lg: 'text-xl',
  xl: 't-numeric-xl',
};

export type NumTone =
  'default' | 'muted' | 'subtle' | 'btc' | 'musd' | 'moneyIn' | 'moneyOut' | 'inherit';

const tones: Record<NumTone, string> = {
  default: 'text-text',
  muted: 'text-text-muted',
  subtle: 'text-text-subtle',
  btc: 'text-btc',
  musd: 'text-musd',
  // Ledger direction, matching the iOS app. Only ever used alongside a + / - sign, so
  // the direction never reads by colour alone.
  moneyIn: 'text-[color:var(--color-money-in)]',
  moneyOut: 'text-[color:var(--color-money-out)]',
  inherit: '',
};

/**
 * On the big display sizes, grey everything from the decimal point on, the
 * fractional digits and any trailing unit, so the eye lands on the whole figure
 * that matters. Only when there IS a whole figure: in "0.073 BTC" the decimals are
 * the amount, and greying them would grey the number itself. Only plain-string
 * children qualify; `∞`, an em dash or already-composed nodes pass through.
 */
function greyDecimals(text: string): ReactNode {
  const dot = text.indexOf('.');
  if (dot === -1) return text;
  if (!/[1-9]/.test(text.slice(0, dot))) return text;
  return (
    <>
      {text.slice(0, dot)}
      <span className="text-text-subtle">{text.slice(dot)}</span>
    </>
  );
}

export function Num({
  children,
  size = 'md',
  tone = 'default',
  title,
  className = '',
}: {
  children: ReactNode;
  size?: Size;
  tone?: NumTone;
  /** The exact, unabbreviated value. Shown on hover — BRAND.md §8. */
  title?: string;
  className?: string;
}) {
  const body =
    (size === 'lg' || size === 'xl') && typeof children === 'string'
      ? greyDecimals(children)
      : children;
  return (
    <span
      className={`num ${sizes[size]} ${tones[tone]} ${className}`}
      {...(title ? { title } : {})}
    >
      {body}
    </span>
  );
}

export function Btc({
  wei,
  size = 'md',
  tone = 'default',
  className = '',
}: {
  wei: bigint;
  size?: Size;
  tone?: NumTone;
  className?: string;
}) {
  return (
    <Num size={size} tone={tone} className={className} title={exactBtc(wei)}>
      {formatBtc(wei)}
    </Num>
  );
}

export function Musd({
  wei,
  size = 'md',
  tone = 'default',
  className = '',
}: {
  wei: bigint;
  size?: Size;
  tone?: NumTone;
  className?: string;
}) {
  return (
    <Num size={size} tone={tone} className={className} title={`${exactMusd(wei)} MUSD`}>
      {formatMusd(wei)}
    </Num>
  );
}

export function Usd({
  wei,
  size = 'md',
  tone = 'muted',
  className = '',
}: {
  wei: bigint;
  size?: Size;
  tone?: NumTone;
  className?: string;
}) {
  return (
    <Num size={size} tone={tone} className={className}>
      {formatUsd(wei)}
    </Num>
  );
}

/**
 * A collateral ratio. `formatCollateralRatio` rounds DOWN, always: a position at 179.99%
 * must never display as 180%, because 180% is the borrow threshold and the user would
 * believe they can act when they cannot.
 */
export function Ratio({
  cr,
  size = 'md',
  tone = 'default',
  className = '',
}: {
  cr: bigint;
  size?: Size;
  tone?: NumTone;
  className?: string;
}) {
  return (
    <Num size={size} tone={tone} className={className}>
      {formatCollateralRatio(cr)}
    </Num>
  );
}

/** Em dash placeholder, so a loading row keeps the same height as a loaded one. */
export function Dash({ size = 'md' }: { size?: Size }) {
  return (
    <Num size={size} tone="subtle">
      {EM_DASH}
    </Num>
  );
}

/**
 * A liquidation price, or an em dash when the position has no debt.
 *
 * There is no such thing as the liquidation price of a position that cannot be
 * liquidated. Rendering `$0.00` there would read as "liquidated at zero", and rendering
 * the SDK's no-debt sentinel is what once printed a 66-digit dollar figure across two
 * columns of the Portfolio. Both are refused here, in the one component every screen
 * goes through, so no caller has to remember.
 */
export function LiquidationPrice({
  wei,
  debtWei,
  size = 'md',
}: {
  wei: bigint | null | undefined;
  debtWei: bigint;
  size?: Size;
}) {
  const text = wei === null || wei === undefined ? EM_DASH : formatLiquidationPrice(wei, debtWei);
  return (
    <Num size={size} tone={text === EM_DASH ? 'subtle' : 'default'}>
      {text}
    </Num>
  );
}

/**
 * How far Bitcoin can fall before liquidation — or an em dash when nothing is owed and
 * the question does not apply. Guards `Infinity` and `NaN`, which a bigint cannot be but
 * this basis-point `number` can.
 */
export function DropToLiquidation({
  bps,
  debtWei,
  size = 'md',
}: {
  bps: number | null | undefined;
  debtWei: bigint;
  size?: Size;
}) {
  const text = bps === null || bps === undefined ? EM_DASH : formatDropToLiquidation(bps, debtWei);
  return (
    <Num size={size} tone={text === EM_DASH ? 'subtle' : 'default'}>
      {text}
    </Num>
  );
}

/** A collateral ratio that dashes rather than boasting `∞` when there is no debt. */
export function RatioOrDash({
  cr,
  debtWei,
  size = 'md',
  tone = 'default',
  className = '',
}: {
  cr: bigint;
  debtWei: bigint;
  size?: Size;
  tone?: NumTone;
  className?: string;
}) {
  const text = formatCollateralRatioOrDash(cr, debtWei);
  return (
    <Num size={size} tone={text === EM_DASH ? 'subtle' : tone} className={className}>
      {text}
    </Num>
  );
}

// ── exact values, for the hover title ────────────────────────────────────────

function exactBtc(wei: bigint): string {
  const whole = wei / WAD;
  const frac = (wei % WAD).toString().padStart(18, '0');
  return `${whole}.${frac} BTC exactly`;
}

function exactMusd(wei: bigint): string {
  const whole = wei / WAD;
  const frac = (wei % WAD).toString().padStart(18, '0');
  return `${whole}.${frac}`;
}
