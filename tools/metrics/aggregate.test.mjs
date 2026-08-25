import { describe, expect, it } from 'vitest';

import {
  comparePosition,
  countAndVolume,
  countFunded,
  countHandles,
  distinctByField,
  firstSeenAll,
  newAddressClaims,
  spendRatio,
  sumField,
  summarizeLinks,
  summarizePayments,
} from './lib/aggregate.mjs';

// A tiny fixture builder. Logs here are the shape viem's getLogs({ events }) returns,
// narrowed to what the aggregation reads. Amounts are 18-decimal MUSD wei.
const WAD = 10n ** 18n;
const A = '0xAAaAAA0000000000000000000000000000000001';
const B = '0xBbBBbb0000000000000000000000000000000002';
const C = '0xcCCCCc0000000000000000000000000000000003';
const D = '0xDddDDd0000000000000000000000000000000004';

function log(eventName, args, blockNumber, logIndex = 0) {
  return { eventName, args, blockNumber: BigInt(blockNumber), logIndex };
}

const borrowed = (user, amount, block, idx = 0) =>
  log('Borrowed', { user, amount: BigInt(amount) }, block, idx);
const paid = (from, to, amount, block, idx = 0) =>
  log('Paid', { from, to, amount: BigInt(amount) }, block, idx);
const paidToHandle = (from, to, amount, block, idx = 0) =>
  log('PaidToHandle', { from, to, amount: BigInt(amount) }, block, idx);
const deposited = (user, block, idx = 0) => log('Deposited', { user }, block, idx);
const linkCreated = (creator, amount, block, idx = 0) =>
  log('LinkCreated', { creator, amount: BigInt(amount) }, block, idx);
const linkClaimed = (recipient, amount, block, idx = 0) =>
  log('LinkClaimed', { recipient, amount: BigInt(amount) }, block, idx);
const handle = (node, owner, block, idx = 0) => log('HandleRegistered', { node, owner }, block, idx);

describe('primitives', () => {
  it('distinctByField folds case and skips non-strings', () => {
    const logs = [
      deposited(A.toUpperCase(), 1),
      deposited(A.toLowerCase(), 2),
      deposited(B, 3),
      log('Deposited', { user: 123 }, 4),
    ];
    expect(distinctByField(logs, 'user').size).toBe(2);
  });

  it('sumField adds only bigints', () => {
    const logs = [borrowed(A, 5n * WAD, 1), borrowed(B, 3n * WAD, 2), log('Borrowed', {}, 3)];
    expect(sumField(logs, 'amount')).toBe(8n * WAD);
  });

  it('countAndVolume reports both', () => {
    const logs = [paid(A, B, 1n * WAD, 1), paid(A, C, 2n * WAD, 2)];
    expect(countAndVolume(logs, 'amount')).toEqual({ count: 2, volume: 3n * WAD });
  });

  it('comparePosition orders by block then logIndex', () => {
    expect(comparePosition({ blockNumber: 1n, logIndex: 9 }, { blockNumber: 2n, logIndex: 0 })).toBeLessThan(0);
    expect(comparePosition({ blockNumber: 5n, logIndex: 2 }, { blockNumber: 5n, logIndex: 1 })).toBeGreaterThan(0);
    expect(comparePosition({ blockNumber: 5n, logIndex: 1 }, { blockNumber: 5n, logIndex: 1 })).toBe(0);
  });
});

describe('funded positions', () => {
  it('counts only live collateral > 0, not everyone who ever deposited', () => {
    // A deposited then fully withdrew (0), B and C still hold, D never read (omitted).
    const collateral = new Map([
      [A.toLowerCase(), 0n],
      [B.toLowerCase(), 1n],
      [C.toLowerCase(), 5n * WAD],
    ]);
    expect(countFunded(collateral)).toBe(2);
  });

  it('is zero on an empty map', () => {
    expect(countFunded(new Map())).toBe(0);
  });
});

describe('payments', () => {
  it('summarizes count, volume and distinct parties', () => {
    const logs = [
      paid(A, B, 10n * WAD, 1),
      paidToHandle(A, C, 5n * WAD, 2),
      paid(B, C, 2n * WAD, 3),
    ];
    expect(summarizePayments(logs)).toEqual({
      count: 3,
      volume: 17n * WAD,
      distinctSenders: 2,
      distinctRecipients: 2,
    });
  });
});

describe('money links', () => {
  it('summarizes created vs claimed', () => {
    const created = [linkCreated(A, 4n * WAD, 1), linkCreated(A, 6n * WAD, 2)];
    const claimed = [linkClaimed(B, 4n * WAD, 3)];
    expect(summarizeLinks(created, claimed)).toEqual({
      created: { count: 2, volume: 10n * WAD },
      claimed: { count: 1, volume: 4n * WAD },
    });
  });
});

describe('firstSeenAll', () => {
  it('records the earliest position an address appears at, across events', () => {
    const all = [
      paid(A, B, 1n, 5, 1), // B first seen here as recipient at (5,1)
      deposited(B, 3, 0), // ...but B actually deposited earlier at (3,0)
      borrowed(A, 1n, 2, 0), // A first seen at (2,0)
    ];
    const first = firstSeenAll(all);
    expect(first.get(A.toLowerCase())).toEqual({ blockNumber: 2n, logIndex: 0 });
    expect(first.get(B.toLowerCase())).toEqual({ blockNumber: 3n, logIndex: 0 });
  });
});

describe('newAddressClaims (growth loop)', () => {
  it('counts a claim whose recipient is brand new to Maren', () => {
    const claim = linkClaimed(C, 2n * WAD, 10, 0); // C never appears before this
    const all = [deposited(A, 1), borrowed(A, 5n, 2), paid(A, B, 1n, 3), claim];
    expect(newAddressClaims([claim], all)).toEqual({ totalClaims: 1, brandNewClaims: 1 });
  });

  it('does NOT count a claim by an address that was already active', () => {
    const claim = linkClaimed(B, 2n * WAD, 10, 0);
    const all = [deposited(B, 1), claim]; // B deposited before claiming: existing user
    expect(newAddressClaims([claim], all)).toEqual({ totalClaims: 1, brandNewClaims: 0 });
  });

  it('handles a mix', () => {
    const newClaim = linkClaimed(C, 1n, 10, 0);
    const oldClaim = linkClaimed(A, 1n, 11, 0);
    const all = [deposited(A, 1), newClaim, oldClaim];
    expect(newAddressClaims([newClaim, oldClaim], all)).toEqual({ totalClaims: 2, brandNewClaims: 1 });
  });
});

describe('spendRatio (THE demand test)', () => {
  it('is null when nobody has borrowed (0/0 is not 0%)', () => {
    expect(spendRatio([], [paid(A, B, 1n, 1)]).ratio).toBeNull();
  });

  it('counts a borrower who paid after borrowing', () => {
    const borrows = [borrowed(A, 5n * WAD, 5)];
    const pays = [paid(A, B, 1n * WAD, 6)];
    expect(spendRatio(borrows, pays)).toEqual({ borrowers: 1, borrowedThenSpent: 1, ratio: 1 });
  });

  it('counts a borrow-and-pay in the SAME transaction (equal position)', () => {
    const borrows = [borrowed(A, 5n * WAD, 5, 0)];
    const pays = [paid(A, B, 1n * WAD, 5, 1)]; // same block, later logIndex, still >=
    expect(spendRatio(borrows, pays).borrowedThenSpent).toBe(1);
  });

  it('does NOT count a payment made BEFORE the first borrow', () => {
    const borrows = [borrowed(A, 5n * WAD, 10)];
    const pays = [paid(A, B, 1n * WAD, 3)]; // paid before borrowing: not spending borrowed funds
    expect(spendRatio(borrows, pays)).toEqual({ borrowers: 1, borrowedThenSpent: 0, ratio: 0 });
  });

  it('uses the FIRST borrow as the threshold', () => {
    // A borrows at 10 and again at 20; a pay at 15 is after the first borrow, so it counts.
    const borrows = [borrowed(A, 5n * WAD, 20, 0), borrowed(A, 5n * WAD, 10, 0)];
    const pays = [paid(A, B, 1n * WAD, 15)];
    expect(spendRatio(borrows, pays).borrowedThenSpent).toBe(1);
  });

  it('computes a partial ratio across several borrowers', () => {
    const borrows = [borrowed(A, 5n * WAD, 5), borrowed(B, 5n * WAD, 5), borrowed(C, 5n * WAD, 5)];
    const pays = [paid(A, D, 1n * WAD, 6), paid(B, D, 1n * WAD, 6)]; // C never spent
    const result = spendRatio(borrows, pays);
    expect(result.borrowers).toBe(3);
    expect(result.borrowedThenSpent).toBe(2);
    expect(result.ratio).toBeCloseTo(2 / 3);
  });

  it('folds address case between borrow and payment', () => {
    const borrows = [borrowed(A.toUpperCase(), 5n * WAD, 5)];
    const pays = [paid(A.toLowerCase(), B, 1n * WAD, 6)];
    expect(spendRatio(borrows, pays).borrowedThenSpent).toBe(1);
  });
});

describe('handles', () => {
  it('counts distinct nodes', () => {
    const logs = [
      handle('0xnode1', A, 1),
      handle('0xnode1', A, 2), // same node re-emitted (e.g. transfer flow): still one handle
      handle('0xnode2', B, 3),
    ];
    expect(countHandles(logs)).toBe(2);
  });
});
