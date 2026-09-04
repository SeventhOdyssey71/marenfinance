import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppProviders } from '../app/providers';

export const metadata: Metadata = {
  title: 'Claim a link',
  description: 'Claim a Maren payment link into your own wallet.',
  // A claim URL carries a bearer secret in its fragment. It must never be indexed, and the
  // fragment is not sent to a crawler anyway, but this makes the intent explicit.
  robots: { index: false, follow: false },
};

/**
 * The claim surface reads per-request wallet and chain state, so it opts into dynamic here
 * for the same reason the /app subtree does — it must not be prerendered.
 */
export const dynamic = 'force-dynamic';

/**
 * Wallet + query context for the claim page, and the app's light world.
 *
 * It reuses the same `AppProviders` the /app subtree mounts, so a claimer connects with the
 * exact wallet stack they would inside the app. The light theme attribute re-derives the
 * colour tokens for this subtree the same way the app layout does.
 */
export default function ClaimLayout({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      <style>{`body:has([data-app-theme='light']){background-color:#f2f2f2}`}</style>
      <div data-app-theme="light" className="bg-bg text-text min-h-screen">
        {children}
      </div>
    </AppProviders>
  );
}
