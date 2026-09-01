import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/app/app-shell';
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
 * Everything below the nav is a client tree because it reads chain state; the layout
 * itself stays a server component so the wallet stack is not in the marketing bundle.
 * The chrome — the desktop sidebar, the mobile bottom nav, the connect control and the
 * pre-audit disclosure — lives in `AppShell`.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      {/* The app is the light world; the marketing site stays dark. The attribute
          re-derives every colour token for this whole subtree (globals.css), and the
          inline body rule keeps overscroll rubber-banding light instead of flashing
          the marketing background behind it. */}
      <style>{`body:has([data-app-theme='light']){background-color:#f7f6fb}`}</style>
      <div data-app-theme="light" className="bg-bg text-text min-h-screen">
        <AppShell>{children}</AppShell>
      </div>
    </AppProviders>
  );
}
