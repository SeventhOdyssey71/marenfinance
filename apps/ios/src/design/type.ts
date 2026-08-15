import type { TextStyle } from 'react-native';

import { text } from './tokens';

/**
 * Typography — docs/BRAND.md §3.
 *
 * Satoshi for display and UI. Geist Mono for every numeral, address and hash, always
 * with tabular figures so digits do not jitter as values update.
 *
 * BRAND.md §3 is explicit about the fallback: if Satoshi cannot be fetched, fall back to
 * Geist Sans — never silently substitute Inter, which reads generic. On iOS the honest
 * last resort is the system font, so the stack is Satoshi → Geist → system. We never
 * name Inter anywhere.
 */
export const fonts = {
  regular: 'Satoshi-Regular',
  medium: 'Satoshi-Medium',
  bold: 'Satoshi-Bold',
  black: 'Satoshi-Black',
  mono: 'GeistMono-Regular',
  monoMedium: 'GeistMono-Medium',
} as const;

/** The `fontVariant` that makes Geist Mono's digits align in a column. */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * §3 Scale. The web `clamp()` display size collapses to a single phone-width value;
 * everything else is transcribed directly. Line heights are the ratios from BRAND.md
 * multiplied out, because React Native takes lineHeight in points.
 */
export const type = {
  display: {
    fontFamily: fonts.bold,
    fontSize: 44,
    lineHeight: 45,
    letterSpacing: -1.32, // -0.03em
  },
  h1: {
    fontFamily: fonts.bold,
    fontSize: 34,
    lineHeight: 37,
    letterSpacing: -0.85, // -0.025em
  },
  h2: {
    fontFamily: fonts.bold,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.52, // -0.02em
  },
  h3: {
    fontFamily: fonts.medium,
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: -0.18, // -0.01em
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 26,
    letterSpacing: 0,
  },
  small: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    letterSpacing: 0,
  },
  /** §3 Label: 0.75rem / 1.4, weight 500, tracking 0.06em, uppercase. */
  label: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.72, // 0.06em
    textTransform: 'uppercase',
  },
  /** §3 Numeric-XL: 3rem / 1, mono 500, -0.02em. */
  numericXl: {
    fontFamily: fonts.monoMedium,
    fontSize: 44,
    lineHeight: 44,
    letterSpacing: -0.88,
    ...tabular,
  },
  numericLg: {
    fontFamily: fonts.monoMedium,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.56,
    ...tabular,
  },
  numeric: {
    fontFamily: fonts.mono,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.16,
    ...tabular,
  },
  numericSm: {
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
    ...tabular,
  },
} satisfies Record<string, TextStyle>;

export const textColors = text;
