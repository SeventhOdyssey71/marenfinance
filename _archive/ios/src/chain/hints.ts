import { getMarenAddresses, getMusdAddresses, troveManagerAbi, type MezoNetwork } from '@maren/sdk';
import type { Address } from 'viem';

import { getReadClient } from './transport';

/**
 * Sorted-list insertion hints, derived off-chain. The phone-side port of
 * `apps/web/src/lib/chain/hints.ts`, with the same rules and the same justification; it
 * reads through this app's memoised read client rather than a wagmi-supplied one.
 *
 * MUSD keeps every trove in a doubly-linked list ordered by NOMINAL collateral ratio.
 * Any operation that changes the pooled trove's coll or debt has to be re-inserted at its
 * new rank, and `BorrowerOperations` walks the list from whatever `upperHint`/`lowerHint`
 * it is handed. Hand it `address(0)` and it walks from the head: correct, but O(n) gas.
 *
 * TWO RULES, BOTH LOAD-BEARING:
 *   1. THESE ARE READS ONLY. `getApproxHint` walks up to `numTrials` nodes; in a
 *      transaction that is an unbounded gas burn for a value the caller could compute for
 *      free. Nothing here is ever put in a transaction.
 *   2. A WRONG HINT IS SLOW, NOT UNSAFE. `findInsertPosition` is re-run on-chain from the
 *      hint and corrects itself, so `NO_HINTS` is a legitimate fallback when a read fails —
 *      the transaction still succeeds. It is NOT a reason to skip the derivation.
 *
 * The position being re-ranked is MAREN'S POOLED TROVE, never the user's own account.
 */

/** `packages/contracts/src/interfaces/IHintHelpers.sol`. */
const hintHelpersAbi = [
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
const sortedTrovesAbi = [
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

/** The fallback: "start from the head of the list" — always accepted, just not cheap. */
export const NO_HINTS: Hints = { upper: ZERO_ADDRESS, lower: ZERO_ADDRESS };

/**
 * Read Maren's pooled trove from MUSD's TroveManager, using `getEntireDebtAndColl` so the
 * debt matches what the sorted list ranks on (total, including gas compensation and accrued
 * interest) rather than the vault's net figure.
 */
async function readTrovePosition(network: MezoNetwork): Promise<{ collWei: bigint; debtWei: bigint }> {
  const vault = getMarenAddresses(network).marenVault;
  const [coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest] =
    await getReadClient(network).readContract({
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

/** Integer square root, Babylonian. `numTrials = 15 * sqrt(listSize)`, per MUSD's docs. */
function isqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

async function computeNominalCr(
  network: MezoNetwork,
  collAfter: bigint,
  debtAfter: bigint,
): Promise<bigint> {
  // A debt-free trove has an unbounded ratio and sorts to the head; MUSD represents that as
  // 2^256 - 1, and so do we rather than dividing by zero.
  if (debtAfter === 0n) return 2n ** 256n - 1n;
  return getReadClient(network).readContract({
    address: getMusdAddresses(network).hintHelpers,
    abi: hintHelpersAbi,
    functionName: 'computeNominalCR',
    args: [collAfter, debtAfter],
  });
}

/**
 * Derive `(upperHint, lowerHint)` for the pooled trove at its post-operation position.
 * Never throws: a hint is an optimisation, and an RPC hiccup while reading one must not be
 * the reason a user cannot get their collateral back, so every failure returns `NO_HINTS`.
 */
async function deriveHints(
  network: MezoNetwork,
  collAfter: bigint,
  debtAfter: bigint,
): Promise<Hints> {
  try {
    const musd = getMusdAddresses(network);
    const client = getReadClient(network);

    const [nicr, size] = await Promise.all([
      computeNominalCr(network, collAfter, debtAfter),
      client.readContract({
        address: musd.sortedTroves,
        abi: sortedTrovesAbi,
        functionName: 'getSize',
      }),
    ]);

    if (size === 0n) return NO_HINTS;

    const numTrials = 15n * isqrt(size);
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
 * Hints for a vault operation, expressed as the signed delta it applies to the POOLED
 * trove. Never throws — falls back to `NO_HINTS`.
 */
export async function hintsForDelta(
  network: MezoNetwork,
  delta: { collDelta: bigint; debtDelta: bigint },
): Promise<Hints> {
  try {
    const current = await readTrovePosition(network);
    const collAfter = clampToZero(current.collWei + delta.collDelta);
    const debtAfter = clampToZero(current.debtWei + delta.debtDelta);
    return deriveHints(network, collAfter, debtAfter);
  } catch {
    return NO_HINTS;
  }
}

function clampToZero(value: bigint): bigint {
  return value > 0n ? value : 0n;
}
