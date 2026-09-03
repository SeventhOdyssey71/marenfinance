import { useEffect, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { assessHealth, type PositionHealth } from '@maren/sdk';

import { classifyPrice, type PriceFeed } from '../chain/price';
import {
  readActivity,
  readBalances,
  readEarn,
  readPosition,
  readPrice,
  reverseResolve,
} from '../data/source';
import type { ActivityWindow, Balances, EarnPosition, Position } from '../data/types';
import { useAppStore } from '../state/store';

/**
 * Chain reads, via TanStack Query per ARCHITECTURE.md §5.
 *
 * The price is polled every 15 seconds against a 60-second staleness limit, which gives
 * three chances to refresh before the oracle would reject the observation. `staleTime`
 * is 0 because a cached price is precisely the thing we must never render.
 *
 * EVERY KEY CARRIES THE ACCOUNT, THE NETWORK AND THE SOURCE. All three change what the
 * answer means. Without the account in the key, signing into a second wallet would show
 * the first one's position until the refetch landed; without the source in it, flipping
 * the demo toggle would leave read figures on screen under a demo banner, or the reverse.
 * A key is cheaper than either bug.
 */

export const queryKeys = {
  price: ['price'] as const,
  position: ['position'] as const,
  balances: ['balances'] as const,
  earn: ['earn'] as const,
  activity: ['activity'] as const,
  handle: ['primary-handle'] as const,
};

/**
 * The identity every query is scoped to.
 *
 * Returned as an array rather than an object because query keys are compared
 * structurally and an object would work but reads worse in the devtools.
 */
function useScope(): readonly unknown[] {
  const network = useAppStore((s) => s.network);
  const address = useAppStore((s) => s.address);
  const dataSource = useAppStore((s) => s.dataSource);
  return [network, address ?? 'no-account', dataSource];
}

/**
 * A wall clock that ticks, in unix seconds.
 *
 * `Date.now()` read during render is impure: the value changes without any state
 * changing, so the age of an observation only advanced when something else happened to
 * re-render the tree. A price could sit on screen reading "12s ago" for a minute. This
 * makes the passage of time an explicit state change, which is both correct and the
 * thing that makes the staleness banner appear on its own.
 */
function useNowSeconds(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}

/**
 * The BTC/USD feed.
 *
 * Needs no account: the oracle is a chain precompile and its answer is the same for
 * everyone, so this is the one figure a signed-out or watch-only session can be shown
 * that is both real and checkable.
 *
 * `classifyPrice` runs on every render rather than only on fetch, because an observation
 * that was live when it arrived is stale 61 seconds later whether or not we refetch, and
 * a screen still calling it live is exactly the failure the state exists to prevent.
 */
export function usePrice(): PriceFeed {
  // Subscribing to the developer stale toggle re-runs classification immediately when
  // it changes, rather than on the next poll.
  const forcedStale = useAppStore((s) => s.forcedStaleSeconds);
  const scope = useScope();
  const now = useNowSeconds();

  const { data, error, isLoading } = useQuery({
    queryKey: [...queryKeys.price, ...scope, forcedStale],
    queryFn: readPrice,
    refetchInterval: 15_000,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });

  if (isLoading) return { state: 'loading' };

  /**
   * An RPC failure becomes 'unavailable', never a zero and never a last-known figure
   * dressed as current. `classifyPrice` takes the message and returns the unavailable
   * variant, which carries no `priceWei` field at all, so no screen downstream has
   * anything to accidentally render.
   */
  return classifyPrice(
    data ?? null,
    now,
    error ? (error instanceof Error ? error.message : String(error)) : undefined,
  );
}

/**
 * The account-scoped reads.
 *
 * `enabled` is the honest gate: with no address there is no position to read, and a
 * query that runs anyway would throw on every mount and paint an error state at somebody
 * who has simply not finished onboarding.
 */
function useAccountQuery<T>(
  key: readonly unknown[],
  queryFn: () => Promise<T>,
  staleTime: number,
): UseQueryResult<T> {
  const address = useAppStore((s) => s.address);
  const scope = useScope();
  return useQuery<T>({
    queryKey: [...key, ...scope],
    queryFn,
    enabled: address !== null,
    staleTime,
  });
}

export function usePosition(): UseQueryResult<Position> {
  return useAccountQuery<Position>(queryKeys.position, readPosition, 5_000);
}

export function useBalances(): UseQueryResult<Balances> {
  return useAccountQuery<Balances>(queryKeys.balances, readBalances, 5_000);
}

export function useEarn(): UseQueryResult<EarnPosition> {
  return useAccountQuery<EarnPosition>(queryKeys.earn, readEarn, 15_000);
}

/**
 * Activity.
 *
 * A longer `staleTime` and no refetch on focus, because a log scan is many round trips
 * and nothing on that screen changes second to second. Re-running it every time the app
 * came back to the foreground would be rude to a public RPC that has already told us it
 * rate-limits.
 */
export function useActivity(): UseQueryResult<ActivityWindow> {
  const address = useAppStore((s) => s.address);
  const scope = useScope();
  return useQuery<ActivityWindow>({
    queryKey: [...queryKeys.activity, ...scope],
    queryFn: readActivity,
    enabled: address !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * The account's own `@handle`, from MarenRegistry's reverse resolution.
 *
 * Resolved rather than assumed. Onboarding used to write a hard-coded handle into the
 * store, which meant a brand new address displayed somebody else's name. An address with
 * no registration resolves to `null`, and the header falls back to the product name.
 */
export function usePrimaryHandle(): UseQueryResult<string | null> {
  const address = useAppStore((s) => s.address);
  const setHandle = useAppStore((s) => s.setHandle);
  const scope = useScope();

  const query = useQuery<string | null>({
    queryKey: [...queryKeys.handle, ...scope],
    queryFn: async () => (address ? reverseResolve(address) : null),
    enabled: address !== null,
    staleTime: 60_000,
  });

  // Mirrored into the store so screens that only need the name do not each run a query.
  // Only on success: a failed lookup must not blank a handle that was read a moment ago.
  useEffect(() => {
    if (query.isSuccess) setHandle(query.data ?? null);
  }, [query.isSuccess, query.data, setHandle]);

  return query;
}

/**
 * Position health, computed by the SDK's `assessHealth` and nothing else.
 *
 * Returns null when there is no live price. Health is a function of price, so a health
 * figure without a live price would be a stale number dressed as a current one — the
 * exact thing ARCHITECTURE.md §4 forbids. Callers render the price-unavailable state
 * instead of falling back to a last-known ratio.
 */
export function useHealth(): PositionHealth | null {
  const price = usePrice();
  const { data: position } = usePosition();

  if (!position) return null;
  if (price.state !== 'live') return null;

  return assessHealth(position.collateralWei, position.debtWei, price.priceWei);
}
