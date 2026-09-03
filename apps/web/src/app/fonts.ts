import localFont from 'next/font/local';
import { Anton, Inter, Caveat } from 'next/font/google';
import { GeistMono } from 'geist/font/mono';

/**
 * Satoshi — display + UI (docs/BRAND.md §3).
 * Self-hosted variable cut (wght 300–900) from Fontshare, so all four brand
 * weights (400 / 500 / 700 / 900) ship in a single 42 KB woff2 with no
 * network round-trip and no layout shift.
 */
export const satoshi = localFont({
  src: [
    {
      path: '../fonts/Satoshi-Variable.woff2',
      weight: '300 900',
      style: 'normal',
    },
  ],
  variable: '--font-satoshi',
  display: 'swap',
  preload: true,
  // Metric-matched fallback so swapping in Satoshi does not reflow the page.
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  adjustFontFallback: 'Arial',
});

/** Geist Mono — every numeral, ratio and address. */
export const geistMono = GeistMono;

/**
 * UGLYCASH marketing landing — sticker-brutalist type, scoped to `/`.
 *
 * Anton is the free stand-in for the licensed Helvetica Now Display Cn Bold:
 * one ultra-condensed heavyweight cut, used only for the giant black headlines.
 * Inter carries all body / UI / nav / caption text. Caveat is the single
 * optional handwritten accent, used once. None of these touch /app or /docs —
 * those keep Satoshi + Geist; these variables are only referenced under
 * `.landing` in landing.css.
 */
export const anton = Anton({
  weight: '400', // Anton ships a single ultra-bold weight
  subsets: ['latin'],
  variable: '--font-anton',
  display: 'swap',
  fallback: ['Arial Narrow', 'Roboto Condensed', 'sans-serif'],
});

export const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
});

export const caveat = Caveat({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-caveat',
  display: 'swap',
  fallback: ['ui-sans-serif', 'cursive'],
});

/**
 * Neue Montreal — the landing's body/UI face, matching the iOS app. Self-hosted
 * (Light 300 / Regular 400 / Medium 500 / Bold 700) as woff2, ~24 KB each. The
 * leading/display face is SF Pro Rounded, served from the platform via the
 * `ui-rounded` generic in landing.css — no file, crisp on Apple devices.
 */
/**
 * SF Pro Rounded — the landing's display/leading face, self-hosted from the
 * Regular cut so it renders everywhere (not only on Apple devices via
 * `ui-rounded`). One weight; heavier display weights synthesise from it.
 */
export const sfProRounded = localFont({
  src: [{ path: '../fonts/SFProRounded-Regular.woff2', weight: '400 700', style: 'normal' }],
  variable: '--font-sf-rounded',
  display: 'swap',
  preload: true,
  fallback: ['ui-rounded', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
});

export const neueMontreal = localFont({
  src: [
    { path: '../fonts/NeueMontreal-Light.woff2', weight: '300', style: 'normal' },
    { path: '../fonts/NeueMontreal-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/NeueMontreal-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/NeueMontreal-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-neue',
  display: 'swap',
  preload: true,
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
});
