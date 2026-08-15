import localFont from 'next/font/local';
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
