import { useQuery } from '@tanstack/react-query';
import { assessHealth, type PositionHealth } from '@maren/sdk';

import { classifyPrice, type PriceFeed } from '../chain/price';
import { readActivity, readBalances, readEarn, readPosition, readPrice } from '../data/mock';
import { useAppStore } from '../state/store';

/**
 * Chain reads, via TanStack Query per ARCHITECTURE.md §5.
 *
 * The price is polled every 15 seconds against a 60-second staleness limit, which gives
 * three chances to refresh before the oracle would reject the observation. `staleTime`
 * is 0 because a cached price is precisely the thing we must never render.
 */

export const queryKeys = {
  price: ['price'] as const,
  position: ['position'] as const,
  balances: ['balances'] as const,
  earn: ['earn'] as const,
  activity: ['activity'] as const,
};

export function usePrice(): PriceFeed {
  // Subscribing to the developer stale toggle re-runs classification immediately when
  // it changes, rather than on the next poll.
  const forcedStale = useAppStore((s) => s.forcedStaleSeconds);

  const { data, error, isLoading } = useQuery({
    queryKey: [...queryKeys.price, forcedStale],
    queryFn: readPrice,
    refetchInterval: 15_000,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });

  if (isLoading) return { state: 'loading' };
  return classifyPrice(
    data ?? null,
    Math.floor(Date.now() / 1000),
    error ? (error instanceof Error ? error.message : String(error)) : undefined,
  );
}

export function usePosition() {
  return useQuery({ queryKey: queryKeys.position, queryFn: readPosition, staleTime: 5_000 });
}

export function useBalances() {
  return useQuery({ queryKey: queryKeys.balances, queryFn: readBalances, staleTime: 5_000 });
}

export function useEarn() {
  return useQuery({ queryKey: queryKeys.earn, queryFn: readEarn, staleTime: 15_000 });
}

export function useActivity() {
  return useQuery({ queryKey: queryKeys.activity, queryFn: readActivity, staleTime: 10_000 });
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
