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
import type { Balances, EarnPosition, Handle, Position, ProtocolStats } from './types';

/**
 * The live reads. THE ONLY READS.
 *
 * Every function here is written against the real ABIs and the verified addresses in
 * `@maren/sdk`, and every one of them runs on every page load — Maren has been live on
 * matsnet since 15 August 2026, and the mock module that used to sit beside this file is
 * deleted. There is no longer a second implementation for any of these, which is the
 * point: a function that can only read the chain cannot quietly start inventing.
 *
 * The header of this file previously said none of it ran and that `getMarenAddresses()`
 * still returned zeroes. That stopped being true the day the addresses landed, and a
 * comment asserting a product is not deployed while it is deployed is precisely the kind
 * of stale claim this pass exists to remove.
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

  /**
   * ONE ROUND TRIP, NOT TWO.
   *
   * This used to read the trove, look at the answer, and only then issue the reads the
   * answer implied. That is a data dependency the chain does not actually have: both
   * branches are `view` functions of the same block, and asking for all of them at once
   * costs one extra staticcall inside a batch the client was sending anyway, while asking
   * in sequence costs a whole second network round trip on the app's busiest screen.
   *
   * These are separate `readContract` calls rather than one `client.multicall`, and that
   * is deliberate. The client coalesces same-window reads into a single aggregate3 itself
   * (see `lib/wagmi.ts`), and it can only do that across FUNCTIONS — a hand-rolled
   * `multicall` here would arrive as calldata the batcher must leave alone, so the
   * portfolio would go back to five requests, one per hook, instead of one for all of them.
   */
  const [trove, directCapacity, vaultCollateral, vaultDebt, vaultBorrowable, troveCapacity] =
    await Promise.all([
      ctx.client.readContract({
        address: musd.troveManager,
        abi: troveManagerAbi,
        functionName: 'getEntireDebtAndColl',
        args: [ctx.account],
      }),
      /**
       * Only meaningful when the account has a trove of its own. An account that does not
       * is the common case, and MUSD is entitled to revert on it, so the failure is
       * absorbed here and the DIRECT branch below insists on a real value rather than
       * substituting a zero — a borrowing ceiling of "0" and "we could not read your
       * borrowing ceiling" are different sentences and only one of them is true.
       */
      ctx.client
        .readContract({
          address: musd.troveManager,
          abi: troveManagerAbi,
          functionName: 'getTroveMaxBorrowingCapacity',
          args: [ctx.account],
        })
        .then((value) => value as bigint | null)
        .catch(() => null),
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

  const [coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest] = trove;

  if (coll + pendingColl > 0n) {
    if (directCapacity === null) {
      throw new Error('Mezo did not report this trove’s borrowing capacity.');
    }

    // `principal` from Mezo's TroveManager already includes the 200 MUSD gas
    // compensation, so it is not added again here.
    const totalPrincipal = principal + pendingPrincipal;
    const totalInterest = interest + pendingInterest;

    return {
      collateralWei: coll + pendingColl,
      debtWei: totalPrincipal + totalInterest,
      principalWei:
        totalPrincipal > MUSD_GAS_COMPENSATION ? totalPrincipal - MUSD_GAS_COMPENSATION : 0n,
      interestWei: totalInterest,
      interestRateBps: INTEREST_RATE_BPS,
      maxBorrowingCapacityWei: directCapacity,
      route: 'direct',
      openedAt: 0,
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

  /**
   * `maxWithdraw(owner)` INSTEAD OF `convertToAssets(balanceOf(owner))`.
   *
   * The old pair was two round trips because the second call needed the first call's
   * answer as an argument, which meant the Earn screen could never be one request no
   * matter how well the client batched.
   *
   * The substitution is exact rather than approximate, and that matters enough to state
   * where it comes from. MarenEarn is OpenZeppelin's `ERC4626` and overrides `maxDeposit`
   * and `maxMint` only — `maxWithdraw` is inherited untouched, and OZ defines it as
   * `_convertToAssets(balanceOf(owner), Rounding.Floor)`, which is the same expression,
   * the same rounding and the same block as the call it replaces. If MarenEarn ever
   * overrides `maxWithdraw` to express a liquidity limit, this becomes a different number
   * and must go back to the two reads.
   */
  const [shares, assets] = await Promise.all([
    ctx.client.readContract({
      address: maren.marenEarn,
      abi: marenEarnAbi,
      functionName: 'balanceOf',
      args: [ctx.account],
    }),
    ctx.client.readContract({
      address: maren.marenEarn,
      abi: marenEarnAbi,
      functionName: 'maxWithdraw',
      args: [ctx.account],
    }),
  ]);

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

/** MarenRegistry.available — false once a handle is taken. */
export async function handleAvailable(ctx: LiveContext, handle: string): Promise<boolean> {
  const maren = getMarenAddresses(ctx.network);
  return ctx.client.readContract({
    address: maren.marenRegistry,
    abi: marenRegistryAbi,
    functionName: 'available',
    args: [handle],
  });
}

/**
 * The protocol's own state — no wallet required.
 *
 * Read straight from MUSD's TroveManager rather than from the vault's convenience view,
 * for the same reason `hints.ts` does: `troveStatus()` reports NET debt, and the ratio a
 * user should be shown for the shared trove is the one the protocol itself ranks and
 * liquidates on. Reading both and quoting the vault's would understate how drawn the pool
 * is — which, right now, is the single most decision-relevant fact on the screen, because
 * the trove sits under Maren's own borrow floor and every borrow therefore reverts.
 */
/**
 * MUSD's system-wide mode: the TCR, and whether the protocol is in Recovery Mode.
 *
 * Priced off the ORACLE PRECOMPILE, not `PriceFeed.fetchPrice()`, and the choice is
 * load-bearing. `fetchPrice()` reverts above 60 seconds of staleness, so asking it would
 * make "is the protocol in Recovery Mode" unanswerable in exactly the conditions where a
 * user most needs to know. `checkRecoveryMode(uint256)` and `getTCR(uint256)` take the
 * price as an argument and are plain views, so a slightly old price still yields a real
 * answer about the protocol's mode.
 *
 * Never throws. This is one contract read on top of the ones that already gate the screen,
 * and a failure here must degrade to "unknown" rather than blank the whole protocol panel.
 * The nulls it returns are honest: `checkRecoveryMode` cannot be evaluated without a price,
 * and a `false` invented in its place would be the specific lie that re-enables a borrow
 * button the chain is going to refuse.
 */
async function readSystemMode(
  ctx: LiveContext,
): Promise<Pick<ProtocolStats, 'systemTcrWei' | 'recoveryMode'>> {
  const musd = getMusdAddresses(ctx.network);
  try {
    const { priceWei } = await readPrice(ctx);
    const [systemTcrWei, recoveryMode] = await Promise.all([
      ctx.client.readContract({
        address: musd.troveManager,
        abi: troveManagerAbi,
        functionName: 'getTCR',
        args: [priceWei],
      }),
      ctx.client.readContract({
        address: musd.troveManager,
        abi: troveManagerAbi,
        functionName: 'checkRecoveryMode',
        args: [priceWei],
      }),
    ]);
    return { systemTcrWei, recoveryMode };
  } catch {
    return { systemTcrWei: null, recoveryMode: null };
  }
}

export async function readProtocolStats(ctx: LiveContext): Promise<ProtocolStats> {
  const maren = getMarenAddresses(ctx.network);
  const musd = getMusdAddresses(ctx.network);

  const [
    totalCollateral,
    status,
    capacity,
    reserve,
    depositsPaused,
    borrowingPaused,
    troveOpen,
    depositCap,
    idleCollateral,
  ] = await Promise.all([
    ctx.client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'totalCollateral',
    }),
    ctx.client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'troveStatus',
    }),
    ctx.client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'troveMaxBorrowingCapacity',
    }),
    ctx.client.readContract({
      address: musd.musd,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [maren.marenVault],
    }),
    ctx.client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'depositsPaused',
    }),
    ctx.client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'borrowingPaused',
    }),
    ctx.client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'troveOpen',
    }),
    ctx.client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'depositCap',
    }),
    ctx.client.readContract({
      address: maren.marenVault,
      abi: marenVaultAbi,
      functionName: 'idleCollateral',
    }),
  ]);

  const [coll, netDebt, icr] = status;
  const system = await readSystemMode(ctx);

  return {
    ...system,
    totalCollateralWei: totalCollateral,
    troveCollateralWei: coll,
    troveNetDebtWei: netDebt,
    troveIcrWei: icr,
    reserveMusdWei: reserve,
    troveMaxBorrowingCapacityWei: capacity,
    troveOpen,
    depositCapWei: depositCap,
    idleCollateralWei: idleCollateral,
    depositsPaused,
    borrowingPaused,
  };
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
