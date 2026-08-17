import { formatMusd } from '@maren/sdk';

import type { ActivityKind, ActivityStatus } from '../data/types';

/**
 * Copy helpers.
 *
 * BRAND.md §1: "calm, precise, adult… Numbers are stated exactly. Risk is stated
 * plainly." Every string produced here is written to survive being read by someone
 * whose money is at stake.
 */

/**
 * The gas claim, written once.
 *
 * Maren must not ship the sentence "no gas, ever". It is not true, and the reason it is
 * not true is structural: `MarenVault.deposit()` is payable and the relayer refuses any
 * request carrying value, so the first deposit is an ordinary transaction the user pays
 * BTC gas for. Everything after it — borrow, repay, withdraw, close, and all of Pay and
 * Earn — is relayed and costs the user nothing.
 *
 * These strings exist so that claim is made in one place and reused, rather than being
 * retyped per screen and drifting. R13's discipline generalises: a promise that appears
 * in the interface and not in the contracts is worse than no promise, because it stops
 * people looking.
 */
export const gasCopy = {
  /** Headline on a screen whose actions are all relayed. */
  sponsoredTitle: 'Gasless: you pay no BTC',
  sponsoredBody:
    'You sign an EIP-712 message; Maren’s relayer submits it and pays the BTC gas. Your Bitcoin stays collateral.',

  /** Headline on the one action that cannot be relayed. */
  unsponsoredTitle: 'This deposit costs BTC gas',
  unsponsoredBody:
    'Deposits send Bitcoin, and a relayer cannot carry your BTC for you. This one transaction you sign and pay for yourself. Every action after it, including borrowing and every payment, is gasless.',

  /** The honest one-liner for onboarding and marketing surfaces. */
  onboardingTitle: 'Spend without gas',
  onboardingBody:
    'Mezo charges gas in BTC. Your first deposit is an ordinary transaction you pay for. After that Maren’s relayer pays the gas on everything, so you can borrow and spend MUSD without keeping a BTC balance. You sign; we settle.',
} as const;

/** Caption under the drop-to-liquidation figure. */
export function usableTitle(bps: number): string {
  if (bps <= 0) return 'liquidatable now';
  if (bps < 1_500) return 'a bad week would do it';
  if (bps < 3_500) return 'meaningful buffer';
  return 'wide buffer';
}

export function activityTitle(kind: ActivityKind, counterparty?: string): string {
  switch (kind) {
    case 'send':
      return counterparty ? `Sent to ${counterparty}` : 'Sent';
    case 'receive':
      return counterparty ? `Received from ${counterparty}` : 'Received';
    case 'deposit':
      return 'Deposited Bitcoin';
    case 'withdraw':
      return 'Withdrew Bitcoin';
    case 'borrow':
      return 'Borrowed MUSD';
    case 'repay':
      return 'Repaid MUSD';
    case 'earn-deposit':
      return 'Moved to Earn';
    case 'earn-withdraw':
      return 'Withdrew from Earn';
  }
}

/**
 * Status wording. R15 again: 'pending' never reads as delivered, and 'failed' says
 * plainly that no funds moved rather than hiding behind "unsuccessful".
 */
export function statusLabel(status: ActivityStatus): string {
  switch (status) {
    case 'pending':
      return 'Awaiting receipt';
    case 'confirmed':
      return 'Confirmed';
    case 'failed':
      return 'Failed, no funds moved';
  }
}

/** Relative time, in the app's plain register. */
export function timeAgo(unixSeconds: number, now = Math.floor(Date.now() / 1000)): string {
  const delta = Math.max(0, now - unixSeconds);
  if (delta < 60) return 'just now';
  if (delta < 3_600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.floor(delta / 3_600)}h ago`;
  const days = Math.floor(delta / 86_400);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** "12,000.00 MUSD" with an explicit sign, for a ledger column. */
export function signedMusd(wei: bigint, direction: 'in' | 'out'): string {
  return `${direction === 'out' ? '−' : '+'}${formatMusd(wei)}`;
}
