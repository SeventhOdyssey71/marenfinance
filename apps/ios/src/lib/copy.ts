import { formatMusd } from '@maren/sdk';

import type { ActivityKind, ActivityStatus } from '../data/types';

/**
 * Copy helpers.
 *
 * BRAND.md §1: "calm, precise, adult… Numbers are stated exactly. Risk is stated
 * plainly." Every string produced here is written to survive being read by someone
 * whose money is at stake.
 */

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
      return 'Failed — no funds moved';
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
