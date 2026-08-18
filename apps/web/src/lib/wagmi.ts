import { mezoMainnet, mezoTestnet } from '@maren/sdk';
import { createConfig } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';

import { mezoTransport } from './chain/transport';

/**
 * Wallet configuration.
 *
 * Mezo is a standard EVM chain, so there is no special SDK: an injected wallet and
 * WalletConnect cover it. Both chains are registered even though the app targets one at
 * a time, because a user on the wrong one must be offered a switch rather than a dead
 * end — see `components/app/network-guard.tsx`.
 *
 * TRANSPORTS FAIL OVER. This file used to call `http()` with no URL, which reads the
 * chain's `rpcUrls.default.http` list and then uses only the FIRST entry — so the failover
 * that `chains.ts` spends thirty lines arguing is mandatory was not actually happening,
 * and a bad hour at one host was a dead app. `mezoTransport` builds a `fallback()` over the
 * whole list with measured timeouts; see `chain/transport.ts` for the numbers and why they
 * are what they are.
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
    [mezoTestnet.id]: mezoTransport(mezoTestnet),
    [mezoMainnet.id]: mezoTransport(mezoMainnet),
  },
  /**
   * EVERY CONTRACT READ GOES THROUGH MULTICALL3, AND THAT IS STATED HERE RATHER THAN
   * INHERITED.
   *
   * wagmi happens to default `batch` to `{ multicall: true }`, so this app was already
   * coalescing reads without anybody deciding to — the whole read budget of the product
   * rested on a library default that nothing in the repository mentioned and no test
   * pinned. Declaring it makes it ours: `apps/web/scripts/count-rpc.mjs` measures the
   * result, and a future wagmi that changes its mind cannot silently turn one request per
   * screen back into twenty.
   *
   * Both chains declare Multicall3 at the canonical address in `chains.ts`, mainnet with
   * the `blockCreated` viem needs in order to refuse the batch on any block older than the
   * deployment rather than decode garbage from an empty account.
   *
   * `wait: 16` widens the coalescing window from viem's default of 0ms. At 0 only reads
   * issued in the same microtask merge, which misses hooks that mount a tick apart —
   * exactly what the portfolio does, where the position read and the vault reads it
   * implies landed in two separate requests. One frame of delay buys one round trip
   * instead of two, and 16ms is under the threshold at which a person can see it.
   *
   * `batchSize` is calldata bytes, not calls. 1024 was enough to hold eighteen reads but
   * not the twenty-four a portfolio now issues in one window, and splitting the batch
   * would put the second request back.
   */
  batch: { multicall: { batchSize: 2_048, wait: 16 } },
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
