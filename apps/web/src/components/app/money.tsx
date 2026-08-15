import { WAD, formatBtc, formatCollateralRatio, formatMusd, formatUsd } from '@maren/sdk';
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

export type NumTone = 'default' | 'muted' | 'subtle' | 'btc' | 'musd' | 'inherit';

const tones: Record<NumTone, string> = {
  default: 'text-text',
  muted: 'text-text-muted',
  subtle: 'text-text-subtle',
  btc: 'text-btc',
  musd: 'text-musd',
  inherit: '',
};

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
  return (
    <span
      className={`num ${sizes[size]} ${tones[tone]} ${className}`}
      {...(title ? { title } : {})}
    >
      {children}
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
      —
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
