import type { Address } from 'viem';
import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
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
 *
 * ── PERSISTENCE ────────────────────────────────────────────────────────────────
 *
 * The session outlives a cold start. WITHOUT this, every launch found `address` null
 * and forced onboarding again even though the signing key was still safe in the
 * Keychain — the key survived, the app's memory of WHOSE key it was did not, and the
 * two have to agree or the app cannot read a position on the first render.
 *
 * ONLY NON-SENSITIVE SESSION FIELDS ARE WRITTEN (see `partialize`): the address, the
 * chosen handle, how the key is protected, the network, the data source and the
 * shoulder-surf toggle. The PRIVATE KEY IS NEVER HERE and never persisted by this
 * store — it lives in the Keychain via `wallet/keystore.ts`, gated on Face ID, and the
 * store has only ever held the address derived from it.
 *
 * The backing store is `expo-secure-store` rather than a new AsyncStorage dependency:
 * it is already linked into this app for the key itself, so persistence adds no native
 * module. The item is written WITHOUT `requireAuthentication`, so rehydrating the
 * session on launch costs no biometric prompt — reading the address is not reading the
 * key, and `app/index.tsx` deliberately answers "has this person onboarded" from the
 * address alone precisely so a cold start never fires Face ID.
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

/** The Keychain item the persisted session lives under. Bumped if the shape changes. */
const SESSION_STORAGE_KEY = 'maren.session.v1';

/**
 * `expo-secure-store` behind zustand's `StateStorage` interface.
 *
 * No `requireAuthentication` on any call: this holds the session shell, never a secret,
 * and rehydration must not prompt for Face ID. The default keychain accessibility keeps
 * it on-device.
 */
const secureStorage: StateStorage = {
  getItem: (name) => SecureStore.getItemAsync(name),
  setItem: (name, value) => SecureStore.setItemAsync(name, value),
  removeItem: (name) => SecureStore.deleteItemAsync(name),
};

/**
 * Push the rehydrated (or default) session into the read layer.
 *
 * CRITICAL, and the reason this is a named function rather than an inline closure: a
 * rehydrated address with a null read context reads with no account, and every position
 * and balance read then throws "No account is loaded". So the context and the data
 * source are set from the persisted values BEFORE the first gated render, exactly as the
 * store's own setters do on a live change.
 */
function applySessionToReadLayer(session: {
  network: MezoNetwork;
  address: Address | null;
  dataSource: DataSourceKind;
}): void {
  setDataSource(session.dataSource);
  setReadContext({ network: session.network, account: session.address });
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
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
        // previous person's position. Persisting the nulled fields (partialize includes
        // them) is what clears the stored session too, so the next cold start onboards.
        setReadContext({ network: get().network, account: null });
      },
    }),
    {
      name: SESSION_STORAGE_KEY,
      storage: createJSONStorage(() => secureStorage),
      version: 1,
      /**
       * ONLY the non-sensitive session shell is written. `hydrated`, `forcedStaleSeconds`
       * and every function are omitted: `hydrated` is a per-launch fact, the stale toggle
       * is a developer control that must not survive a restart, and functions do not
       * serialise. There is deliberately nothing here a private key could hide inside.
       */
      partialize: (s) => ({
        address: s.address,
        handle: s.handle,
        protection: s.protection,
        network: s.network,
        dataSource: s.dataSource,
        amountsHidden: s.amountsHidden,
      }),
      /**
       * Runs once the (async) read from the Keychain has completed, on success AND on
       * error. It seeds the read layer from whatever was rehydrated and only THEN flips
       * `hydrated`, so `app/index.tsx` cannot route until the context is live. On error the
       * defaults apply and the flag still flips — a Keychain hiccup must not strand the app
       * on a blank gate forever.
       */
      onRehydrateStorage: () => (state, error) => {
        applySessionToReadLayer({
          network: state?.network ?? 'testnet',
          address: state?.address ?? null,
          dataSource: state?.dataSource ?? 'live',
        });
        if (error) {
          // Nothing to report to the user: a missing or unreadable session shell is
          // indistinguishable from a first launch, and both correctly land on onboarding.
        }
        useAppStore.setState({ hydrated: true });
      },
    },
  ),
);
