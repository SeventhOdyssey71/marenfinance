import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/app/app-shell';
import { AppProviders } from './providers';

/** The browser client is part of the public Mezo testnet release. */
export const metadata: Metadata = {
  title: {
    default: 'App',
    template: '%s · Maren App',
  },
  description:
    'Borrow against testnet Bitcoin, make MUSD payments and manage your position on Mezo testnet. Pre-audit; testnet funds only.',
  robots: { index: false, follow: true },
};

/**
 * The /app subtree renders per-request (wallet/chain state), so it opts INTO dynamic
 * here rather than at the root — that kept the whole site, including the static /docs
 * MDX pages, from prerendering and 500'd /docs in production.
 */
export const dynamic = 'force-dynamic';

/**
 * The app shell.
 *
 * Everything below the nav is a client tree because it reads chain state; the layout
 * itself stays a server component so the wallet stack is not in the marketing bundle.
 * The chrome — the desktop sidebar, the mobile bottom nav, the connect control and the
 * pre-audit disclosure — lives in `AppShell`.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      {/* Overscroll rubber-banding shows the canvas, not the white page behind it. */}
      <style>{`body:has(#app-content){background-color:var(--color-canvas)}`}</style>
      <AppShell>{children}</AppShell>
    </AppProviders>
  );
}
