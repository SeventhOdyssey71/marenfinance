import { BORROWING_RATE, INTEREST_RATE_BPS, MUSD_GAS_COMPENSATION, WAD } from '@maren/sdk';
import type { Address, Hash } from 'viem';

import type { PriceObservation } from '../chain/price';
import { demoState } from './demo';
import type {
  ActivityItem,
  Balances,
  EarnPosition,
  Handle,
  PaymentLink,
  PaymentRequest,
  Position,
  Sponsorship,
} from './types';

/**
 * Mock chain state.
 *
 * Every function here has the signature its viem replacement has in `./live.ts`, returns
 * the types in `./types.ts`, and is async. Nothing downstream knows the data is mocked —
 * screens call `useMarenData()` either way, and `./source.ts` decides which side answers.
 *
 * The numbers exercise the interesting states rather than flatter the product: the direct
 * position sits at a genuinely adequate ratio rather than a comfortable one, the pooled
 * account is small enough that a direct trove is impossible, and the Earn window contains
 * a long stretch with no gains at all, which is what the Stability Pool actually looks
 * like.
 */

export const MOCK_ADDRESS: Address = '0x8F3a4C21B7dE05aE9c1f6b2E4D8a70915cC3B4d2';
export const MOCK_HANDLE = '@sele';

/** ~$63,000 BTC, the figure ARCHITECTURE.md §1 works its examples against. */
const BASE_PRICE = 63_000n * WAD;

const DAY = 24 * 60 * 60;

let priceDrift = 0n;

/**
 * A moving BTC price. Drifts by a few hundred dollars so the health card visibly
 * recomputes, which is how the counting numerals and the ratio bands get exercised
 * without a live oracle.
 */
export async function readPrice(): Promise<PriceObservation> {
  await tick();
  // Deterministic sawtooth: ±$420 around the base, stepping each read.
  priceDrift = (priceDrift + 137n * WAD) % (840n * WAD);
  const priceWei = BASE_PRICE - 420n * WAD + priceDrift;

  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    priceWei,
    // The demo control backdates the observation so the "price feed unavailable" state
    // can be exercised from the header.
    updatedAt: nowSeconds - demoState().forcedStaleSeconds,
  };
}

/**
 * Two accounts, because the two borrow routes are genuinely different products and the
 * screen has to be right for both.
 *
 *   direct — 0.5 BTC against 12,000 MUSD. At $63k that is a ratio around 260%: healthy,
 *            but not by a wide margin, and one bad week from caution. A demo position at
 *            900% would hide the entire point of the health card.
 *   pooled — 0.012 BTC (~$756). Nowhere near the 1,800 MUSD protocol minimum, so a trove
 *            of one's own is impossible and MarenVault is the only route. This is the
 *            user the product exists for.
 */
const ACCOUNTS = {
  direct: {
    collateralWei: 500_000_000_000_000_000n, // 0.5 BTC
    principalWei: 12_000n * WAD,
    musdWei: 3_420n * WAD,
    btcWei: 0n, // The user holds no BTC for gas. That is the product.
    earnSharesWei: 2_500n * WAD,
    earnDepositedWei: 2_450n * WAD,
    /** Fixed at the price when the trove opened ($61,200 here), NOT recomputed. */
    maxBorrowingCapacityWei: 24_500n * WAD,
    openedDaysAgo: 214,
  },
  pooled: {
    collateralWei: 12_000_000_000_000_000n, // 0.012 BTC
    principalWei: 300n * WAD,
    musdWei: 184n * WAD,
    btcWei: 0n,
    earnSharesWei: 120n * WAD,
    earnDepositedWei: 118n * WAD,
    /** The POOLED trove's ceiling, shared by every user inside it. */
    maxBorrowingCapacityWei: 480_000n * WAD,
    openedDaysAgo: 46,
  },
} as const;

type MutableAccount = {
  collateralWei: bigint;
  principalWei: bigint;
  musdWei: bigint;
  btcWei: bigint;
  earnSharesWei: bigint;
  earnDepositedWei: bigint;
  maxBorrowingCapacityWei: bigint;
  openedDaysAgo: number;
};

const live: Record<'direct' | 'pooled', MutableAccount> = {
  direct: { ...ACCOUNTS.direct },
  pooled: { ...ACCOUNTS.pooled },
};

function current(): MutableAccount {
  return live[demoState().account];
}

export async function readPosition(): Promise<Position> {
  await tick();
  const account = current();
  const route = demoState().account;

  const elapsed = BigInt(account.openedDaysAgo) * BigInt(DAY);
  const interestWei =
    (elapsed * account.principalWei * BigInt(INTEREST_RATE_BPS)) / (10_000n * 365n * BigInt(DAY));

  /**
   * A DIRECT trove carries the 0.1% origination fee and the 200 MUSD gas compensation.
   * A POOLED position carries neither — one gas compensation covers the whole pooled
   * trove and the protocol's seed position already paid it, and a borrow served from the
   * vault's MUSD reserve pays no origination fee. Adding them here would overstate a
   * pooled user's debt by 200 MUSD, which would then understate their ratio.
   * See `MarenVault.collateralRequiredForDebt` for the counterpart comment.
   */
  const originationFee = route === 'direct' ? (account.principalWei * BORROWING_RATE) / WAD : 0n;
  const gasCompensation = route === 'direct' ? MUSD_GAS_COMPENSATION : 0n;

  const debtWei = account.principalWei + originationFee + interestWei + gasCompensation;

  return {
    collateralWei: account.collateralWei,
    debtWei,
    principalWei: account.principalWei,
    interestWei,
    interestRateBps: INTEREST_RATE_BPS,
    maxBorrowingCapacityWei: account.maxBorrowingCapacityWei,
    vaultMaxBorrowableWei: route === 'pooled' ? 1_240n * WAD : undefined,
    route,
    openedAt: Math.floor(Date.now() / 1000) - account.openedDaysAgo * DAY,
  };
}

export async function readBalances(): Promise<Balances> {
  await tick();
  const account = current();
  return { musdWei: account.musdWei, btcWei: account.btcWei };
}

export async function readEarn(): Promise<EarnPosition> {
  await tick();
  const account = current();
  // Share price has drifted above 1.0 as liquidation gains were swept in.
  const assetsWei = (account.earnSharesWei * 1_021_400_000_000_000_000n) / WAD;
  return {
    sharesWei: account.earnSharesWei,
    assetsWei,
    depositedWei: account.earnDepositedWei,
    trailing: {
      windowDays: 90,
      realisedWei: assetsWei - account.earnDepositedWei,
      // Three events in ninety days. Lumpy, exactly as described.
      liquidationEvents: 3,
      lastGainAt: Math.floor(Date.now() / 1000) - 11 * DAY,
    },
  };
}

export async function readSponsorship(): Promise<Sponsorship> {
  await tick();
  return {
    freeActionsRemaining: 23,
    freeActionsPerMonth: 25,
    feeAfterFreeTierWei: 20_000_000_000_000_000n, // 0.02 MUSD
  };
}

const HANDLES: Handle[] = [
  { handle: '@sele', address: MOCK_ADDRESS },
  { handle: '@nadia', address: '0x2C9e7A1f4B8d05E36aC7f19D2b4E80315aF6c7B1' },
  { handle: '@okonkwo', address: '0x71B4dE8a03C25f9e1A6b7D40c8E3925fA1c04E77' },
  { handle: '@mira', address: '0xA3f18C90b25D74eE6c0a9F31B85d4270cE9b6A15' },
];

/** MarenRegistry.tryResolve — returns null rather than reverting on an unknown handle. */
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

const now = () => Math.floor(Date.now() / 1000);

const seededActivity = (): ActivityItem[] => [
  {
    id: 'a1',
    kind: 'send',
    status: 'confirmed',
    at: now() - 2 * 60 * 60,
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
    at: now() - 19 * 60 * 60,
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
    kind: 'link-created',
    status: 'confirmed',
    at: now() - 26 * 60 * 60,
    musdWei: 50n * WAD,
    memo: 'Coffee fund — claimable link',
    hash: '0x3a91cf75d0b28e4617ac503fd8b2946e17f0c8daa3b6512e94d70cf8a2b5163d' as Hash,
    sponsored: true,
    gasPaidWei: 0n,
    network: 'testnet',
  },
  {
    id: 'a4',
    kind: 'send',
    status: 'failed',
    at: now() - 2 * DAY - 3 * 60 * 60,
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
    id: 'a5',
    kind: 'borrow',
    status: 'confirmed',
    at: now() - 4 * DAY,
    musdWei: 2_000n * WAD,
    hash: '0xb82f14c07de935a1c6408b7fd25e390174ac6b28de0951f3760a4c8b21eda637' as Hash,
    sponsored: false,
    gasPaidWei: 21_000n * 1_200_000_000n,
    network: 'testnet',
  },
  {
    id: 'a6',
    kind: 'earn-deposit',
    status: 'confirmed',
    at: now() - 11 * DAY,
    musdWei: 2_450n * WAD,
    hash: '0x5d017fa3b6c284e9105af73bd60c2e8419736fa0b2d5c81e94036bd7a5f128ce' as Hash,
    sponsored: true,
    gasPaidWei: 0n,
    network: 'testnet',
  },
  {
    id: 'a7',
    kind: 'deposit',
    status: 'confirmed',
    at: now() - 31 * DAY,
    btcWei: 500_000_000_000_000_000n,
    hash: '0x7e4a2b90c15df386240a7bc9e05f13782ad4c60b9e173f5a82d0c46be9137a02' as Hash,
    // The first deposit. Payable, therefore never relayable, therefore paid for in BTC.
    sponsored: false,
    gasPaidWei: 21_000n * 1_100_000_000n,
    network: 'testnet',
  },
];

let activity: ActivityItem[] | null = null;

export async function readActivity(): Promise<ActivityItem[]> {
  await tick();
  activity ??= seededActivity();
  return [...activity].sort((a, b) => b.at - a.at);
}

let requests: PaymentRequest[] | null = null;

const seededRequests = (): PaymentRequest[] => [
  {
    id: '7',
    amountWei: 480n * WAD,
    payer: HANDLES[2]!.address,
    payerHandle: '@okonkwo',
    memo: 'Invoice 0044',
    createdAt: now() - 3 * DAY,
    status: 'open',
    direction: 'outgoing',
  },
  {
    id: '6',
    amountWei: 65n * WAD,
    payer: MOCK_ADDRESS,
    payerHandle: '@sele',
    memo: 'Dinner, split three ways',
    createdAt: now() - 5 * DAY,
    status: 'open',
    direction: 'incoming',
  },
];

export async function readRequests(): Promise<PaymentRequest[]> {
  await tick();
  requests ??= seededRequests();
  return [...requests];
}

let links: PaymentLink[] | null = null;

const seededLinks = (): PaymentLink[] => [
  {
    id: '3',
    amountWei: 50n * WAD,
    linkKey: '0xC41f8B2a7D95e0136c4B8fd270aE59137bA6c204' as Address,
    secret: '0x' + 'a3'.repeat(32),
    expiry: now() + 5 * DAY,
    createdAt: now() - 26 * 60 * 60,
    memo: 'Coffee fund',
    status: 'unclaimed',
  },
];

export async function readLinks(): Promise<PaymentLink[]> {
  await tick();
  links ??= seededLinks();
  return [...links];
}

/** A small delay so loading states are real rather than theoretical. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 90));
}

/**
 * Apply a local mutation so the demo flows change the numbers they claim to change.
 *
 * The live implementations submit a transaction and then go through `confirmTransaction`
 * before any state moves. Here nothing is broadcast, which is why the transaction sheet
 * says "simulated" rather than "delivered" — mock mode never claims a receipt it does not
 * have.
 */
export const mutate = {
  depositBtc(wei: bigint) {
    current().collateralWei += wei;
  },
  withdrawBtc(wei: bigint) {
    const account = current();
    account.collateralWei = account.collateralWei > wei ? account.collateralWei - wei : 0n;
  },
  borrow(wei: bigint) {
    const account = current();
    account.principalWei += wei;
    account.musdWei += wei;
  },
  repay(wei: bigint) {
    const account = current();
    const applied = wei > account.principalWei ? account.principalWei : wei;
    account.principalWei -= applied;
    account.musdWei = account.musdWei > applied ? account.musdWei - applied : 0n;
  },
  send(wei: bigint, to: string, memo: string) {
    const account = current();
    account.musdWei = account.musdWei > wei ? account.musdWei - wei : 0n;
    activity ??= seededActivity();
    activity.unshift({
      id: `local-${activity.length + 1}`,
      kind: 'send',
      status: 'confirmed',
      at: now(),
      musdWei: wei,
      counterparty: to,
      memo: memo || undefined,
      sponsored: true,
      gasPaidWei: 0n,
      network: 'testnet',
    });
  },
  earnDeposit(wei: bigint) {
    const account = current();
    account.musdWei = account.musdWei > wei ? account.musdWei - wei : 0n;
    account.earnSharesWei += (wei * WAD) / 1_021_400_000_000_000_000n;
    account.earnDepositedWei += wei;
  },
  earnWithdraw(wei: bigint) {
    const account = current();
    account.musdWei += wei;
    const shares = (wei * WAD) / 1_021_400_000_000_000_000n;
    account.earnSharesWei = account.earnSharesWei > shares ? account.earnSharesWei - shares : 0n;
  },
  createRequest(amountWei: bigint, payerHandle: string | null, memo: string) {
    requests ??= seededRequests();
    requests.unshift({
      id: String(20 + requests.length),
      amountWei,
      payer: null,
      payerHandle,
      memo,
      createdAt: now(),
      status: 'open',
      direction: 'outgoing',
    });
  },
  cancelRequest(id: string) {
    requests ??= seededRequests();
    const found = requests.find((r) => r.id === id);
    if (found) found.status = 'cancelled';
  },
  createLink(amountWei: bigint, expiryDays: number, memo: string, secret: string, key: Address) {
    const account = current();
    account.musdWei = account.musdWei > amountWei ? account.musdWei - amountWei : 0n;
    links ??= seededLinks();
    links.unshift({
      id: String(10 + links.length),
      amountWei,
      linkKey: key,
      secret,
      expiry: now() + expiryDays * DAY,
      createdAt: now(),
      memo,
      status: 'unclaimed',
    });
  },
  reclaimLink(id: string) {
    links ??= seededLinks();
    const found = links.find((l) => l.id === id);
    if (!found) return;
    found.status = 'reclaimed';
    current().musdWei += found.amountWei;
  },
};
