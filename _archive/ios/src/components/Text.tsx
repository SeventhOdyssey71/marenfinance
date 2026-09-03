import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { brand, semanticText, text as textColors } from '../design/tokens';
import { type } from '../design/type';

/**
 * Typed text primitives. Every string in the app goes through one of these so that
 * BRAND.md §3's scale is the only way to set a font size.
 *
 * `allowFontScaling` is left at its React Native default of `true` throughout: iOS
 * Dynamic Type must work, which is an explicit accessibility requirement. Layouts below
 * use flex and wrapping rather than fixed heights so that a user at the largest text
 * size still gets a usable screen.
 */

type Variant = keyof typeof type;
type Tone = 'primary' | 'muted' | 'subtle' | 'btc' | 'musd' | 'violet' | 'inherit';

/**
 * Every tone here paints TEXT, so the asset marks take their `semanticText` values
 * rather than the fill values in `semantic`. On white, #0D9E70 is a perfectly good
 * status dot at 3.42:1 and an unreadable 13px "MUSD" at the same ratio.
 */
const toneColor: Record<Exclude<Tone, 'inherit'>, string> = {
  primary: textColors.primary,
  muted: textColors.muted,
  subtle: textColors.subtle,
  btc: semanticText.btc,
  musd: semanticText.musd,
  // The accent AS TEXT takes the darker pink (violet600, 5:1 on white). Neon #FA00FF is
  // the fill/glow value and is only 3.2:1 — fine for a glyph, illegible as a small label.
  violet: brand.violet600,
};

export interface MarenTextProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  children?: ReactNode;
}

export function Txt({
  variant = 'body',
  tone = 'primary',
  style,
  children,
  ...rest
}: MarenTextProps) {
  const base = type[variant] as TextStyle;
  return (
    <RNText style={[base, tone === 'inherit' ? null : { color: toneColor[tone] }, style]} {...rest}>
      {children}
    </RNText>
  );
}

/**
 * §3 Label — uppercase, tracked, 12px. Used for every field and section caption.
 *
 * Defaults to `muted`, not `subtle`. `subtle` (#9A9AA2) is the light greyed-decimal tone
 * — it is deliberately below AA and must never carry a 12px label. `muted` (#6E6E6E) is
 * the informational-text tone: ~5.1 on a card, ~4.6 on the canvas — legible with room,
 * so every field caption and label takes it. BRAND.md's preamble settles the conflict:
 * "quiet, expensive, and legible before it is decorative." A label a user cannot read is
 * not quiet, it is broken.
 *
 * `subtle` is reserved for the two decorative jobs where its lightness is the point: the
 * greyed trailing decimals of a hero balance, and quiet ornament (a disclosure chevron).
 * Nothing that carries information may use it.
 */
export function Label({ style, tone = 'muted', ...rest }: MarenTextProps) {
  return <Txt variant="label" tone={tone} style={style} {...rest} />;
}

/**
 * Numerals. Always Geist Mono, always tabular.
 *
 * BRAND.md §8: "Always show the unit. Never a bare number." The `unit` prop is required
 * rather than optional so that omitting it is a deliberate, visible act — pass
 * `unit={null}` only when the unit is rendered immediately adjacent by the caller.
 */
export interface NumProps extends Omit<MarenTextProps, 'variant'> {
  size?: 'numericXl' | 'numericLg' | 'numericMd' | 'numeric' | 'numericSm';
  /** The already-formatted value, produced by an @maren/sdk formatter. */
  children: ReactNode;
}

export function Num({ size = 'numeric', tone = 'primary', style, ...rest }: NumProps) {
  return <Txt variant={size} tone={tone} style={style} {...rest} />;
}

export const textStyles = StyleSheet.create({
  center: { textAlign: 'center' },
  right: { textAlign: 'right' },
});
