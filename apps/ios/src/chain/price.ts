import { ORACLE_MAX_PRICE_DELAY_SECONDS } from '@maren/sdk';

/**
 * The BTC/USD price feed, and the staleness rule that governs the whole app.
 *
 * Mezo's PriceFeed reads a native chain precompile at 0x7b7c…0015 and
 * `fetchPrice()` REVERTS if the observation is older than 60 seconds
 * (`ORACLE_MAX_PRICE_DELAY_SECONDS`, read live from the deployed contract — see
 * packages/sdk/src/constants.ts). Every borrow, adjust, liquidate and redeem path can
 * therefore revert for reasons that have nothing to do with the user.
 *
 * ARCHITECTURE.md §4: "we never display a stale price as if it were live."
 *
 * The consequence for this module is that a price is not a `bigint`. It is a
 * discriminated union, and the `live` case is the only one carrying a number. Screens
 * cannot accidentally read a stale value because there is no field to read it from.
 */

export type PriceFeed =
  | { state: 'live'; priceWei: bigint; observedAt: number; ageSeconds: number }
  /**
   * We have a number, but it is older than the oracle's own tolerance. The protocol
   * would revert on it. It is shown struck-through as a last-known figure, never as
   * the current price, and every action that depends on price is disabled.
   */
  | { state: 'stale'; lastKnownWei: bigint; observedAt: number; ageSeconds: number }
  /** No usable observation at all. */
  | { state: 'unavailable'; reason: string }
  | { state: 'loading' };

/** Seconds of slack before we call a price stale. Deliberately the protocol's own limit. */
export const STALE_AFTER_SECONDS = ORACLE_MAX_PRICE_DELAY_SECONDS;

export interface PriceObservation {
  priceWei: bigint;
  /** Unix seconds from the oracle's own `latestRoundData().updatedAt`, not local time. */
  updatedAt: number;
}

/**
 * Classify an observation against the wall clock.
 *
 * `now` is injected so this is a pure function and can be tested at the boundary —
 * 60s exactly is live, 61s is stale.
 */
export function classifyPrice(
  observation: PriceObservation | null,
  now: number,
  error?: string,
): PriceFeed {
  if (error) return { state: 'unavailable', reason: error };
  if (!observation) return { state: 'unavailable', reason: 'No oracle observation.' };

  const ageSeconds = Math.max(0, Math.floor(now - observation.updatedAt));

  if (ageSeconds > STALE_AFTER_SECONDS) {
    return {
      state: 'stale',
      lastKnownWei: observation.priceWei,
      observedAt: observation.updatedAt,
      ageSeconds,
    };
  }

  return {
    state: 'live',
    priceWei: observation.priceWei,
    observedAt: observation.updatedAt,
    ageSeconds,
  };
}

/**
 * The single gate every price-dependent action goes through.
 *
 * R8 says gates fail closed: an unknown or malformed feed state must deny, never widen
 * access. The default branch below returns `false`, and the function returns a reason
 * so the UI can say *why* rather than showing a dead button.
 */
export function priceGate(feed: PriceFeed): { allowed: boolean; reason: string | null } {
  switch (feed.state) {
    case 'live':
      return { allowed: true, reason: null };
    case 'stale':
      return {
        allowed: false,
        reason: `Price feed is ${feed.ageSeconds}s old. Mezo's oracle rejects anything over ${STALE_AFTER_SECONDS}s, so this would revert on-chain.`,
      };
    case 'unavailable':
      return { allowed: false, reason: feed.reason };
    case 'loading':
      return { allowed: false, reason: 'Reading the price feed.' };
    default:
      return { allowed: false, reason: 'Unknown price feed state.' };
  }
}

/** The price to compute with, or null. There is no "just use the last one" path. */
export function usablePrice(feed: PriceFeed): bigint | null {
  return feed.state === 'live' ? feed.priceWei : null;
}
