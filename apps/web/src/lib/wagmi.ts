import { mezoMainnet, mezoTestnet } from '@maren/sdk';
import { createConfig, http } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';

/**
 * Wallet configuration.
 *
 * Mezo is a standard EVM chain, so there is no special SDK: an injected wallet and
 * WalletConnect cover it. Both chains are registered even though the app targets one at
 * a time, because a user on the wrong one must be offered a switch rather than a dead
 * end — see `components/app/network-guard.tsx`.
 *
 * Transports come from `@maren/sdk`'s chain definitions, which list Mezo's RPCs in
 * failover order. That ordering is load-bearing: Mezo's public RPCs are transiently
 * flaky and have been observed reporting `-32601 method not found` for methods they
 * support. viem's `http()` with no URL uses the chain's `rpcUrls.default.http` list.
 */

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

/**
 * WalletConnect is only registered when a project ID exists. Registering it without one
 * produces a connector that throws the moment it is clicked, which is a worse experience
 * than not offering it — so the button simply is not there.
 */
const connectors = [
  injected({ shimDisconnect: true }),
  ...(projectId
    ? [
        walletConnect({
          projectId,
          showQrModal: true,
          metadata: {
            name: 'Maren Finance',
            description: 'Spend Bitcoin. Never sell it.',
            url: 'https://maren.finance',
            icons: ['https://maren.finance/icon.svg'],
          },
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [mezoTestnet, mezoMainnet],
  connectors,
  transports: {
    [mezoTestnet.id]: http(),
    [mezoMainnet.id]: http(),
  },
  // The app renders on the server first; without this, wagmi's state hydrates into a
  // mismatch on the first client paint.
  ssr: true,
});

export const walletConnectAvailable = Boolean(projectId);

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
