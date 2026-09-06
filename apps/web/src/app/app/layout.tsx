import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { AppShell } from '@/components/app/app-shell';
import { AppProviders } from './providers';

/**
 * The web app is OFF in production while the launch focuses on the iOS beta.
 *
 * Gated rather than deleted: the whole /app subtree still builds, still runs locally,
 * and comes back by setting MAREN_WEB_APP_ENABLED=true on the Vercel project — no code
 * change, no revert of a large deletion. Deleting it would also silently rot the parts
 * of packages/sdk that only this subtree exercises.
 *
 * Development is always on, so nobody has to set an env var to work on it. Preview
 * deployments follow the same flag as production, so what is checked on a preview URL
 * is what ships.
 */
const WEB_APP_ENABLED =
  process.env.MAREN_WEB_APP_ENABLED === 'true' || process.env.NODE_ENV === 'development';

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
  // Before any provider mounts: a disabled web app must not connect a wallet, open an
  // RPC transport or read chain state just to render a 404.
  if (!WEB_APP_ENABLED) notFound();

  return (
    <AppProviders>
      {/* The app is the light world; the marketing site stays dark. The attribute
          re-derives every colour token for this whole subtree (globals.css), and the
          inline body rule keeps overscroll rubber-banding light instead of flashing
          the marketing background behind it. */}
      <style>{`body:has([data-app-theme='light']){background-color:#f2f2f2}`}</style>
      <div data-app-theme="light" className="bg-bg text-text min-h-screen">
        <AppShell>{children}</AppShell>
      </div>
    </AppProviders>
  );
}
