import { describe, expect, it } from 'vitest';

import type { ActivityItem } from '../data/types';
import type { ActivityWindow } from './logs';
import {
  ACTIVITY_CACHE_VERSION,
  CACHE_MAX_ROWS,
  REORG_DEPTH,
  activityCacheKey,
  contractsFingerprint,
  deserialiseWindow,
  mergeActivity,
  planResume,
  serialiseWindow,
} from './activity-cache';

/**
 * These tests are about ONE claim.
 *
 * The Activity screen prints "Read every block from X to Y" and, when the list is empty,
 * says that is the whole story rather than a recent slice. The cache makes X come from a
 * previous visit, so every test here asks the same question in a different shape: is the
 * range the merge produces a range that was actually read? A cache that returns the right
 * rows while overstating its coverage would be a worse bug than no cache, because the
 * sentence is what a reviewer checks against the explorer.
 */

const DEPLOYED_AT = 14_911_471n;

function row(blockNumber: bigint | undefined, id = `row-${blockNumber}`): ActivityItem {
  return {
    id,
    kind: 'deposit',
    status: 'confirmed',
    at: Number(blockNumber ?? 0n),
    btcWei: 1_000n,
    blockNumber,
    sponsored: false,
    gasPaidWei: 42n,
    network: 'testnet',
  };
}

function window(from: bigint, to: bigint, items: ActivityItem[] = []): ActivityWindow {
  return { items, fromBlock: from, toBlock: to, complete: from === DEPLOYED_AT };
}

describe('planResume', () => {
  it('scans cold when nothing is stored', () => {
    const plan = planResume({ cached: null, coldFloor: DEPLOYED_AT, head: 15_000_000n });
    expect(plan).toEqual({ fromBlock: DEPLOYED_AT, reuse: null });
  });

  it('resumes a reorg depth behind the stored end', () => {
    const cached = window(DEPLOYED_AT, 14_999_000n);
    const plan = planResume({ cached, coldFloor: DEPLOYED_AT, head: 15_000_000n });
    expect(plan.fromBlock).toBe(14_999_000n - REORG_DEPTH + 1n);
    expect(plan.reuse).toBe(cached);
  });

  it('never resumes before the cold floor, so a complete history stays complete', () => {
    // A cache stored a handful of blocks after deployment: rewinding 100 would start the
    // scan below the deployment block and drag the merged `fromBlock` with it, which would
    // turn `complete` false on a history that is complete.
    const cached = window(DEPLOYED_AT, DEPLOYED_AT + 10n);
    const plan = planResume({ cached, coldFloor: DEPLOYED_AT, head: DEPLOYED_AT + 20n });
    expect(plan.fromBlock).toBe(DEPLOYED_AT);
    expect(plan.reuse).toBe(cached);
  });

  it('discards a stored range that starts later than a cold scan would', () => {
    // This is the long-absence case: the horizon cap has moved past everything stored, so
    // reading from the cold floor covers strictly more for the same number of windows.
    const cached = window(14_950_000n, 14_960_000n);
    const plan = planResume({ cached, coldFloor: 14_940_000n, head: 15_000_000n });
    expect(plan).toEqual({ fromBlock: 14_940_000n, reuse: null });
  });

  it('discards a stored range that ends past the node’s head', () => {
    const cached = window(DEPLOYED_AT, 15_000_001n);
    const plan = planResume({ cached, coldFloor: DEPLOYED_AT, head: 15_000_000n });
    expect(plan).toEqual({ fromBlock: DEPLOYED_AT, reuse: null });
  });
});

describe('mergeActivity', () => {
  it('returns the fresh window untouched when nothing was stored', () => {
    const fresh = window(DEPLOYED_AT, 15_000_000n, [row(14_999_999n)]);
    expect(mergeActivity(null, fresh, DEPLOYED_AT)).toBe(fresh);
  });

  it('reports the union of two touching ranges', () => {
    const cached = window(DEPLOYED_AT, 14_999_000n, [row(14_998_000n)]);
    const fresh = window(14_998_901n, 15_000_000n, [row(14_999_500n)]);
    const merged = mergeActivity(cached, fresh, DEPLOYED_AT);

    expect(merged.fromBlock).toBe(DEPLOYED_AT);
    expect(merged.toBlock).toBe(15_000_000n);
    expect(merged.complete).toBe(true);
    expect(merged.items.map((i) => i.blockNumber)).toEqual([14_999_500n, 14_998_000n]);
  });

  it('refuses to join ranges with a hole between them', () => {
    // Nothing read blocks 14_999_001 to 14_999_499, so no single "from X to Y" is true.
    const cached = window(DEPLOYED_AT, 14_999_000n, [row(14_998_000n)]);
    const fresh = window(14_999_500n, 15_000_000n, [row(14_999_800n)]);
    const merged = mergeActivity(cached, fresh, DEPLOYED_AT);

    expect(merged).toBe(fresh);
    expect(merged.fromBlock).toBe(14_999_500n);
    expect(merged.complete).toBe(false);
  });

  it('joins ranges that abut exactly', () => {
    const cached = window(DEPLOYED_AT, 14_999_000n);
    const fresh = window(14_999_001n, 15_000_000n);
    expect(mergeActivity(cached, fresh, DEPLOYED_AT).fromBlock).toBe(DEPLOYED_AT);
  });

  it('drops stored rows the fresh scan re-read, so a reorged row disappears', () => {
    const reorgedAway = row(14_999_950n, 'gone');
    const survivor = row(14_990_000n, 'kept');
    const cached = window(DEPLOYED_AT, 15_000_000n, [reorgedAway, survivor]);
    // The rescan covers 14_999_901 upward and comes back without the reorged row.
    const fresh = window(14_999_901n, 15_000_050n, []);

    const merged = mergeActivity(cached, fresh, DEPLOYED_AT);
    expect(merged.items.map((i) => i.id)).toEqual(['kept']);
    expect(merged.toBlock).toBe(15_000_050n);
  });

  it('takes the fresh copy of a row inside the rescanned span rather than duplicating it', () => {
    const cached = window(DEPLOYED_AT, 15_000_000n, [row(14_999_950n, 'stale-copy')]);
    const fresh = window(14_999_901n, 15_000_050n, [row(14_999_950n, 'fresh-copy')]);

    const merged = mergeActivity(cached, fresh, DEPLOYED_AT);
    expect(merged.items.map((i) => i.id)).toEqual(['fresh-copy']);
  });

  it('drops stored rows that carry no block number, since they cannot be placed', () => {
    const cached = window(DEPLOYED_AT, 14_999_000n, [row(undefined, 'placeless')]);
    const fresh = window(14_998_901n, 15_000_000n, []);
    expect(mergeActivity(cached, fresh, DEPLOYED_AT).items).toEqual([]);
  });

  it('keeps a stored range that is behind the head as the toBlock when it is later', () => {
    // Defensive: a fresh scan can only end at the head it read, but the merge must not
    // silently shrink a range it was handed.
    const cached = window(DEPLOYED_AT, 15_000_100n);
    const fresh = window(15_000_001n, 15_000_050n);
    expect(mergeActivity(cached, fresh, DEPLOYED_AT).toBlock).toBe(15_000_100n);
  });

  it('sorts newest first across both sources and caps the row count', () => {
    const cachedRows = Array.from({ length: 150 }, (_, i) => row(14_900_000n + BigInt(i)));
    const freshRows = Array.from({ length: 150 }, (_, i) => row(14_999_901n + BigInt(i)));
    const merged = mergeActivity(
      window(DEPLOYED_AT, 14_999_950n, cachedRows),
      window(14_999_851n, 15_000_100n, freshRows),
      DEPLOYED_AT,
    );

    expect(merged.items).toHaveLength(CACHE_MAX_ROWS);
    for (let i = 1; i < merged.items.length; i += 1) {
      const previous = merged.items[i - 1]!.blockNumber!;
      const current = merged.items[i]!.blockNumber!;
      expect(previous >= current).toBe(true);
    }
  });

  it('marks the merged window incomplete when it does not reach the deployment block', () => {
    const cached = window(14_940_000n, 14_999_000n);
    const fresh = window(14_998_901n, 15_000_000n);
    expect(mergeActivity(cached, fresh, DEPLOYED_AT).complete).toBe(false);
  });
});

describe('the cache key', () => {
  const identity = {
    chainId: 31611,
    account: '0x457e46E52bE1b4A05e3f49d07e58d845ec15CE31' as const,
    network: 'testnet' as const,
  };

  it('carries the version, the chain and the account', () => {
    const key = activityCacheKey(identity);
    expect(key).toContain(`v${ACTIVITY_CACHE_VERSION}`);
    expect(key).toContain('31611');
    expect(key).toContain(identity.account.toLowerCase());
  });

  it('does not depend on the case the account was written in', () => {
    const lower = activityCacheKey({
      ...identity,
      account: identity.account.toLowerCase() as typeof identity.account,
    });
    expect(activityCacheKey(identity)).toBe(lower);
  });

  it('separates the two networks even at the same account', () => {
    expect(activityCacheKey(identity)).not.toBe(
      activityCacheKey({ ...identity, chainId: 31612, network: 'mainnet' }),
    );
  });

  it('changes when a contract address changes, so a redeploy invalidates', () => {
    const before = contractsFingerprint(['0xaaa', '0xbbb', '0xccc']);
    const after = contractsFingerprint(['0xaaa', '0xbbb', '0xddd']);
    expect(before).not.toBe(after);
  });

  it('ignores the case addresses are written in', () => {
    expect(contractsFingerprint(['0xAbC'])).toBe(contractsFingerprint(['0xabc']));
  });
});

describe('serialisation', () => {
  it('survives a round trip with every bigint intact', () => {
    const original = window(DEPLOYED_AT, 15_000_000n, [
      {
        ...row(14_999_000n),
        musdWei: 1_234_567_890_123_456_789n,
        btcWei: undefined,
        counterparty: '@sele',
        counterpartyAddress: '0x457e46E52bE1b4A05e3f49d07e58d845ec15CE31',
        memo: 'rent',
        hash: '0xabc',
      },
    ]);

    const restored = deserialiseWindow(
      JSON.parse(JSON.stringify(serialiseWindow(original))),
      DEPLOYED_AT,
    );
    expect(restored).not.toBeNull();
    expect(restored!.fromBlock).toBe(DEPLOYED_AT);
    expect(restored!.toBlock).toBe(15_000_000n);
    expect(restored!.complete).toBe(true);
    expect(restored!.items[0]!.musdWei).toBe(1_234_567_890_123_456_789n);
    expect(restored!.items[0]!.btcWei).toBeUndefined();
    expect(restored!.items[0]!.blockNumber).toBe(14_999_000n);
    expect(restored!.items[0]!.gasPaidWei).toBe(42n);
  });

  it('recomputes `complete` from the deployment block rather than trusting the store', () => {
    // A stored `complete: true` from a different deployment must not be able to make this
    // window claim a completeness it does not have.
    const stored = { fromBlock: '14940000', toBlock: '15000000', items: [] };
    expect(deserialiseWindow(stored, DEPLOYED_AT)!.complete).toBe(false);
  });

  it('rejects a truncated or corrupt entry instead of returning part of it', () => {
    expect(deserialiseWindow(null, DEPLOYED_AT)).toBeNull();
    expect(deserialiseWindow({ fromBlock: '1' }, DEPLOYED_AT)).toBeNull();
    expect(deserialiseWindow({ fromBlock: 'x', toBlock: '2', items: [] }, DEPLOYED_AT)).toBeNull();
    expect(deserialiseWindow({ fromBlock: '5', toBlock: '2', items: [] }, DEPLOYED_AT)).toBeNull();
  });

  it('rejects the whole entry when one row is unreadable', () => {
    // Skipping the bad row would leave the coverage line claiming a range whose contents
    // are no longer all present.
    const stored = {
      fromBlock: DEPLOYED_AT.toString(),
      toBlock: '15000000',
      items: [{ id: 'a', kind: 'deposit', at: 1, gasPaidWei: 'not-a-number' }],
    };
    expect(deserialiseWindow(stored, DEPLOYED_AT)).toBeNull();
  });

  it('stores no more rows than the cache is allowed to keep', () => {
    const many = Array.from({ length: CACHE_MAX_ROWS + 50 }, (_, i) => row(BigInt(i)));
    expect(serialiseWindow(window(DEPLOYED_AT, 15_000_000n, many)).items).toHaveLength(
      CACHE_MAX_ROWS,
    );
  });
});
