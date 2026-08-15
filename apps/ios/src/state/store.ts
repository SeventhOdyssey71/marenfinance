import type { Address } from 'viem';
import { create } from 'zustand';
import type { MezoNetwork } from '@maren/sdk';

import type { KeyProtection } from '../wallet/keystore';
import { setForcedStaleSeconds } from '../data/mock';

/**
 * Local UI and account state. Zustand, per ARCHITECTURE.md §5.
 *
 * The private key is deliberately absent from this store and from every type in it.
 * The only thing recorded here is the address and *how* the key is protected, so the
 * UI can describe the protection accurately without ever being able to read the key.
 */

export interface AccountState {
  address: Address | null;
  handle: string | null;
  protection: KeyProtection | null;
}

interface AppState extends AccountState {
  network: MezoNetwork;
  hydrated: boolean;
  /** Hide balances — a shoulder-surfing guard, not a security control. */
  amountsHidden: boolean;
  /** Developer-only: backdate the oracle observation to exercise the stale state. */
  forcedStaleSeconds: number;

  setAccount: (account: AccountState) => void;
  setHandle: (handle: string | null) => void;
  setNetwork: (network: MezoNetwork) => void;
  setHydrated: (value: boolean) => void;
  toggleAmountsHidden: () => void;
  setForcedStale: (seconds: number) => void;
  signOut: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  address: null,
  handle: null,
  protection: null,
  // Defaults to testnet. `resolveNetwork` in the SDK does the same thing for the same
  // reason: the safe default is the network where a mistake costs nothing.
  network: 'testnet',
  hydrated: false,
  amountsHidden: false,
  forcedStaleSeconds: 0,

  setAccount: (account) => set(account),
  setHandle: (handle) => set({ handle }),
  setNetwork: (network) => set({ network }),
  setHydrated: (hydrated) => set({ hydrated }),
  toggleAmountsHidden: () => set((s) => ({ amountsHidden: !s.amountsHidden })),
  setForcedStale: (seconds) => {
    setForcedStaleSeconds(seconds);
    set({ forcedStaleSeconds: seconds });
  },
  signOut: () => set({ address: null, handle: null, protection: null }),
}));
