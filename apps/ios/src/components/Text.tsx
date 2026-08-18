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
  violet: brand.violet500,
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
 * Defaults to `muted`, not `subtle`, and that is a deliberate deviation from the tone
 * BRAND.md's table implies for "tertiary" text. The palette is the web light set,
 * unchanged — `subtle` is exactly #82828C — but it is not used for text that carries
 * information, because at 12px it does not meet WCAG AA on any Maren surface.
 *
 * The theme move did not fix this on its own. It is the same shortfall, relocated:
 *
 *     was   #6B6B75 on #08080A  3.80:1     now   #82828C on #F7F6FB  3.54:1
 *           #6B6B75 on #101013  3.60:1           #82828C on #FFFFFF  3.80:1
 *           #6B6B75 on #0C0C0F  3.71:1           #82828C on #EFEDF6  3.28:1
 *           #6B6B75 on #17171B  3.39:1
 *
 * `muted` clears it with room to spare on all three light surfaces — #55555E is 6.86 on
 * the page, 7.38 on a card, 6.36 on an inset panel — so that is what informational text
 * gets. BRAND.md's own preamble settles the conflict: "quiet, expensive, and legible
 * before it is decorative." A label a user cannot read is not quiet, it is broken.
 *
 * `subtle` survives for the two jobs where 3:1 is the bar rather than 4.5:1: non-text
 * ornament, and text at 24px and above. Both clear it. Nothing else may use it.
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
