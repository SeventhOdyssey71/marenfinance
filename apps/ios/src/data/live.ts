import {
  INTEREST_RATE_BPS,
  MEZO_PRICE_ORACLE_PRECOMPILE,
  MUSD_GAS_COMPENSATION,
  getMarenAddresses,
  getMusdAddresses,
  marenEarnAbi,
  marenRegistryAbi,
  marenVaultAbi,
  priceOracleAbi,
  troveManagerAbi,
} from '@maren/sdk';
import { erc20Abi, type Address } from 'viem';

import { readActivityWindow } from '../chain/logs';
import type { PriceObservation } from '../chain/price';
import { getEndpointClients, getLogClient, getReadClient } from '../chain/transport';
import { getReadContext, requireAccount } from './context';
import type { ActivityWindow, Balances, EarnPosition, Handle, Position } from './types';

/**
 * The live chain state.
 *
 * `mock.ts` said, in its header: "Every function here has the signature its viem
 * replacement will have... Swapping to live data means replacing the bodies in this file
 * with contract reads, and nothing else." This is that replacement, and the sentence is
 * kept literally rather than approximately: every export below has the same name and the
 * same arity as its counterpart in `mock.ts`, and `parity.test.ts` fails CI the moment
 * that stops being true. Nothing downstream knows which of the two it is talking to.
 *
 * The mock was not deleted, and that is deliberate rather than sentimental. It is the
 * only way to walk the app on a plane or in a screenshot session without a network, and
 * the states it exercises (a position at a genuinely adequate CR, a failed send, a
 * ninety-day Earn window with three lumpy gains) are hard to arrange on a testnet on
 * demand. It is behind an explicit developer toggle, it is off by default, and every
 * screen that renders it says so. What the web app deleted was a mock that was ON by
 * default and rendered invented hashes as working explorer links under a header reading
 * "Live from Mezo testnet". That is a different thing, and this is not it.
 *
 * WHAT IS READ, AND WHAT IS NOT. Price, position, balances, Earn, handle resolution and
 * Activity are contract reads against matsnet. `EarnPosition.depositedWei` and
 * `trailing` are NOT: realised yield is the sum of share-price movement over a window,
 * which needs event history the app does not index yet. The live path reports a
 * zero-length window with a zero figure rather than inventing one. A fabricated trailing
 * return would be exactly the forward-APY dishonesty the Earn screen exists to avoid,
 * only backdated. See `readEarn` below.
 */

/**
 * Price, with its age.
 *
 * Read from the Mezo oracle PRECOMPILE rather than from `PriceFeed.fetchPrice()`, for one
 * reason: `fetchPrice()` either returns a number or reverts, so it can never tell us HOW
 * OLD a price is, and how old is exactly what the staleness state needs to say.
 * `latestRoundData().updatedAt` carries the observation timestamp, and `classifyPrice`
 * compares it against the protocol's own 60-second tolerance.
 *
 * Both reads go through the batching client, so they leave the phone as one `aggregate3`.
 */
export async function readPrice(): Promise<PriceObservation> {
  const { network } = getReadContext();
  const client = getReadClient(network);

  const [decimals, round] = await Promise.all([
    client.readContract({
      address: MEZO_PRICE_ORACLE_PRECOMPILE,
      abi: priceOracleAbi,
      functionName: 'decimals',
    }),
    client.readContract({
      address: MEZO_PRICE_ORACLE_PRECOMPILE,
      abi: priceOracleAbi,
      functionName: 'latestRoundData',
    }),
  ]);

  const [, answer, , updatedAt] = round;
  if (answer <= 0n) throw new Error('Mezo’s oracle returned a non-positive price.');

  // Scale whatever the precompile reports up to the 1e18 the rest of the app uses.
  const scale = 10n ** BigInt(18 - Number(decimals));

  return {
    priceWei: answer * scale,
    updatedAt: Number(updatedAt) - forcedStaleSeconds,
  };
}

/**
 * Settings → Developer → simulate a stale price feed.
 *
 * IT DOES NOT FAKE THE CHAIN, AND THAT DISTINCTION IS THE WHOLE POINT. The oracle is
 * read for real, on every poll, and the price returned above is the one the precompile
 * answered with, unmodified. The only thing this backdates is the OBSERVATION TIMESTAMP,
 * which is what `classifyPrice` measures age against, so the app takes the same path it
 * would take against a genuinely lagging oracle: `PriceFeed.fetchPrice()` would revert,
 * every price-dependent action is gated shut, and the banner shows the last known figure
 * struck through. Nothing invents a price, and nothing pretends a read succeeded that
 * did not.
 *
 * A toggle that swapped in a fabricated price would exercise the pixels and not the
 * logic, which is worse than having no toggle: it would go green while the real thing was
 * broken.
 */
let forcedStaleSeconds = 0;

export function setForcedStaleSeconds(seconds: number): void {
  forcedStaleSeconds = seconds;
}

export function getForcedStaleSeconds(): number {
  return forcedStaleSeconds;
}

/**
 * The user's position, from whichever route they are actually on.
 *
 * A direct trove is checked first because it is the route we prefer: a user with one has
 * no pooling risk and should never be shown pooled figures.
 *
 * ONE ROUND TRIP, NOT TWO. The obvious implementation reads the trove, looks at the
 * answer, and only then issues the reads that answer implies. That is a data dependency
 * the chain does not have: both branches are `view` functions of the same block, so
 * asking for all of them at once costs one extra staticcall inside a Multicall3 batch the
 * client was sending anyway, while asking in sequence costs a second full round trip on
 * the app's busiest screen and on the worst network the app runs over.
 */
export async function readPosition(): Promise<Position> {
  const { network, account } = requireAccount();
  const client = getReadClient(network);
  const musd = getMusdAddresses(network);
  const maren = getMarenAddresses(network);

  const [trove, directCapacity, vaultCollateral, vaultDebt, troveCapacity] = await Promise.all([
    client.readContract({
      address: musd.troveManager,
      abi: troveManagerAbi,
      functionName: 'getEntireDebtAndColl',
      args: [account],
    }),
    /**
     * Only meaningful when the account has a trove of its own. An account that does not
     * is the common case, and MUSD is entitled to revert on it, so the failure is
     * absorbed here. The DIRECT branch below then insists on a real value rather than
     * substituting a zero: a borrowing ceiling of "0" and "we could not read your
     * borrowing ceiling" are different sentences and only one of them is true.
     */
    client
      .readContract({
        address: musd.troveManager,
        abi: troveManagerAbi,
        functionName: 'getTroveMaxBorrowingCapacity',
        args: [account],
      })
      .then((value) => value as bigint | null)
      .catch(() => null),
    client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'collateral',
      args: [account],
    }),
    client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'previewDebtOf',
      args: [account],
    }),
    client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'troveMaxBorrowingCapacity',
    }),
  ]);

  const [coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest] = trove;

  if (coll + pendingColl > 0n) {
    if (directCapacity === null) {
      throw new Error('Mezo did not report this trove’s borrowing capacity.');
    }

    // `principal` from Mezo's TroveManager already includes the 200 MUSD gas
    // compensation, so it is not added again here. It IS subtracted back out for
    // `principalWei`, which the type defines as the net amount drawn.
    const totalPrincipal = principal + pendingPrincipal;
    const totalInterest = interest + pendingInterest;

    return {
      collateralWei: coll + pendingColl,
      debtWei: totalPrincipal + totalInterest,
      principalWei:
        totalPrincipal > MUSD_GAS_COMPENSATION ? totalPrincipal - MUSD_GAS_COMPENSATION : 0n,
      interestWei: totalInterest,
      interestRateBps: INTEREST_RATE_BPS,
      /**
       * The REAL ceiling, fixed at the price the trove opened at, never an ICR-derived
       * estimate. Adding collateral does not raise it; only `refinance()` does. That is
       * the Mezo-only behaviour in LIQUITY_DIVERGENCES #3, and quoting the other number
       * is how a borrow ends in an opaque revert.
       */
      maxBorrowingCapacityWei: directCapacity,
      route: 'direct',
    };
  }

  return {
    collateralWei: vaultCollateral,
    // A pooled position carries no per-user gas compensation and no origination fee on
    // the reserve-served portion, so `previewDebtOf` IS the complete debt.
    debtWei: vaultDebt,
    principalWei: vaultDebt,
    interestWei: 0n,
    interestRateBps: INTEREST_RATE_BPS,
    maxBorrowingCapacityWei: troveCapacity,
    route: vaultCollateral > 0n ? 'pooled' : 'none',
  };
}

export async function readBalances(): Promise<Balances> {
  const { network, account } = requireAccount();
  const client = getReadClient(network);
  const musd = getMusdAddresses(network);

  const [musdWei, btcWei] = await Promise.all([
    client.readContract({
      address: musd.musd,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    }),
    // BTC is the native gas token here, so this is `eth_getBalance` rather than an ERC-20
    // read, and it cannot join the multicall batch. 18 decimals, not 8: this is an EVM
    // chain and BTC follows the EVM convention on it.
    client.getBalance({ address: account }),
  ]);

  return { musdWei, btcWei };
}

/**
 * Earn.
 *
 * `maxWithdraw(owner)` INSTEAD OF `convertToAssets(balanceOf(owner))`. The old pair is
 * two round trips because the second call needs the first call's answer as an argument,
 * so the Earn screen could never be one request no matter how well the client batched.
 *
 * The substitution is exact rather than approximate, and where that comes from matters
 * enough to state. MarenEarn is OpenZeppelin's `ERC4626` and overrides `maxDeposit` and
 * `maxMint` only. `maxWithdraw` is inherited untouched, and OZ defines it as
 * `_convertToAssets(balanceOf(owner), Rounding.Floor)`: the same expression, the same
 * rounding, the same block. If MarenEarn ever overrides `maxWithdraw` to express a
 * liquidity limit this becomes a different number and must go back to the two reads.
 *
 * `depositedWei` and `trailing` are reported as zero and as a zero-length window. They
 * are not readable from state: lifetime deposits and realised yield are both event
 * history, and the app has no indexer. Reporting a zero-length window is how the Earn
 * screen knows to say nothing rather than to quote a return nobody measured.
 */
export async function readEarn(): Promise<EarnPosition> {
  const { network, account } = requireAccount();
  const client = getReadClient(network);
  const maren = getMarenAddresses(network);

  const [sharesWei, assetsWei] = await Promise.all([
    client.readContract({
      address: maren.marenEarn,
      abi: marenEarnAbi,
      functionName: 'balanceOf',
      args: [account],
    }),
    client.readContract({
      address: maren.marenEarn,
      abi: marenEarnAbi,
      functionName: 'maxWithdraw',
      args: [account],
    }),
  ]);

  return {
    sharesWei,
    assetsWei,
    depositedWei: 0n,
    trailing: { windowDays: 0, realisedWei: 0n, liquidationEvents: 0, lastGainAt: null },
  };
}

/** MarenRegistry.tryResolve. address(0) means "no such handle", not an error. */
export async function resolveHandle(query: string): Promise<Handle | null> {
  const { network } = getReadContext();
  const handle = query.trim().replace(/^@/, '');
  if (handle.length === 0) return null;

  const address = await getReadClient(network).readContract({
    address: getMarenAddresses(network).marenRegistry,
    abi: marenRegistryAbi,
    functionName: 'tryResolve',
    args: [handle],
  });

  if (address === '0x0000000000000000000000000000000000000000') return null;
  return { handle: `@${handle}`, address };
}

/** MarenRegistry's reverse resolution. An empty string means the address has no handle. */
export async function reverseResolve(address: Address): Promise<string | null> {
  const { network } = getReadContext();
  const handle = await getReadClient(network).readContract({
    address: getMarenAddresses(network).marenRegistry,
    abi: marenRegistryAbi,
    functionName: 'primaryHandle',
    args: [address],
  });
  return handle.length > 0 ? `@${handle}` : null;
}

/**
 * Activity, from `eth_getLogs`.
 *
 * Returns the window rather than the rows alone, because the span is part of the answer.
 * The scan itself is in `chain/logs.ts`, on its own client with a wider timeout: a
 * 10,000-block log query legitimately takes a second or two, and running it against the
 * interactive budget would fail it over on a network that is working perfectly.
 *
 * Receipts get the endpoint list rather than the failover client, because an empty
 * receipt is a successful response that `fallback()` cannot fail over. See the note on
 * `getEndpointClients`.
 */
export async function readActivity(): Promise<ActivityWindow> {
  const { network, account } = requireAccount();
  return readActivityWindow(getLogClient(network), network, account, getEndpointClients(network));
}

/**
 * The local-mutation surface, which live mode does not have and does not need.
 *
 * `mock.ts` keeps a copy of the position in memory and moves it after a confirmed
 * transaction, so the demo flows change the numbers they claim to change. Live mode has
 * no copy to move: the chain already moved, and the app finds out by reading it again.
 * `chain/actions.ts` invalidates the affected queries after `confirmTransaction` reports
 * 'delivered', and the next read is the truth.
 *
 * These are no-ops rather than absent because the swap promise is about the exported
 * surface, and a caller must not have to know which module it holds. Writing the numbers
 * down here instead would be strictly worse than doing nothing: an optimistic local edit
 * that the next read contradicts is a figure the user watched change and then change
 * back.
 */
export const mutate = {
  depositBtc(_wei: bigint) {},
  withdrawBtc(_wei: bigint) {},
  borrow(_wei: bigint) {},
  repay(_wei: bigint) {},
  send(_wei: bigint) {},
  earnDeposit(_wei: bigint) {},
  earnWithdraw(_wei: bigint) {},
  // The chain has already moved, so live does nothing and reads its ids back from the
  // receipt (see chain/actions.ts:readCreatedRefs). Same names and arities as mock.ts, which
  // data/parity.test.ts enforces so the source switch stays safe.
  split(_totalWei: bigint): bigint | undefined {
    return undefined;
  },
  createRequest(): bigint | undefined {
    return undefined;
  },
  createLink(_wei: bigint): bigint | undefined {
    return undefined;
  },
  reclaimLink(_linkId: bigint): bigint | undefined {
    return undefined;
  },
};
