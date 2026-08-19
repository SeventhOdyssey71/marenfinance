import {
  BORROWING_RATE,
  INTEREST_RATE_BPS,
  MUSD_GAS_COMPENSATION,
  getDeploymentBlock,
  WAD,
} from '@maren/sdk';
import type { Address, Hash } from 'viem';

import type { PriceObservation } from '../chain/price';
import type {
  ActivityItem,
  ActivityWindow,
  Balances,
  EarnPosition,
  Handle,
  Position,
} from './types';

/**
 * Mock chain state.
 *
 * Every function here has the signature its viem replacement will have, returns the
 * types in ./types.ts, and is async. Nothing downstream of this file knows the data is
 * mocked — screens call the same `readPosition()` either way. Swapping to live data
 * means replacing the bodies in this file with contract reads, and nothing else.
 *
 * THAT SWAP HAS HAPPENED. `./live.ts` is the replacement, it is what the app reads by
 * default, and `./parity.test.ts` asserts the two modules export the same function names
 * with the same arities, so the sentence above is now enforced by CI rather than merely
 * promised in a comment.
 *
 * THIS FILE SURVIVES ON PURPOSE, AND UNDER TERMS. It is reachable only through
 * Settings → Developer → "Use demo data", it is off by default, and every screen it
 * feeds says on its face that the figures are demo data rather than chain state. That
 * last condition is not decoration. The web app deleted its own mock because it was on
 * by default and rendered invented transaction hashes as working explorer links under a
 * header reading "Live from Mezo testnet"; a reviewer who tapped one would have found
 * nothing on chain and been right to distrust every other number in the product. The
 * defence against that is not deleting the file, it is never letting invented data be
 * mistaken for read data. The default and the banner are what enforce it.
 *
 * What it buys: the app can be walked end to end with no network, and it holds states a
 * testnet will not produce on demand — a position at a genuinely adequate CR rather than
 * a comfortable one, a failed send, and an Earn window with a long stretch of no gains
 * at all, which is what the Stability Pool actually looks like.
 */

export const MOCK_ADDRESS: Address = '0x8F3a4C21B7dE05aE9c1f6b2E4D8a70915cC3B4d2';
export const MOCK_HANDLE = '@sele';

/** ~$63,000 BTC, the figure ARCHITECTURE.md §1 works its examples against. */
const BASE_PRICE = 63_000n * WAD;

let priceDrift = 0n;
let forcedStaleSeconds = 0;

/**
 * A moving BTC price. Drifts by a few hundred dollars so the health card visibly
 * recomputes, which is how the counting-number animation and the CR colour bands get
 * exercised without needing a live oracle.
 */
export async function readPrice(): Promise<PriceObservation> {
  await tick();
  // Deterministic sawtooth: ±$420 around the base, stepping each read.
  priceDrift = (priceDrift + 137n * WAD) % (840n * WAD);
  const priceWei = BASE_PRICE - 420n * WAD + priceDrift;

  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    priceWei,
    // `forcedStaleSeconds` backdates the observation so the "price feed unavailable"
    // state can be exercised from Settings. See ARCHITECTURE.md §4.
    updatedAt: nowSeconds - forcedStaleSeconds,
  };
}

/** Settings → Developer → simulate a stale oracle. */
export function setForcedStaleSeconds(seconds: number): void {
  forcedStaleSeconds = seconds;
}

export function getForcedStaleSeconds(): number {
  return forcedStaleSeconds;
}

/**
 * 0.5 BTC collateral against 12,000 MUSD net debt.
 *
 * At $63k that is a CR around 260%, i.e. `healthy` but not by a wide margin, and one
 * bad week away from `caution`. A demo position at 900% would hide the entire point of
 * the health card.
 */
const state = {
  collateralWei: 500_000_000_000_000_000n, // 0.5 BTC
  principalWei: 12_000n * WAD,
  musdWei: 3_420n * WAD,
  // Zero BTC in the wallet: the deposit already moved it into the trove, and the
  // relayer pays gas from here on. This is the steady state, not the starting state —
  // opening the position cost this user gas they no longer need.
  btcWei: 0n,
  earnSharesWei: 2_500n * WAD,
  earnDepositedWei: 2_450n * WAD,
};

export async function readPosition(): Promise<Position> {
  await tick();

  const originationFee = (state.principalWei * BORROWING_RATE) / WAD;
  // 214 days of simple, non-compounding interest at the rate the trove opened at.
  const elapsed = 214n * 24n * 60n * 60n;
  const interestWei =
    (elapsed * state.principalWei * BigInt(INTEREST_RATE_BPS)) / (10_000n * 365n * 24n * 60n * 60n);

  return {
    collateralWei: state.collateralWei,
    debtWei: state.principalWei + originationFee + interestWei + MUSD_GAS_COMPENSATION,
    principalWei: state.principalWei,
    interestWei,
    interestRateBps: INTEREST_RATE_BPS,
    // Fixed at the price when the trove opened ($61,200 here), NOT recomputed from the
    // current price — that is the Mezo-only behaviour in LIQUITY_DIVERGENCES #3.
    maxBorrowingCapacityWei: 24_500n * WAD,
    route: 'direct',
  };
}

export async function readBalances(): Promise<Balances> {
  await tick();
  return { musdWei: state.musdWei, btcWei: state.btcWei };
}

export async function readEarn(): Promise<EarnPosition> {
  await tick();
  // Share price has drifted above 1.0 as liquidation gains were swept in.
  const assetsWei = (state.earnSharesWei * 1_021_400_000_000_000_000n) / WAD;
  return {
    sharesWei: state.earnSharesWei,
    assetsWei,
    depositedWei: state.earnDepositedWei,
    trailing: {
      windowDays: 90,
      realisedWei: assetsWei - state.earnDepositedWei,
      // Three events in ninety days. Lumpy, exactly as described.
      liquidationEvents: 3,
      lastGainAt: Math.floor(Date.now() / 1000) - 11 * 24 * 60 * 60,
    },
  };
}

const HANDLES: Handle[] = [
  { handle: '@sele', address: MOCK_ADDRESS },
  { handle: '@nadia', address: '0x2C9e7A1f4B8d05E36aC7f19D2b4E80315aF6c7B1' },
  { handle: '@okonkwo', address: '0x71B4dE8a03C25f9e1A6b7D40c8E3925fA1c04E77' },
  { handle: '@mira', address: '0xA3f18C90b25D74eE6c0a9F31B85d4270cE9b6A15' },
];

/** MarenRegistry reverse/forward resolution. */
export async function resolveHandle(query: string): Promise<Handle | null> {
  await tick();
  const needle = query.trim().toLowerCase();
  const withAt = needle.startsWith('@') ? needle : `@${needle}`;
  return HANDLES.find((h) => h.handle.toLowerCase() === withAt) ?? null;
}

export async function reverseResolve(address: Address): Promise<string | null> {
  await tick();
  return HANDLES.find((h) => h.address.toLowerCase() === address.toLowerCase())?.handle ?? null;
}

const now = Math.floor(Date.now() / 1000);
const DAY = 24 * 60 * 60;

export const MOCK_ACTIVITY: ActivityItem[] = [
  {
    id: 'a1',
    kind: 'send',
    status: 'confirmed',
    at: now - 2 * 60 * 60,
    musdWei: 240n * WAD,
    counterparty: '@nadia',
    counterpartyAddress: HANDLES[1]!.address,
    memo: 'Rent, October share',
    hash: '0x9f2c1a7b4e83d05c6a19f7be204d38915cc7ab420e1f6d93b8a4750c21de6f38' as Hash,
    sponsored: true,
    gasPaidWei: 0n,
    network: 'testnet',
  },
  {
    id: 'a2',
    kind: 'receive',
    status: 'confirmed',
    at: now - 19 * 60 * 60,
    musdWei: 1_500n * WAD,
    counterparty: '@okonkwo',
    counterpartyAddress: HANDLES[2]!.address,
    memo: 'Invoice 0043',
    hash: '0x41ba8f0d27c95e136a7b40df82c1590ae63b7d4109f28c5aeb03746d15920fbc' as Hash,
    sponsored: true,
    gasPaidWei: 0n,
    network: 'testnet',
  },
  {
    id: 'a3',
    kind: 'send',
    status: 'failed',
    at: now - 2 * DAY - 3 * 60 * 60,
    musdWei: 90n * WAD,
    counterparty: '@mira',
    counterpartyAddress: HANDLES[3]!.address,
    memo: 'Coffee',
    hash: '0x0c73e5a19b48f27d3e60ca815947fb2d08e61c37a95240dbf7168e0b3c4a9d51' as Hash,
    sponsored: true,
    gasPaidWei: 0n,
    network: 'testnet',
  },
  {
    id: 'a4',
    kind: 'borrow',
    status: 'confirmed',
    at: now - 4 * DAY,
    musdWei: 2_000n * WAD,
    hash: '0xb82f14c07de935a1c6408b7fd25e390174ac6b28de0951f3760a4c8b21eda637' as Hash,
    // Relayed, like everything except the deposit below. See chain/sponsorship.ts.
    sponsored: true,
    gasPaidWei: 0n,
    network: 'testnet',
  },
  {
    id: 'a5',
    kind: 'earn-deposit',
    status: 'confirmed',
    at: now - 11 * DAY,
    musdWei: 2_450n * WAD,
    hash: '0x5d017fa3b6c284e9105af73bd60c2e8419736fa0b2d5c81e94036bd7a5f128ce' as Hash,
    sponsored: true,
    gasPaidWei: 0n,
    network: 'testnet',
  },
  {
    id: 'a6',
    kind: 'deposit',
    status: 'confirmed',
    at: now - 31 * DAY,
    btcWei: 500_000_000_000_000_000n,
    hash: '0x7e4a2b90c15df386240a7bc9e05f13782ad4c60b9e173f5a82d0c46be9137a02' as Hash,
    /**
     * The one gas payment in this ledger, and deliberately so.
     *
     * `MarenVault.deposit()` is payable, and the relayer refuses any request carrying
     * value — so the transaction that opened this position is the only one the user paid
     * for. Scrolling to the bottom of Activity is the clearest statement of the product
     * the app makes: one gas line, thirty-one days ago, and nothing since.
     */
    sponsored: false,
    gasPaidWei: 21_000n * 1_100_000_000n,
    network: 'testnet',
  },
];

/**
 * The demo ledger, in the same `ActivityWindow` shape the live reader produces.
 *
 * The window's block numbers are the deployment block on both ends, and they are never
 * rendered: the Activity screen suppresses the coverage line entirely while the demo
 * source is selected, because "read every block from X to Y" is a claim about a scan and
 * no scan happened here. Returning the same TYPE as the live reader is what keeps the
 * two interchangeable; returning the same SENTENCE would be a lie.
 */
export async function readActivity(): Promise<ActivityWindow> {
  await tick();
  const block = getDeploymentBlock('testnet') ?? 0n;
  return {
    items: [...MOCK_ACTIVITY].sort((a, b) => b.at - a.at),
    fromBlock: block,
    toBlock: block,
    complete: true,
  };
}

/** A small delay so loading states are real rather than theoretical. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 140));
}

/**
 * Apply a local mutation so the demo flows change the numbers they claim to change.
 * The real implementations submit a transaction and then go through
 * `confirmTransaction` before any of this state moves — see chain/actions.ts.
 */
export const mutate = {
  depositBtc(wei: bigint) {
    state.collateralWei += wei;
  },
  withdrawBtc(wei: bigint) {
    state.collateralWei -= wei;
  },
  borrow(wei: bigint) {
    state.principalWei += wei;
    state.musdWei += wei;
  },
  repay(wei: bigint) {
    state.principalWei -= wei;
    state.musdWei -= wei;
  },
  send(wei: bigint) {
    state.musdWei -= wei;
  },
  earnDeposit(wei: bigint) {
    state.musdWei -= wei;
    state.earnSharesWei += (wei * WAD) / 1_021_400_000_000_000_000n;
    state.earnDepositedWei += wei;
  },
  earnWithdraw(wei: bigint) {
    state.musdWei += wei;
    state.earnSharesWei -= (wei * WAD) / 1_021_400_000_000_000_000n;
  },
};
