import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppNav } from '@/components/app/app-nav';
import { DataModeBanner } from '@/components/app/data-mode';
import { NetworkGuard } from '@/components/app/wallet';
import { AppProviders } from './providers';

export const metadata: Metadata = {
  title: {
    default: 'App',
    template: '%s — Maren App',
  },
  description:
    'Bitcoin-backed credit, gasless payments and trailing yield on Mezo. Position health, borrowing capacity and history in one place.',
  robots: { index: false, follow: true },
};

/**
 * The app shell.
 *
 * Everything below the nav is a client tree because it reads chain state; the shell
 * itself stays a server component so the wallet stack is not in the marketing bundle.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      <a
        href="#app-content"
        className="sr-only rounded-[var(--radius-pill)] bg-white px-5 py-3 text-sm font-medium text-[#08080A] focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50"
      >
        Skip to content
      </a>

      <AppNav />

      <main id="app-content" className="container-maren pt-8 pb-24">
        <div className="flex flex-col gap-6">
          <NetworkGuard />
          <DataModeBanner />
        </div>
        <div className="mt-8">{children}</div>
      </main>

      <footer className="hairline-t">
        <div className="container-maren flex flex-wrap items-center justify-between gap-4 py-8 text-xs text-text-subtle">
          <p className="max-w-[68ch] leading-relaxed">
            Pre-audit. MarenVault and MarenPay carry user funds and have not been audited
            by a third party. Pooled positions share one trove: collateral is segregated
            in accounting, not in custody.
          </p>
          <a
            href="https://github.com/SeventhOdyssey71/marenfinance/tree/main/docs"
            target="_blank"
            rel="noreferrer noopener"
            className="text-text-muted transition-colors duration-[120ms] ease-out hover:text-text"
          >
            Docs
          </a>
        </div>
      </footer>
    </AppProviders>
  );
}
