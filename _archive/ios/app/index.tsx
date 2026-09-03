import { Redirect } from 'expo-router';

import { useAppStore } from '../src/state/store';

/**
 * The entry gate: an account exists, or it does not.
 *
 * Presence of a wallet address in the store is the only thing consulted. The key itself
 * is never read here — doing so would fire a Face ID prompt on every cold start, which
 * is both hostile and unnecessary to answer the question "has this person onboarded".
 *
 * WHY THIS WAITS ON `hydrated`. The session is persisted (see `state/store.ts`) and read
 * back from the Keychain asynchronously on launch. Before that read lands, `address` is
 * still its initial null, so routing on it would flash onboarding at a user who has
 * already onboarded and then redirect them a beat later. The store flips `hydrated` only
 * once rehydration has completed AND seeded the read context, so gating on it here means
 * the first route decision is made against the real session, with reads already able to
 * run. `null` renders nothing for the frame or two that takes; the splash screen covers
 * it. The flag is never set from this component — doing so would race the async read and
 * defeat the entire point.
 */
export default function Index() {
  const address = useAppStore((s) => s.address);
  const hydrated = useAppStore((s) => s.hydrated);

  if (!hydrated) return null;
  return address ? <Redirect href="/(tabs)" /> : <Redirect href="/onboarding" />;
}
