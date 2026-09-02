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
