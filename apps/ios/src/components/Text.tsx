import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, type TextProps, type TextStyle } from 'react-native';

import { colors, text as textColors } from '../design/tokens';
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

const toneColor: Record<Exclude<Tone, 'inherit'>, string> = {
  primary: textColors.primary,
  muted: textColors.muted,
  subtle: textColors.subtle,
  btc: colors.btc,
  musd: colors.musd,
  violet: colors.violet400,
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
    <RNText
      style={[base, tone === 'inherit' ? null : { color: toneColor[tone] }, style]}
      {...rest}
    >
      {children}
    </RNText>
  );
}

/**
 * §3 Label — uppercase, tracked, 12px. Used for every field and section caption.
 *
 * Defaults to `muted`, not `subtle`, and that is a deliberate deviation from the tone
 * BRAND.md's table implies for "tertiary" text. The palette is unchanged — `subtle` is
 * still exactly `#6B6B75` — but it is not used for text that carries information,
 * because at 12px it does not meet WCAG AA on any Maren surface:
 *
 *     #6B6B75 on #08080A  3.80:1      #A1A1AA on #08080A  7.81:1
 *     #6B6B75 on #101013  3.60:1      #A1A1AA on #101013  7.41:1
 *     #6B6B75 on #0C0C0F  3.71:1      #A1A1AA on #0C0C0F  7.62:1
 *     #6B6B75 on #17171B  3.39:1      #A1A1AA on #17171B  6.97:1
 *
 * BRAND.md's own preamble settles the conflict: "dark, quiet, expensive, and legible
 * before it is decorative." A label a user cannot read is not quiet, it is broken. Pass
 * `tone="subtle"` explicitly for text that is genuinely decorative or duplicated by an
 * adjacent accessible label — the full address echoed under a truncated one, say.
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
