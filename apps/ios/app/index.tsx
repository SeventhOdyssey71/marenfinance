import { useEffect } from 'react';
import { Redirect } from 'expo-router';

import { useAppStore } from '../src/state/store';

/**
 * The entry gate: an account exists, or it does not.
 *
 * Presence of a wallet address in the store is the only thing consulted. The key itself
 * is never read here — doing so would fire a Face ID prompt on every cold start, which
 * is both hostile and unnecessary to answer the question "has this person onboarded".
 */
export default function Index() {
  const address = useAppStore((s) => s.address);
  const hydrated = useAppStore((s) => s.hydrated);
  const setHydrated = useAppStore((s) => s.setHydrated);

  useEffect(() => {
    if (!hydrated) setHydrated(true);
  }, [hydrated, setHydrated]);

  if (!hydrated) return null;
  return address ? <Redirect href="/(tabs)" /> : <Redirect href="/onboarding" />;
}
