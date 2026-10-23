import localFont from 'next/font/local';
import { GeistMono } from 'geist/font/mono';

/**
 * Neue Montreal: the one typeface, on every surface (docs/BRAND.md §3).
 * Self-hosted woff2, ~24 KB per cut. Regular for reading, Medium for anything that
 * leads; Light is kept for very large display sizes only.
 */
export const neueMontreal = localFont({
  src: [
    { path: '../fonts/NeueMontreal-Light.woff2', weight: '300', style: 'normal' },
    { path: '../fonts/NeueMontreal-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/NeueMontreal-Medium.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-neue',
  display: 'swap',
  preload: true,
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  adjustFontFallback: 'Arial',
});

/**
 * Geist Mono: machine strings only. Addresses, hashes and block numbers, where the
 * columns have to line up. Neue Montreal has no tabular figures to do that job.
 */
export const geistMono = GeistMono;
