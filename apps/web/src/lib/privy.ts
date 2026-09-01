import { mezoMainnet, mezoTestnet } from '@maren/sdk';
import type { PrivyClientConfig } from '@privy-io/react-auth';
import { createConfig as createPrivyWagmiConfig } from '@privy-io/wagmi';

import { mezoTransport } from './chain/transport';

/**
 * Google / embedded-wallet sign-in via Privy, bridged onto the app's existing wagmi
 * setup so every `useAccount`/`useReadContract` keeps working unchanged.
 *
 * GATED ON A SINGLE ENV VAR. `NEXT_PUBLIC_PRIVY_APP_ID` is the whole switch: with it set,
 * `providers.tsx` mounts `PrivyProvider` and the config below; without it, the app never
 * touches Privy and falls back to the plain wallet-connect flow in `wagmi.ts`. Nothing
 * here throws when the var is missing — `privyConfigured` is simply `false` and no Privy
 * hook is ever mounted, so a fresh checkout with no Privy account still builds and runs.
 */

export const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/** True when a Privy app ID is configured. The one gate for the whole Google flow. */
export const privyConfigured = Boolean(privyAppId);

/**
 * The wagmi config Privy drives.
 *
 * Built with `@privy-io/wagmi`'s `createConfig`, NOT plain wagmi, so Privy's embedded
 * wallet becomes the active connector once a user signs in. Unlike `wagmi.ts` this passes
 * no `connectors`: Privy owns the connector list (the embedded wallet plus whatever
 * external wallet a user picks in Privy's modal), and declaring our own would fight it.
 *
 * Everything that is NOT connectors is carried over verbatim from `wagmi.ts`, because the
 * rest of the app depends on it:
 *   - the failover `mezoTransport` over the whole RPC list (see `chain/transport.ts`),
 *   - the Multicall3 batching window (`batchSize`/`wait`) every contract read coalesces
 *     through, and
 *   - `ssr: true`, so the first client paint hydrates without a wagmi state mismatch.
 */
export const privyWagmiConfig = createPrivyWagmiConfig({
  chains: [mezoTestnet, mezoMainnet],
  transports: {
    [mezoTestnet.id]: mezoTransport(mezoTestnet),
    [mezoMainnet.id]: mezoTransport(mezoMainnet),
  },
  batch: { multicall: { batchSize: 2_048, wait: 16 } },
  ssr: true,
});

/**
 * Privy client config.
 *
 * `google` first, `wallet` second — the whole point is that a Bitcoin holder can arrive
 * with no wallet at all. `createOnLogin: 'users-without-wallets'` mints a Mezo EOA only
 * for those who need one, so a user who signs in with an external wallet is not handed a
 * second, empty embedded one.
 *
 * `defaultChain`/`supportedChains` are the SDK's Mezo chains (viem `Chain` objects from
 * `defineChain`), testnet 31611 default. Setting `defaultChain` also makes Privy prompt a
 * connected external wallet onto Mezo, which is the same job `network-guard.tsx` does for
 * the wagmi-only path.
 *
 * `appearance` matches Maren's light-violet brand so the Privy modal does not look like a
 * bolted-on third-party sheet.
 */
export const privyClientConfig: PrivyClientConfig = {
  loginMethods: ['google', 'wallet'],
  embeddedWallets: {
    ethereum: { createOnLogin: 'users-without-wallets' },
  },
  defaultChain: mezoTestnet,
  supportedChains: [mezoTestnet, mezoMainnet],
  appearance: {
    theme: 'light',
    accentColor: '#5B3DF5',
    walletChainType: 'ethereum-only',
  },
};
