import { MAREN_POLICY, MCR, formatCollateralRatio, type HealthStatus } from '@maren/sdk';

/**
 * Health presentation.
 *
 * The thresholds are the SDK's, not this file's — `assessHealth` classifies, and this
 * only names and colours the result. BRAND.md §2's rule governs the colouring: in a
 * multi-metric display the figures stay `text`, and the ONE element carrying a genuine
 * signal — the health chip — is coloured. That is why this module exports a single tone
 * per status rather than a colour per metric.
 */

export type Tone = 'neutral' | 'success' | 'warning' | 'danger';

export const healthLabel: Record<HealthStatus, string> = {
  none: 'No debt',
  healthy: 'Healthy',
  caution: 'Caution',
  warning: 'Warning',
  danger: 'Danger',
  liquidatable: 'Liquidatable',
};

export const healthTone: Record<HealthStatus, Tone> = {
  none: 'neutral',
  healthy: 'success',
  caution: 'warning',
  warning: 'warning',
  danger: 'danger',
  liquidatable: 'danger',
};

/** Tailwind classes per tone. Kept together so a tone can never be half-applied. */
export const toneClasses: Record<Tone, { text: string; border: string; dot: string }> = {
  neutral: {
    text: 'text-text-muted',
    border: 'border-[var(--border-hairline)]',
    dot: 'bg-text-subtle',
  },
  success: { text: 'text-success', border: 'border-success/35', dot: 'bg-success' },
  warning: { text: 'text-warning', border: 'border-warning/35', dot: 'bg-warning' },
  danger: { text: 'text-danger', border: 'border-danger/35', dot: 'bg-danger' },
};

/** PulsingBorder palette per tone — BRAND.md §5.2, colour tracks the health state. */
export const toneShaderColors: Record<Tone, readonly string[]> = {
  neutral: ['#5B3DF5', '#8B77FF'],
  success: ['#34D399', '#3ECF8E'],
  warning: ['#FBBF24', '#F59E0B'],
  danger: ['#F87171', '#EF4444'],
};

/**
 * The bands, in the order a user reads them, with the thresholds stated. The product
 * spec asks for the thresholds to be shown rather than implied by a colour.
 */
export const healthBands = [
  { label: 'Healthy', from: MAREN_POLICY.minHealthyCr, tone: 'success' as Tone },
  { label: 'Caution', from: MAREN_POLICY.warnCr, tone: 'warning' as Tone },
  { label: 'Warning', from: MAREN_POLICY.vaultLiquidationCr, tone: 'warning' as Tone },
  { label: 'Danger', from: MCR, tone: 'danger' as Tone },
] as const;

/**
 * A POLICY threshold in prose: "180%", not "180.0%".
 *
 * The SDK's one-decimal form exists for measured ratios, where the decimal carries
 * information and the rounding direction matters. A threshold is an exact constant and
 * setting it in prose as "Maren's 180.0% floor" reads like a machine wrote it. Derived
 * from the SDK formatter rather than re-implemented, so a change there follows through.
 */
export function policyRatio(cr: bigint): string {
  const formatted = formatCollateralRatio(cr);
  return formatted.endsWith('.0%') ? `${formatted.slice(0, -3)}%` : formatted;
}

export function bandCaption(): string {
  return `Healthy at or above ${formatCollateralRatio(MAREN_POLICY.minHealthyCr)} · caution below it · Maren liquidates a pooled position at ${formatCollateralRatio(
    MAREN_POLICY.vaultLiquidationCr,
  )} · the protocol liquidates at ${formatCollateralRatio(MCR)}`;
}
