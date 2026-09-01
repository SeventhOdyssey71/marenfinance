import type { Address } from 'viem';

import * as live from './live';
import * as mock from './mock';
import type { ActivityWindow, Balances, EarnPosition, Handle, LinkState, Position } from './types';
import type { PriceObservation } from '../chain/price';

/**
 * The one place the app decides where its numbers come from.
 *
 * LIVE IS THE DEFAULT AND THE RESTING STATE. Every screen reads matsnet unless somebody
 * has deliberately gone into Settings → Developer and turned the demo source on, and the
 * moment they do, the screens say so. That ordering is the entire safety argument: the
 * failure mode a mock creates is not that it exists, it is that invented data gets
 * mistaken for read data. A source that is off by default and labelled when on cannot be
 * mistaken for anything.
 *
 * Every screen imports from HERE rather than from `./live` or `./mock` directly, so
 * there is exactly one switch rather than one per screen, and no screen can be left
 * behind pointing at the wrong module.
 *
 * The functions below are deliberately thin. They resolve the active module at CALL
 * TIME, not at import time, so flipping the toggle takes effect on the next read rather
 * than on the next app launch.
 */

export type DataSourceKind = 'live' | 'mock';

let kind: DataSourceKind = 'live';

export function setDataSource(next: DataSourceKind): void {
  kind = next;
}

export function getDataSource(): DataSourceKind {
  return kind;
}

/** True when the figures on screen are invented. Screens render a banner from this. */
export function isDemoData(): boolean {
  return kind === 'mock';
}

function active() {
  return kind === 'mock' ? mock : live;
}

// ── the reads ────────────────────────────────────────────────────────────────
//
// One line each, and each one is the identical signature in both modules. The types are
// written out rather than inferred so that a future divergence in either module is a
// compile error here rather than a silently widened `any` at the call sites.

export function readPrice(): Promise<PriceObservation> {
  return active().readPrice();
}

export function readPosition(): Promise<Position> {
  return active().readPosition();
}

export function readBalances(): Promise<Balances> {
  return active().readBalances();
}

export function readEarn(): Promise<EarnPosition> {
  return active().readEarn();
}

export function readActivity(): Promise<ActivityWindow> {
  return active().readActivity();
}

export function resolveHandle(query: string): Promise<Handle | null> {
  return active().resolveHandle(query);
}

/** A claimable link's on-chain state, read before a claimer signs. See both modules. */
export function readLink(linkId: bigint): Promise<LinkState> {
  return active().readLink(linkId);
}

export function reverseResolve(address: Address): Promise<string | null> {
  return active().reverseResolve(address);
}

/**
 * The stale-oracle developer control, applied to BOTH modules.
 *
 * It is set on both rather than on the active one because the toggle and the source are
 * independent settings, and a user who turns staleness on, then switches source, must not
 * find the control silently forgotten. The two implementations differ in exactly the way
 * they should: the mock backdates an invented observation, and live backdates the
 * timestamp on an observation it genuinely read, leaving the price itself untouched.
 * Neither fabricates a price. See the note in `live.ts`.
 */
export function setForcedStaleSeconds(seconds: number): void {
  live.setForcedStaleSeconds(seconds);
  mock.setForcedStaleSeconds(seconds);
}

export function getForcedStaleSeconds(): number {
  return active().getForcedStaleSeconds();
}

/**
 * Local effects after a confirmed transaction.
 *
 * The mock moves its in-memory copy of the position; live does nothing, because the
 * chain has already moved and the next read is the truth. Callers do not branch on which.
 */
export const mutate = {
  depositBtc: (wei: bigint) => active().mutate.depositBtc(wei),
  withdrawBtc: (wei: bigint) => active().mutate.withdrawBtc(wei),
  borrow: (wei: bigint) => active().mutate.borrow(wei),
  repay: (wei: bigint) => active().mutate.repay(wei),
  send: (wei: bigint) => active().mutate.send(wei),
  earnDeposit: (wei: bigint) => active().mutate.earnDeposit(wei),
  earnWithdraw: (wei: bigint) => active().mutate.earnWithdraw(wei),
  split: (totalWei: bigint) => active().mutate.split(totalWei),
  createRequest: () => active().mutate.createRequest(),
  createLink: (wei: bigint) => active().mutate.createLink(wei),
  reclaimLink: (linkId: bigint) => active().mutate.reclaimLink(linkId),
  claimLink: (linkId: bigint) => active().mutate.claimLink(linkId),
};
