import { formatMusd } from '@maren/sdk';

import type { ActivityKind, ActivityStatus } from './data/types';

/**
 * Copy helpers.
 *
 * BRAND.md §1: "calm, precise, adult… Numbers are stated exactly. Risk is stated
 * plainly." Every string produced here is written to survive being read by someone whose
 * money is at stake. Shared wording with `apps/ios/src/lib/copy.ts`.
 */

/** Caption under the drop-to-liquidation figure. */
export function bufferTitle(bps: number): string {
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
    case 'link-created':
      return 'Created a payment link';
    case 'link-claimed':
      return 'Payment link claimed';
    case 'request-created':
      return 'Requested payment';
  }
}

/**
 * Status wording. 'pending' never reads as delivered, and 'failed' says plainly that no
 * funds moved rather than hiding behind "unsuccessful".
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

/** The forward-looking counterpart: "in 5d", for an expiry. */
export function timeUntil(unixSeconds: number, now = Math.floor(Date.now() / 1000)): string {
  const delta = unixSeconds - now;
  if (delta <= 0) return 'already';
  if (delta < 3_600) return `in ${Math.floor(delta / 60)}m`;
  if (delta < 86_400) return `in ${Math.floor(delta / 3_600)}h`;
  return `in ${Math.floor(delta / 86_400)}d`;
}

/** "12,000.00 MUSD" with an explicit sign, for a ledger column. */
export function signedMusd(wei: bigint, direction: 'in' | 'out'): string {
  return `${direction === 'out' ? '−' : '+'}${formatMusd(wei)}`;
}

/** Which way money moved, for the activity ledger. */
export function activityDirection(kind: ActivityKind): 'in' | 'out' | 'none' {
  switch (kind) {
    case 'receive':
    case 'borrow':
    case 'withdraw':
    case 'earn-withdraw':
      return 'in';
    case 'send':
    case 'repay':
    case 'deposit':
    case 'earn-deposit':
    case 'link-created':
      return 'out';
    default:
      return 'none';
  }
}

/**
 * Parse a decimal string to 1e18 wei without going through a float. A `Number` here
 * would silently lose precision above 2^53 and round someone's balance.
 */
export function parseUnitsSafe(input: string, decimals = 18): bigint {
  const cleaned = input.replace(/,/g, '').trim();
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return 0n;
  const [whole = '0', frac = ''] = cleaned.split('.');
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  try {
    return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
  } catch {
    return 0n;
  }
}

/**
 * UTF-8 byte length. MarenPay caps the on-chain memo at 80 BYTES, not characters — one
 * emoji is four. Computed directly rather than through TextEncoder so the count is the
 * same everywhere it is shown.
 */
export function utf8Length(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const cp = char.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}
