import { getMarenAddresses, getMusdAddresses, type MezoNetwork } from '@maren/sdk';
import type { Address, PublicClient } from 'viem';

import { troveManagerAbi } from './abis';

/**
 * Sorted-list insertion hints, derived off-chain.
 *
 * MUSD keeps every trove in a doubly-linked list ordered by NOMINAL collateral ratio
 * (`coll * 1e20 / debt` — no price in it, which is why the ordering survives a price
 * move). Any operation that changes a trove's coll or debt has to be re-inserted at its
 * new rank, and `BorrowerOperations` walks the list from whatever `upperHint`/`lowerHint`
 * it is handed. Hand it `address(0)` and it walks from the head: correct, but O(n) gas
 * that grows with every trove on the chain.
 *
 * So the hints are computed here, before the transaction is built, using the exact
 * sequence Mezo's own docs prescribe:
 *
 *   nicr   = HintHelpers.computeNominalCR(collAfter, debtAfter)
 *   approx = HintHelpers.getApproxHint(nicr, 15 * sqrt(SortedTroves.getSize()), seed)
 *   (upper, lower) = SortedTroves.findInsertPosition(nicr, approx, approx)
 *
 * TWO RULES, BOTH LOAD-BEARING:
 *
 *   1. THESE ARE `eth_call` ONLY. `getApproxHint` walks up to `numTrials` list nodes; in a
 *      transaction that is an unbounded gas burn for a value the caller could have worked
 *      out for free. Every function in this module reads. None of them is ever put in a
 *      transaction.
 *   2. A WRONG HINT IS SLOW, NOT UNSAFE. `findInsertPosition` is re-run on-chain with the
 *      hint as a starting point and corrects itself, so a stale hint costs gas and never
 *      corrupts the ordering. That is why `NO_HINTS` is a legitimate fallback when a hint
 *      read fails — the transaction still succeeds. It is NOT a reason to skip the
 *      derivation: on a chain with a few hundred troves the difference is real.
 *
 * The position being re-ranked is MAREN'S POOLED TROVE, never the user's own account. A
 * user's deposit changes the pooled trove's collateral; the user has no trove of their
 * own to sort. Passing the user's address anywhere in here would be a silent no-op that
 * degrades to a head-walk on every single transaction.
 */

/** Only the members this app calls. `packages/contracts/src/interfaces/IHintHelpers.sol`. */
export const hintHelpersAbi = [
  {
    type: 'function',
    name: 'computeNominalCR',
    stateMutability: 'pure',
    inputs: [
      { name: '_coll', type: 'uint256' },
      { name: '_debt', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getApproxHint',
    stateMutability: 'view',
    inputs: [
      { name: '_CR', type: 'uint256' },
      { name: '_numTrials', type: 'uint256' },
      { name: '_inputRandomSeed', type: 'uint256' },
    ],
    outputs: [
      { name: 'hintAddress', type: 'address' },
      { name: 'diff', type: 'uint256' },
      { name: 'latestRandomSeed', type: 'uint256' },
    ],
  },
] as const;

/** `packages/contracts/src/interfaces/ISortedTroves.sol`. */
export const sortedTrovesAbi = [
  {
    type: 'function',
    name: 'getSize',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'findInsertPosition',
    stateMutability: 'view',
    inputs: [
      { name: '_NICR', type: 'uint256' },
      { name: '_prevId', type: 'address' },
      { name: '_nextId', type: 'address' },
    ],
    outputs: [
      { name: 'upper', type: 'address' },
      { name: 'lower', type: 'address' },
    ],
  },
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export interface Hints {
  upper: Address;
  lower: Address;
}

/**
 * The fallback. Means "start from the head of the list" — always accepted, just not cheap.
 * Used when a hint read fails, which must not be allowed to block a withdrawal or a repay.
 */
export const NO_HINTS: Hints = { upper: ZERO_ADDRESS, lower: ZERO_ADDRESS };

/** The pooled trove's coll and debt as the sorted list sees them, right now. */
export interface TrovePosition {
  collWei: bigint;
  debtWei: bigint;
}

/**
 * Read Maren's pooled trove from MUSD's TroveManager.
 *
 * Uses `getEntireDebtAndColl` rather than `MarenVault.troveStatus()` on purpose. The
 * vault reports NET debt (gas compensation subtracted, because that is what a user's
 * share is measured against); the sorted list ranks on the TOTAL debt including the
 * 200 MUSD compensation and any accrued interest. Feeding the net figure into
 * `computeNominalCR` produces a ratio ~11% too high and a hint on the wrong side of the
 * insertion point.
 */
export async function readTrovePosition(
  client: PublicClient,
  network: MezoNetwork,
): Promise<TrovePosition> {
  const vault = getMarenAddresses(network).marenVault;
  const [coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest] =
    await client.readContract({
      address: getMusdAddresses(network).troveManager,
      abi: troveManagerAbi,
      functionName: 'getEntireDebtAndColl',
      args: [vault],
    });

  return {
    collWei: coll + pendingColl,
    debtWei: principal + interest + pendingPrincipal + pendingInterest,
  };
}

/**
 * Integer square root, Babylonian. Used for `numTrials = 15 * sqrt(listSize)`, the trial
 * count MUSD's own hint documentation specifies — enough samples that the approximate
 * hint lands within a short walk of the true position.
 */
export function isqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

/**
 * The nominal collateral ratio the trove will have AFTER the operation.
 *
 * A trove with no debt has an unbounded ratio and sorts to the head of the list; MUSD
 * represents that as `2^256 - 1`, and so do we rather than dividing by zero.
 */
export async function computeNominalCr(
  client: PublicClient,
  network: MezoNetwork,
  collAfter: bigint,
  debtAfter: bigint,
): Promise<bigint> {
  if (debtAfter === 0n) return 2n ** 256n - 1n;
  return client.readContract({
    address: getMusdAddresses(network).hintHelpers,
    abi: hintHelpersAbi,
    functionName: 'computeNominalCR',
    args: [collAfter, debtAfter],
  });
}

/**
 * Derive `(upperHint, lowerHint)` for the pooled trove at its post-operation position.
 *
 * Never throws. A hint is an optimisation, and an RPC hiccup while reading one must not
 * be the reason a user cannot get their collateral back — so every failure path returns
 * `NO_HINTS` and lets the chain do the walk.
 */
export async function deriveHints(
  client: PublicClient,
  network: MezoNetwork,
  collAfter: bigint,
  debtAfter: bigint,
): Promise<Hints> {
  try {
    const musd = getMusdAddresses(network);

    const [nicr, size] = await Promise.all([
      computeNominalCr(client, network, collAfter, debtAfter),
      client.readContract({
        address: musd.sortedTroves,
        abi: sortedTrovesAbi,
        functionName: 'getSize',
      }),
    ]);

    // An empty list has exactly one insertion point and no work to do finding it.
    if (size === 0n) return NO_HINTS;

    const numTrials = 15n * isqrt(size);
    // The seed only decorrelates successive samples inside getApproxHint; it does not
    // affect correctness, and a wall-clock value keeps two users in the same block from
    // walking identical sample paths.
    const seed = BigInt(Date.now());

    const [approx] = await client.readContract({
      address: musd.hintHelpers,
      abi: hintHelpersAbi,
      functionName: 'getApproxHint',
      args: [nicr, numTrials, seed],
    });

    const [upper, lower] = await client.readContract({
      address: musd.sortedTroves,
      abi: sortedTrovesAbi,
      functionName: 'findInsertPosition',
      args: [nicr, approx, approx],
    });

    return { upper, lower };
  } catch {
    return NO_HINTS;
  }
}

/**
 * Hints for a vault operation, expressed as the delta it applies to the POOLED TROVE.
 *
 * Deliberately takes signed deltas rather than four named entrypoints: the mapping from a
 * user action to a trove delta is the only thing that differs between deposit, borrow,
 * repay and withdraw, and stating it at each call site keeps that mapping visible instead
 * of buried in a switch here.
 */
export async function hintsForDelta(
  client: PublicClient,
  network: MezoNetwork,
  delta: { collDelta: bigint; debtDelta: bigint },
): Promise<Hints> {
  try {
    const current = await readTrovePosition(client, network);
    const collAfter = clampToZero(current.collWei + delta.collDelta);
    const debtAfter = clampToZero(current.debtWei + delta.debtDelta);
    return deriveHints(client, network, collAfter, debtAfter);
  } catch {
    return NO_HINTS;
  }
}

function clampToZero(value: bigint): bigint {
  return value > 0n ? value : 0n;
}
