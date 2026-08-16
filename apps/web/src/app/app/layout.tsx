import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppNav } from '@/components/app/app-nav';
import { ChainStatus, VaultProvenance } from '@/components/app/chain-status';
import { NetworkGuard } from '@/components/app/wallet';
import { AppProviders } from './providers';

export const metadata: Metadata = {
  title: {
    default: 'App',
    template: '%s · Maren App',
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
      {/* Removed on the owner's direct instruction — see the note in `app/page.tsx`.
          `#app-content` is still on <main> below, so restoring the link is one element. */}
      <AppNav />

      <main id="app-content" className="container-maren pb-24 pt-8">
        <div className="flex flex-col gap-6">
          <NetworkGuard />
          <ChainStatus />
        </div>
        <div className="mt-8">{children}</div>
      </main>

      <footer className="hairline-t">
        <div className="container-maren text-text-subtle flex flex-wrap items-center justify-between gap-4 py-8 text-xs">
          {/* Kept in full: an unaudited contract holding user funds, and pooled
              collateral segregated in accounting rather than custody, are the two facts
              a user most needs and least expects. Tightened to one sentence, not cut. */}
          <p className="max-w-[68ch] leading-relaxed">
            Pre-audit: MarenVault and MarenPay hold user funds and have not been audited. Pooled
            collateral is segregated in accounting, not custody.
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <VaultProvenance />
            <a
              href="https://github.com/SeventhOdyssey71/marenfinance/tree/main/docs"
              target="_blank"
              rel="noreferrer noopener"
              className="text-text-muted hover:text-text transition-colors duration-[120ms] ease-out"
            >
              Docs
            </a>
          </div>
        </div>
      </footer>
    </AppProviders>
  );
}
