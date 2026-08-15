import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { satoshi, geistMono } from './fonts';
import './globals.css';

const title = 'Maren Finance — Spend Bitcoin. Never sell it.';
const description =
  'Bitcoin-backed liquidity. Deposit from 0.001 BTC, draw MUSD, and spend it without holding a gas balance. Built on Mezo.';

export const metadata: Metadata = {
  metadataBase: new URL('https://maren.finance'),
  title: {
    default: title,
    template: '%s — Maren Finance',
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
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
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
    <html lang="en" className={`${satoshi.variable} ${geistMono.variable}`}>
      <body className="bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
