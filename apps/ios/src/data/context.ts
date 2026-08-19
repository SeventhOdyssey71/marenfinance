import type { MezoNetwork } from '@maren/sdk';
import type { Address } from 'viem';

/**
 * Who and where the read layer is reading for.
 *
 * WHY THIS IS A MODULE RATHER THAN AN ARGUMENT. `mock.ts` promised that swapping to live
 * data meant "replacing the bodies in this file with contract reads, and nothing else",
 * and every caller in the app is built on that promise: `readPrice()`, `readPosition()`,
 * `readBalances()` and `readEarn()` all take no arguments. Threading a context parameter
 * through them would have been the easy way to write `live.ts` and would have broken the
 * promise at every call site, so the account and the network live here instead, set once
 * by the store. `src/data/parity.test.ts` fails the build if the two modules ever stop
 * agreeing about their signatures.
 *
 * The web app made the opposite choice, passing an explicit `LiveContext` into each read.
 * That is right there and wrong here: on the web the context comes from wagmi hooks that
 * already re-render the tree when the account changes, whereas this app has no such
 * plumbing and a per-call parameter would mean rewriting every screen.
 *
 * WHAT MAKES IT SAFE. Two things, and both are load-bearing:
 *
 *   1. `account` is `null` until an address exists. Reads that need one throw a stated
 *      error rather than substituting the zero address, which would return a real,
 *      correct, and entirely irrelevant set of zeroes and render as somebody's empty
 *      position.
 *   2. The account is part of every query key in `useChainData.ts`. Changing accounts
 *      therefore changes the cache key, so the previous account's figures can never sit
 *      on screen under the new one's name.
 */

export interface ReadContext {
  network: MezoNetwork;
  account: Address | null;
}

/** Testnet by default, matching `resolveNetwork` in the SDK: the safe default is the one where a mistake costs nothing. */
let context: ReadContext = { network: 'testnet', account: null };

export function setReadContext(next: ReadContext): void {
  context = next;
}

export function getReadContext(): ReadContext {
  return context;
}

/**
 * The context, insisting on an account.
 *
 * Reads that describe a person's position call this. The alternative is passing
 * `0x0000...0000` to `balanceOf`, which does not fail: it answers zero, and the screen
 * paints somebody's empty wallet as though it were yours.
 */
export function requireAccount(): { network: MezoNetwork; account: Address } {
  if (!context.account) {
    throw new Error('No account is loaded, so there is no position to read.');
  }
  return { network: context.network, account: context.account };
}
