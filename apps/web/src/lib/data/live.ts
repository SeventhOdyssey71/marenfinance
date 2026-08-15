import {
  INTEREST_RATE_BPS,
  MUSD_GAS_COMPENSATION,
  MEZO_PRICE_ORACLE_PRECOMPILE,
  getMarenAddresses,
  getMusdAddresses,
  type MezoNetwork,
} from '@maren/sdk';
import { erc20Abi, type Address, type PublicClient } from 'viem';

import {
  marenEarnAbi,
  marenPayAbi,
  marenRegistryAbi,
  marenVaultAbi,
  priceOracleAbi,
  troveManagerAbi,
} from '../chain/abis';
import type { PriceObservation } from '../chain/price';
import type { Balances, EarnPosition, Handle, Position } from './types';

/**
 * The live reads.
 *
 * Every function here is written against the real ABIs and the verified addresses in
 * `@maren/sdk`. None of it runs today, because `getMarenAddresses()` still returns zero
 * addresses and `source.ts` therefore selects the mock — but it compiles, it is typed
 * against the same contracts CI builds, and turning it on is a deployment, not a
 * rewrite. That is the point: the mock exists to make the UI demoable, not to become
 * the thing the UI is built around.
 *
 * `packages/contracts/script/Deploy.s.sol` writes the deployed addresses back into the
 * SDK; the moment it does, `isDeployed()` flips and these functions answer instead.
 */

export interface LiveContext {
  client: PublicClient;
  network: MezoNetwork;
  account: Address;
}

/**
 * Price, with its age.
 *
 * Read from the Mezo oracle PRECOMPILE rather than from `PriceFeed.fetchPrice()`, for
 * one reason: `fetchPrice()` either returns a number or reverts, so it can never tell us
 * *how old* a price is — and "how old" is exactly what the staleness state needs to say.
 * The precompile's `latestRoundData().updatedAt` carries the observation timestamp, and
 * `classifyPrice` compares it against the protocol's own 60-second tolerance.
 */
export async function readPrice(ctx: LiveContext): Promise<PriceObservation> {
  const [decimals, round] = await Promise.all([
    ctx.client.readContract({
      address: MEZO_PRICE_ORACLE_PRECOMPILE,
      abi: priceOracleAbi,
      functionName: 'decimals',
    }),
    ctx.client.readContract({
      address: MEZO_PRICE_ORACLE_PRECOMPILE,
      abi: priceOracleAbi,
      functionName: 'latestRoundData',
    }),
  ]);

  const [, answer, , updatedAt] = round;
  if (answer <= 0n) throw new Error('Oracle returned a non-positive price.');

  // Scale whatever the precompile reports up to the 1e18 the rest of the app uses.
  const scale = 10n ** BigInt(18 - Number(decimals));
  return { priceWei: answer * scale, updatedAt: Number(updatedAt) };
}

/**
 * The user's position, from whichever route they are actually on.
 *
 * A direct trove is checked first because it is the route we prefer: a user with one has
 * no pooling risk and should never be shown pooled figures. Only if they have no trove of
 * their own do we read their share of MarenVault.
 */
export async function readPosition(ctx: LiveContext): Promise<Position> {
  const musd = getMusdAddresses(ctx.network);
  const maren = getMarenAddresses(ctx.network);

  const [coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest] =
    await ctx.client.readContract({
      address: musd.troveManager,
      abi: troveManagerAbi,
      functionName: 'getEntireDebtAndColl',
      args: [ctx.account],
    });

  if (coll + pendingColl > 0n) {
    // `principal` from Mezo's TroveManager already includes the 200 MUSD gas
    // compensation, so it is not added again here.
    const capacity = await ctx.client.readContract({
      address: musd.troveManager,
      abi: troveManagerAbi,
      functionName: 'getTroveMaxBorrowingCapacity',
      args: [ctx.account],
    });

    const totalPrincipal = principal + pendingPrincipal;
    const totalInterest = interest + pendingInterest;

    return {
      collateralWei: coll + pendingColl,
      debtWei: totalPrincipal + totalInterest,
      principalWei:
        totalPrincipal > MUSD_GAS_COMPENSATION ? totalPrincipal - MUSD_GAS_COMPENSATION : 0n,
      interestWei: totalInterest,
      interestRateBps: INTEREST_RATE_BPS,
      maxBorrowingCapacityWei: capacity,
      route: 'direct',
      openedAt: 0,
    };
  }

  const [vaultCollateral, vaultDebt, vaultBorrowable, troveCapacity] = await Promise.all([
    ctx.client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'collateral',
      args: [ctx.account],
    }),
    ctx.client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'previewDebtOf',
      args: [ctx.account],
    }),
    ctx.client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'maxBorrowable',
      args: [ctx.account],
    }),
    ctx.client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'troveMaxBorrowingCapacity',
    }),
  ]);

  return {
    collateralWei: vaultCollateral,
    // A pooled position carries no per-user gas compensation and no origination fee on
    // the reserve-served portion, so `previewDebtOf` IS the complete debt.
    debtWei: vaultDebt,
    principalWei: vaultDebt,
    interestWei: 0n,
    interestRateBps: INTEREST_RATE_BPS,
    maxBorrowingCapacityWei: troveCapacity,
    vaultMaxBorrowableWei: vaultBorrowable,
    route: vaultCollateral > 0n ? 'pooled' : 'none',
    openedAt: 0,
  };
}

export async function readBalances(ctx: LiveContext): Promise<Balances> {
  const musd = getMusdAddresses(ctx.network);
  const [musdWei, btcWei] = await Promise.all([
    ctx.client.readContract({
      address: musd.musd,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [ctx.account],
    }),
    ctx.client.getBalance({ address: ctx.account }),
  ]);
  return { musdWei, btcWei };
}

/**
 * Earn.
 *
 * `trailing` is deliberately not derivable from a single read: realised yield is the sum
 * of share-price movement over a window, which needs the vault's `Harvested` event
 * history. Until the indexer is wired, the live path reports a zero-length window with a
 * zero figure rather than inventing one — a fabricated trailing return would be exactly
 * the forward-APY dishonesty this screen exists to avoid, only backdated.
 */
export async function readEarn(ctx: LiveContext): Promise<EarnPosition> {
  const maren = getMarenAddresses(ctx.network);
  const shares = await ctx.client.readContract({
    address: maren.marenEarn,
    abi: marenEarnAbi,
    functionName: 'balanceOf',
    args: [ctx.account],
  });
  const assets = await ctx.client.readContract({
    address: maren.marenEarn,
    abi: marenEarnAbi,
    functionName: 'convertToAssets',
    args: [shares],
  });

  return {
    sharesWei: shares,
    assetsWei: assets,
    depositedWei: 0n,
    trailing: { windowDays: 0, realisedWei: 0n, liquidationEvents: 0, lastGainAt: null },
  };
}

/** MarenRegistry.tryResolve — address(0) means "no such handle", not an error. */
export async function resolveHandle(ctx: LiveContext, query: string): Promise<Handle | null> {
  const maren = getMarenAddresses(ctx.network);
  const handle = query.trim().replace(/^@/, '');
  if (handle.length === 0) return null;

  const address = await ctx.client.readContract({
    address: maren.marenRegistry,
    abi: marenRegistryAbi,
    functionName: 'tryResolve',
    args: [handle],
  });

  if (address === '0x0000000000000000000000000000000000000000') return null;
  return { handle: `@${handle}`, address };
}

export async function reverseResolve(ctx: LiveContext, address: Address): Promise<string | null> {
  const maren = getMarenAddresses(ctx.network);
  const handle = await ctx.client.readContract({
    address: maren.marenRegistry,
    abi: marenRegistryAbi,
    functionName: 'primaryHandle',
    args: [address],
  });
  return handle.length > 0 ? `@${handle}` : null;
}

/** Exported so the Pay screen's write path and this module cannot drift apart. */
export const payAbi = marenPayAbi;
