import { useEffect, useSyncExternalStore } from 'react';

import type { PriceFeed } from '../chain/price';

/**
 * This session's live BTC/USD observations, in order.
 *
 * Maren has no price-history indexer, so there is no honest way to draw yesterday's price.
 * What there IS honestly is this: the home screen polls the oracle every 15 seconds
 * (usePrice), and each poll that comes back `live` is a real, checkable observation that
 * happened while the app was open. Recording those as they arrive builds a short trend
 * that is true by construction — it is exactly the samples the user's own session saw,
 * nothing back-filled and nothing invented. It resets when the process does, which is the
 * honest lifetime of a thing that was never persisted.
 *
 * The series lives in a tiny external store rather than component state: it is shared,
 * it outlives any one screen's mount, and reading it through useSyncExternalStore is the
 * React-endorsed way to subscribe to something outside the tree — no setState-in-effect,
 * no cascading render. Observations are keyed by the oracle's own `observedAt`, so the 1s
 * wall-clock re-renders inside usePrice cannot log the same one twice.
 */

interface Sample {
  observedAt: number;
  /** USD, two decimals — enough for a sparkline's shape, and safe from bigint→Number loss. */
  usd: number;
}

const MAX_SAMPLES = 32;

let samples: Sample[] = [];
/** The cached numeric snapshot handed to consumers; a new array only when it changes. */
let snapshot: number[] = [];
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number[] {
  return snapshot;
}

/** Fold a live observation into the series. A no-op if it is one we already hold. */
export function recordLivePrice(observedAt: number, priceWei: bigint): void {
  const latest = samples[samples.length - 1];
  if (latest && latest.observedAt === observedAt) return;

  // Divide in bigint before the Number cast so a ~$60k price never rounds at 2^53.
  const usd = Number(priceWei / 10n ** 16n) / 100;
  const next = [...samples, { observedAt, usd }];
  samples = next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
  snapshot = samples.map((s) => s.usd);

  for (const listener of listeners) listener();
}

/**
 * Fold the current feed into the session series and return the numbers for a Sparkline.
 *
 * Takes the feed the caller already holds rather than calling usePrice again, so there is
 * one poll and one subscription, not two.
 */
export function useSessionPriceSeries(feed: PriceFeed): number[] {
  const observedAt = feed.state === 'live' ? feed.observedAt : null;

  useEffect(() => {
    // Recording updates an external store; useSyncExternalStore re-renders subscribers.
    if (feed.state === 'live') recordLivePrice(feed.observedAt, feed.priceWei);
    // `observedAt` is the honest dependency: a new live observation, and only that,
    // appends a point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observedAt]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
