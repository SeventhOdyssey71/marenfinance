import { ORACLE_MAX_PRICE_DELAY_SECONDS } from '@maren/sdk';

/**
 * The BTC/USD price feed, and the staleness rule that governs the whole app.
 *
 * Mezo's PriceFeed reads a native chain precompile at 0x7b7c…0015 and `fetchPrice()`
 * REVERTS if the observation is older than 60 seconds. Every borrow / adjust / liquidate
 * / redeem path can therefore fail for reasons that have nothing to do with the user.
 *
 * This module is a straight port of `apps/ios/src/chain/price.ts`, deliberately: web and
 * iOS must not disagree about when a price is usable. The shape is the enforcement — a
 * price is not a `bigint`, it is a discriminated union, and only the `live` case carries
 * a number. A screen cannot accidentally read a stale value because there is no field on
 * the stale case to read it from.
 */

export type PriceFeed =
  | { state: 'live'; priceWei: bigint; observedAt: number; ageSeconds: number }
  /**
   * We have a number, but it is older than the oracle's own tolerance. The protocol
   * would revert on it. It is shown as a last-known figure, never as the current price,
   * and every action that depends on price is disabled.
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
 * Classify an observation against the wall clock. `now` is injected so this stays pure
 * and can be tested at the boundary — 60s exactly is live, 61s is stale.
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
 * The single gate every price-dependent action goes through. Gates fail closed: an
 * unknown state denies, and the function returns a reason so the UI can say *why*
 * rather than showing a dead button.
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

export type VaultAction = 'deposit' | 'borrow' | 'repay' | 'withdraw';

/**
 * Which vault actions survive an unusable oracle.
 *
 * These are not product preferences; they are read off `MarenVault.sol`, which documents
 * its price dependency per entrypoint:
 *
 *   - `deposit`   — "Needs no price, so it works while the oracle is down."
 *   - `borrow`    — calls `_price()` before anything else. Blocked.
 *   - `repay`     — "Never pausable — an exit must always be open… Needs no price."
 *   - `withdraw`  — "Requires a price only if you still owe MUSD." A debt-free user can
 *                   always leave; a user with debt hits the 180% check, which needs a price.
 *
 * The product spec says repay and withdraw stay open when borrowing is paused, and they
 * do — but a withdrawal against outstanding debt would revert inside the ratio check
 * while the oracle is down, so we say that rather than offering a button that fails.
 * Repay is always open, and repaying restores the withdrawal.
 */
export function vaultActionGate(
  action: VaultAction,
  feed: PriceFeed,
  position: { hasDebt: boolean },
): { allowed: boolean; reason: string | null } {
  if (action === 'repay') return { allowed: true, reason: null };
  if (action === 'deposit') return { allowed: true, reason: null };

  const gate = priceGate(feed);
  if (gate.allowed) return gate;

  if (action === 'withdraw' && !position.hasDebt) {
    // No debt means no ratio check, so nothing on this path reads the oracle.
    return { allowed: true, reason: null };
  }

  if (action === 'withdraw') {
    return {
      allowed: false,
      reason: `${gate.reason} Withdrawing against outstanding debt has to check your collateral ratio, which needs the oracle. Repaying is still open, and repaying in full reopens withdrawal.`,
    };
  }

  return gate;
}
