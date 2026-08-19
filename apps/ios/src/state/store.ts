import type { Address } from 'viem';
import { create } from 'zustand';
import type { MezoNetwork } from '@maren/sdk';

import type { KeyProtection } from '../wallet/keystore';
import { setReadContext } from '../data/context';
import { setDataSource, setForcedStaleSeconds, type DataSourceKind } from '../data/source';

/**
 * Local UI and account state. Zustand, per ARCHITECTURE.md §5.
 *
 * The private key is deliberately absent from this store and from every type in it.
 * The only thing recorded here is the address and *how* the key is protected, so the
 * UI can describe the protection accurately without ever being able to read the key.
 *
 * The store is also where the read layer learns WHO and WHERE it is reading for. The
 * account and the network are pushed into `data/context.ts` on every change, which is
 * what lets `readPosition()` and friends keep the zero-argument signatures `mock.ts`
 * promised their live replacements would have. See the note in that file.
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
  /**
   * Where the numbers come from. 'live' is the default and the resting state; 'mock' is
   * reachable only from Settings → Developer and is labelled on every screen it feeds.
   */
  dataSource: DataSourceKind;

  setAccount: (account: AccountState) => void;
  setHandle: (handle: string | null) => void;
  setNetwork: (network: MezoNetwork) => void;
  setHydrated: (value: boolean) => void;
  toggleAmountsHidden: () => void;
  setForcedStale: (seconds: number) => void;
  setDataSourceKind: (kind: DataSourceKind) => void;
  signOut: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  address: null,
  handle: null,
  protection: null,
  // Defaults to testnet. `resolveNetwork` in the SDK does the same thing for the same
  // reason: the safe default is the network where a mistake costs nothing.
  network: 'testnet',
  hydrated: false,
  amountsHidden: false,
  forcedStaleSeconds: 0,
  dataSource: 'live',

  setAccount: (account) => {
    set(account);
    setReadContext({ network: get().network, account: account.address });
  },
  setHandle: (handle) => set({ handle }),
  setNetwork: (network) => {
    set({ network });
    setReadContext({ network, account: get().address });
  },
  setHydrated: (hydrated) => set({ hydrated }),
  toggleAmountsHidden: () => set((s) => ({ amountsHidden: !s.amountsHidden })),
  setForcedStale: (seconds) => {
    setForcedStaleSeconds(seconds);
    set({ forcedStaleSeconds: seconds });
  },
  setDataSourceKind: (kind) => {
    setDataSource(kind);
    set({ dataSource: kind });
  },
  signOut: () => {
    set({ address: null, handle: null, protection: null });
    // The read context is cleared with the account, so a read issued during the
    // navigation back to onboarding throws "no account" rather than quietly reading the
    // previous person's position.
    setReadContext({ network: get().network, account: null });
  },
}));
