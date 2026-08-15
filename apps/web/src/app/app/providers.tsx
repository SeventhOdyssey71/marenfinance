'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';

import { wagmiConfig } from '@/lib/wagmi';

/**
 * Providers for the app surface only. The marketing pages stay static — there is no
 * reason for a landing page to ship a wallet stack.
 *
 * The QueryClient is created inside state rather than at module scope so it is never
 * shared between requests on the server.
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

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
