'use client';

import { useState, type ReactNode } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider as PrivyWagmiProvider } from '@privy-io/wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';

import { privyAppId, privyClientConfig, privyConfigured, privyWagmiConfig } from '@/lib/privy';
import { wagmiConfig } from '@/lib/wagmi';

/**
 * Providers for the app surface only. The marketing pages stay static — there is no
 * reason for a landing page to ship a wallet stack.
 *
 * The QueryClient is created inside state rather than at module scope so it is never
 * shared between requests on the server.
 *
 * TWO SHAPES, ONE GATE. When `NEXT_PUBLIC_PRIVY_APP_ID` is set we mount Privy: its
 * provider wraps `@privy-io/wagmi`'s `WagmiProvider` so the embedded Google wallet is the
 * active connector. When it is unset we mount plain wagmi with the wallet-connect config
 * exactly as before. `privyConfigured` is a build-time constant, so the tree is stable
 * across renders — this is a configuration switch, not conditional hooks.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Chain data goes stale quickly and quietly. Ten seconds is short enough
            // that a position figure is never meaningfully old, long enough that
            // navigating between routes does not refetch everything twice.
            staleTime: 10_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  if (privyConfigured && privyAppId) {
    // Nesting order matters: PrivyProvider → QueryClientProvider → Privy's WagmiProvider,
    // the arrangement `@privy-io/wagmi` expects so wagmi can read Privy's connected wallet.
    return (
      <PrivyProvider appId={privyAppId} config={privyClientConfig}>
        <QueryClientProvider client={queryClient}>
          <PrivyWagmiProvider config={privyWagmiConfig}>{children}</PrivyWagmiProvider>
        </QueryClientProvider>
      </PrivyProvider>
    );
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
