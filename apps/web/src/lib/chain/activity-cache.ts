import { getMarenAddresses, type MezoNetwork } from '@maren/sdk';
import type { Address } from 'viem';

import type { ActivityItem } from '../data/types';
import type { ActivityWindow } from './logs';

/**
 * The Activity cache.
 *
 * WHAT IT IS FOR. Reading history costs `eth_getLogs` over 10,000-block windows, three
 * contracts per window, and the app re-ran the whole scan from the deployment block on
 * every single visit. Today that is eighteen requests; the chain adds about 18,000 blocks
 * a day, so in a month it is a scan the RPC will refuse to finish. Nothing about a block
 * that was mined last week changes, so re-reading it is pure waste.
 *
 * THE ONE RULE IT MUST NOT BREAK. Activity renders a coverage line — "Read every block
 * from X to Y" — and an empty state that claims to be a fact about the whole chain. Both
 * are claims about what was actually read. A cache that merges a stored range into that
 * sentence is claiming those blocks were read, so it may only do so when they genuinely
 * were, by this browser, for this account, against these contracts. Every design decision
 * below is downstream of that:
 *
 *   1. THE KEY CARRIES EVERYTHING THAT COULD MAKE THE ROWS WRONG — a format version, the
 *      chain id, the account, and a fingerprint of the three contract addresses. Redeploy
 *      Maren and the fingerprint changes, so the old rows are not merged, not migrated and
 *      not reasoned about; they are simply never found.
 *   2. RANGES MUST BE CONTIGUOUS TO BE COMBINED. If the fresh scan starts after the stored
 *      range ends, there is a hole between them, and a single "from X to Y" spanning a hole
 *      would be a lie. The stored range is discarded rather than patched.
 *   3. REORGS ARE ASSUMED, NOT DETECTED. The last `REORG_DEPTH` blocks of the stored range
 *      are re-read on every visit and the stored rows inside them are thrown away in favour
 *      of what the node says now. This is cheap — a hundred blocks is a fraction of one
 *      window — and it means a reorged-away transaction disappears from the list instead of
 *      being remembered forever by a browser that never asked again.
 *
 * The cache is an optimisation and is treated as one everywhere: any corruption, any parse
 * failure, any shape it does not recognise is dropped and the scan runs cold. It is never
 * repaired, because a repaired cache is a guess about what was read.
 */

/**
 * Bump when the stored shape changes. A version in the KEY rather than in the value means
 * an old entry is not read at all, so there is no migration path to get wrong.
 */
export const ACTIVITY_CACHE_VERSION = 1;

/**
 * How far back to re-read on every visit.
 *
 * 100 blocks is about eight minutes on matsnet. Mezo has no published finality depth this
 * is derived from; it is a pragmatic figure, deep enough to cover the ordinary short
 * reorg and shallow enough that re-reading it costs nothing. It is not a safety proof, and
 * a deeper reorg would be corrected the moment the stored range is dropped for any other
 * reason.
 */
export const REORG_DEPTH = 100n;

/**
 * How many rows a stored entry keeps.
 *
 * Higher than the 50 the screen renders, because the cache accumulates across visits: at
 * 50 a busy account would push older rows out of the store while the coverage line still
 * claimed their blocks were read, and the list would develop holes the sentence did not
 * admit to. 200 is the point past which that becomes possible, and past which the answer
 * is an indexer rather than a bigger number.
 */
export const CACHE_MAX_ROWS = 200;

const PREFIX = 'maren.activity';

/** The fields that make a stored entry belong to one account on one deployment. */
export interface ActivityCacheIdentity {
  chainId: number;
  account: Address;
  network: MezoNetwork;
}

/**
 * A stable, order-independent-of-nothing fingerprint of the contracts a scan read.
 *
 * FNV-1a rather than keccak: this needs to change when the addresses change and needs to
 * be computable synchronously during a render. It is not a security boundary — a collision
 * would cause a stale cache, and the version and chain id are in the key beside it.
 */
export function contractsFingerprint(addresses: readonly string[]): string {
  const joined = addresses.map((a) => a.toLowerCase()).join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i += 1) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function activityCacheKey(identity: ActivityCacheIdentity): string {
  const maren = getMarenAddresses(identity.network);
  const fingerprint = contractsFingerprint([maren.marenVault, maren.marenPay, maren.marenEarn]);
  return [
    PREFIX,
    `v${ACTIVITY_CACHE_VERSION}`,
    identity.chainId,
    identity.account.toLowerCase(),
    fingerprint,
  ].join('.');
}

// ── serialisation ────────────────────────────────────────────────────────────
// `JSON.stringify` throws on a bigint, and every amount in this app is one. Each is
// written as a decimal string and read back with `BigInt`, so nothing is ever narrowed
// through a `number` on the way to storage.

interface StoredItem {
  id: string;
  kind: string;
  status: string;
  at: number;
  musdWei?: string;
  btcWei?: string;
  counterparty?: string;
  counterpartyAddress?: string;
  memo?: string;
  hash?: string;
  blockNumber?: string;
  sponsored: boolean;
  gasPaidWei: string;
  network: string;
}

export interface StoredActivity {
  fromBlock: string;
  toBlock: string;
  items: StoredItem[];
}

function serialiseItem(item: ActivityItem): StoredItem {
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    at: item.at,
    musdWei: item.musdWei?.toString(),
    btcWei: item.btcWei?.toString(),
    counterparty: item.counterparty,
    counterpartyAddress: item.counterpartyAddress,
    memo: item.memo,
    hash: item.hash,
    blockNumber: item.blockNumber?.toString(),
    sponsored: item.sponsored,
    gasPaidWei: item.gasPaidWei.toString(),
    network: item.network,
  };
}

/**
 * Read one stored row back, or reject it.
 *
 * Returns `null` for anything whose required fields are missing or unparseable rather than
 * defaulting them. A row with a defaulted amount is an invented amount, and this file sits
 * one import away from the module whose entire purpose is that the app stopped doing that.
 */
function deserialiseItem(raw: unknown): ActivityItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as StoredItem;
  if (typeof item.id !== 'string' || typeof item.kind !== 'string') return null;
  if (typeof item.at !== 'number' || typeof item.gasPaidWei !== 'string') return null;

  try {
    return {
      id: item.id,
      kind: item.kind as ActivityItem['kind'],
      status: item.status as ActivityItem['status'],
      at: item.at,
      musdWei: item.musdWei === undefined ? undefined : BigInt(item.musdWei),
      btcWei: item.btcWei === undefined ? undefined : BigInt(item.btcWei),
      counterparty: item.counterparty,
      counterpartyAddress: item.counterpartyAddress as Address | undefined,
      memo: item.memo,
      hash: item.hash as ActivityItem['hash'],
      blockNumber: item.blockNumber === undefined ? undefined : BigInt(item.blockNumber),
      sponsored: Boolean(item.sponsored),
      gasPaidWei: BigInt(item.gasPaidWei),
      network: item.network as MezoNetwork,
    };
  } catch {
    return null;
  }
}

export function serialiseWindow(window: ActivityWindow): StoredActivity {
  return {
    fromBlock: window.fromBlock.toString(),
    toBlock: window.toBlock.toString(),
    items: window.items.slice(0, CACHE_MAX_ROWS).map(serialiseItem),
  };
}

/** The inverse. `null` for anything this version cannot read with confidence. */
export function deserialiseWindow(raw: unknown, deployedAt: bigint): ActivityWindow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const stored = raw as StoredActivity;
  if (typeof stored.fromBlock !== 'string' || typeof stored.toBlock !== 'string') return null;
  if (!Array.isArray(stored.items)) return null;

  let fromBlock: bigint;
  let toBlock: bigint;
  try {
    fromBlock = BigInt(stored.fromBlock);
    toBlock = BigInt(stored.toBlock);
  } catch {
    return null;
  }
  if (toBlock < fromBlock) return null;

  const items: ActivityItem[] = [];
  for (const storedItem of stored.items) {
    const item = deserialiseItem(storedItem);
    // One unreadable row invalidates the entry. Skipping it would leave the coverage line
    // claiming a range whose contents are no longer all present.
    if (!item) return null;
    items.push(item);
  }

  return { items, fromBlock, toBlock, complete: fromBlock === deployedAt };
}

// ── the resume decision ──────────────────────────────────────────────────────

export interface ResumePlan {
  /** The first block the fresh scan must read. */
  fromBlock: bigint;
  /** The stored window this plan intends to merge with, or null for a cold scan. */
  reuse: ActivityWindow | null;
}

/**
 * Where to start reading, given what is already stored.
 *
 * `coldFloor` is what a scan with no cache would use: the deployment block, or the horizon
 * cap when the chain has outgrown it. The stored range is only worth resuming from when
 * doing so covers strictly more history than starting cold would, AND leaves no hole.
 */
export function planResume({
  cached,
  coldFloor,
  head,
}: {
  cached: ActivityWindow | null;
  coldFloor: bigint;
  head: bigint;
}): ResumePlan {
  if (!cached) return { fromBlock: coldFloor, reuse: null };

  // A stored range that does not reach as far back as a cold scan would is not worth
  // keeping: reading from `coldFloor` covers it and more, for the same number of windows.
  // This is also what retires a cache after a long absence, when the horizon cap has moved
  // past everything that was stored.
  if (cached.fromBlock > coldFloor) return { fromBlock: coldFloor, reuse: null };

  // A stored range ending past the node's own head is describing a different chain than
  // the one answering now — a rolled-back testnet, or an entry copied between profiles.
  if (cached.toBlock > head) return { fromBlock: coldFloor, reuse: null };

  /**
   * Resume at the reorg depth behind the stored end, but never before the cold floor.
   *
   * The clamp is not cosmetic. Without it a cache stored a few blocks after deployment
   * would resume from below the deployment block, the merged range would start there, and
   * `complete` — which is exactly `fromBlock === deployedAt` — would flip to false. The
   * screen would then downgrade a complete history to "the most recent stretch" because
   * the scan was too thorough, which is a worse lie than the one it is guarding against.
   */
  const rewind = cached.toBlock > REORG_DEPTH ? cached.toBlock - REORG_DEPTH + 1n : 0n;
  const fromBlock = rewind > coldFloor ? rewind : coldFloor;

  return { fromBlock, reuse: cached };
}

// ── the merge ────────────────────────────────────────────────────────────────

/**
 * Combine a stored window with a fresh one.
 *
 * The result's `fromBlock`/`toBlock` describe blocks that were REALLY read — by the stored
 * scan, by this one, or by both. When the two ranges do not touch, the stored one is
 * dropped entirely and the fresh window is returned unchanged, because there is no honest
 * single range that covers both.
 */
export function mergeActivity(
  cached: ActivityWindow | null,
  fresh: ActivityWindow,
  deployedAt: bigint,
  maxRows: number = CACHE_MAX_ROWS,
): ActivityWindow {
  if (!cached) return fresh;

  // Contiguity: the fresh scan must begin at or before the block after the stored range
  // ends, or there is a gap and the combined claim would be false.
  if (fresh.fromBlock > cached.toBlock + 1n) return fresh;

  /**
   * Anything the fresh scan's range covers is taken from the fresh scan alone.
   *
   * This is what makes the reorg re-read mean something: a stored row inside the re-read
   * span that the node no longer reports is dropped rather than resurrected, and a row the
   * node still reports arrives again from the scan. It also makes de-duplication automatic
   * rather than a separate pass over `id`s that could disagree with itself.
   */
  const kept = cached.items.filter(
    (item) => item.blockNumber !== undefined && item.blockNumber < fresh.fromBlock,
  );

  const items = [...fresh.items, ...kept];
  items.sort((a, b) => {
    const left = a.blockNumber ?? 0n;
    const right = b.blockNumber ?? 0n;
    if (left !== right) return right > left ? 1 : -1;
    return b.at - a.at;
  });

  const fromBlock = cached.fromBlock < fresh.fromBlock ? cached.fromBlock : fresh.fromBlock;
  const toBlock = cached.toBlock > fresh.toBlock ? cached.toBlock : fresh.toBlock;

  return {
    items: items.slice(0, maxRows),
    fromBlock,
    toBlock,
    complete: fromBlock === deployedAt,
  };
}

// ── storage ──────────────────────────────────────────────────────────────────

export function loadActivityCache(
  identity: ActivityCacheIdentity,
  deployedAt: bigint,
): ActivityWindow | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(activityCacheKey(identity));
    if (!raw) return null;
    return deserialiseWindow(JSON.parse(raw), deployedAt);
  } catch {
    return null;
  }
}

export function saveActivityCache(identity: ActivityCacheIdentity, activity: ActivityWindow): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      activityCacheKey(identity),
      JSON.stringify(serialiseWindow(activity)),
    );
  } catch {
    // A full or disabled localStorage costs a cold scan and nothing else. It must never
    // cost the user their history, so it is not surfaced and not retried.
  }
}
