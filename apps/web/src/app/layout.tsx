import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { satoshi, geistMono, neueMontreal, sfProRounded } from './fonts';
import './globals.css';

const title = 'Maren Finance: Spend Bitcoin. Never sell it.';
const description =
  'Join the Maren iOS beta on Mezo testnet. Borrow MUSD against testnet Bitcoin and pay by handle. Pre-audit; testnet funds only.';

/**
 * The origin every relative metadata URL is resolved against — including the social card.
 *
 * This was hardcoded to `https://maren.finance`, which has **no DNS records**: every crawler
 * that tried to fetch the card would have resolved it against a host that does not exist, so
 * the card could never have rendered even once one was added. It now follows the deployment.
 * Vercel sets VERCEL_PROJECT_PRODUCTION_URL on every build, so this tracks the live origin
 * automatically and needs no edit when the custom domain is finally pointed at it.
 */
const origin = process.env.NEXT_PUBLIC_SITE_ORIGIN
  ? process.env.NEXT_PUBLIC_SITE_ORIGIN
  : process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000';

/**
 * Open Graph / Twitter card. 1200x630 is what X, LinkedIn, Slack and iMessage crop toward.
 * Regenerate with `node tools/og/render.mjs` after changing the headline — the template at
 * tools/og/card.html is the source of truth, the PNG is a build artefact.
 */
const ogImage = {
  url: '/og.png',
  width: 1200,
  height: 630,
  alt: 'Maren: spend Bitcoin, never sell it. Borrow MUSD against your Bitcoin and pay anyone by handle.',
};

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: {
    default: title,
    template: '%s · Maren Finance',
  },
  description,
  applicationName: 'Maren Finance',
  keywords: [
    'Bitcoin',
    'Mezo',
    'MUSD',
    'Bitcoin-backed loans',
    'gasless',
    'DeFi',
    'stablecoin payments',
  ],
  openGraph: {
    type: 'website',
    siteName: 'Maren Finance',
    title,
    description,
    url: '/',
    images: [ogImage],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [ogImage],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#08080A',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${satoshi.variable} ${geistMono.variable} ${neueMontreal.variable} ${sfProRounded.variable}`}
    >
      <body className="bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
