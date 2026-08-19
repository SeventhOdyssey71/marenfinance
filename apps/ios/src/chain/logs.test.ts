import { describe, expect, it } from 'vitest';
import { MEZO_MAX_LOG_RANGE } from '@maren/sdk';
import type { Address, Hash } from 'viem';

import { involves, newestFirst, splitRange, toActivityItem, type ReceiptFacts } from './logs';

/**
 * The pure half of the Activity reader: which logs are mine, what each one becomes, and
 * how a block span is broken into requests.
 *
 * These are the parts where a mistake is silent. A transport failure announces itself; a
 * log mapped to the wrong `kind`, or a counterparty read from the wrong side of a
 * payment, renders as a perfectly plausible row that says something untrue about
 * somebody's money. So each case below is one claim the screen makes.
 */

const ME: Address = '0x457e46E52bE1b4A05e3f49d07e58d845ec15CE31';
const OTHER: Address = '0x2C9e7A1f4B8d05E36aC7f19D2b4E80315aF6c7B1';
const HASH = '0x9f2c1a7b4e83d05c6a19f7be204d38915cc7ab420e1f6d93b8a4750c21de6f38' as Hash;

const TIMESTAMPS = new Map([['4281907', 1_760_000_000]]);
const CONFIRMED: ReceiptFacts = { gasPaid: 23_100_000_000_000n, sponsored: false, success: true };
const RECEIPTS = new Map([[HASH.toLowerCase(), CONFIRMED]]);

/** A decoded log, shaped the way viem hands one back from `getLogs` with `events`. */
function log(
  eventName: string,
  args: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    eventName,
    args,
    transactionHash: HASH,
    blockNumber: 4_281_907n,
    logIndex: 0,
    ...overrides,
  } as never;
}

function map(entry: ReturnType<typeof log>) {
  return toActivityItem(entry, ME, 'testnet', TIMESTAMPS, RECEIPTS);
}

describe('involves', () => {
  it('claims a vault action addressed to me', () => {
    expect(involves(log('Deposited', { user: ME, amount: 1n }), ME)).toBe(true);
  });

  it('claims a payment I received, where I am at a different topic index', () => {
    expect(involves(log('Paid', { from: OTHER, to: ME, amount: 1n }), ME)).toBe(true);
  });

  it('claims an Earn withdrawal where I am the owner rather than the receiver', () => {
    expect(involves(log('Withdraw', { sender: OTHER, receiver: OTHER, owner: ME }), ME)).toBe(true);
  });

  it('is case-insensitive about address checksums', () => {
    expect(involves(log('Deposited', { user: ME.toLowerCase() }), ME)).toBe(true);
  });

  it('rejects somebody else’s transaction', () => {
    expect(involves(log('Paid', { from: OTHER, to: OTHER, amount: 1n }), ME)).toBe(false);
  });
});

describe('toActivityItem', () => {
  it('maps a vault deposit to BTC, not to MUSD', () => {
    const item = map(log('Deposited', { user: ME, amount: 5_000_000_000_000_000n }));
    expect(item?.kind).toBe('deposit');
    expect(item?.btcWei).toBe(5_000_000_000_000_000n);
    expect(item?.musdWei).toBeUndefined();
  });

  it('maps a borrow to MUSD, not to BTC', () => {
    const item = map(log('Borrowed', { user: ME, amount: 2_000n * 10n ** 18n }));
    expect(item?.kind).toBe('borrow');
    expect(item?.musdWei).toBe(2_000n * 10n ** 18n);
    expect(item?.btcWei).toBeUndefined();
  });

  /**
   * The direction is derived from which side of the event I am on, because it decides
   * whether the row carries a minus sign. Getting it backwards puts an outgoing sign on
   * money that arrived.
   */
  it('reads a payment I sent as outgoing, with the recipient as counterparty', () => {
    const item = map(log('Paid', { from: ME, to: OTHER, amount: 240n * 10n ** 18n }));
    expect(item?.kind).toBe('send');
    expect(item?.counterpartyAddress).toBe(OTHER);
  });

  it('reads a payment I received as incoming, with the sender as counterparty', () => {
    const item = map(log('Paid', { from: OTHER, to: ME, amount: 240n * 10n ** 18n }));
    expect(item?.kind).toBe('receive');
    expect(item?.counterpartyAddress).toBe(OTHER);
  });

  it('uses the handle the payer actually typed, when there is one', () => {
    const item = map(log('PaidToHandle', { from: ME, to: OTHER, amount: 1n, handle: 'nadia' }));
    expect(item?.counterparty).toBe('@nadia');
  });

  /**
   * No reverse lookup here on purpose. Guessing a handle for an address would put a name
   * on a row the chain never associated with one.
   */
  it('falls back to the raw address rather than guessing a handle', () => {
    const item = map(log('Paid', { from: ME, to: OTHER, amount: 1n }));
    expect(item?.counterparty).toBe(OTHER);
  });

  it('carries the on-chain memo verbatim', () => {
    const item = map(log('Paid', { from: ME, to: OTHER, amount: 1n, memo: 'Rent, October share' }));
    expect(item?.memo).toBe('Rent, October share');
  });

  it('leaves the memo undefined rather than empty when there was none', () => {
    const item = map(log('Paid', { from: ME, to: OTHER, amount: 1n, memo: '' }));
    expect(item?.memo).toBeUndefined();
  });

  it('maps the ERC-4626 events to the Earn kinds and reads assets, not shares', () => {
    const deposit = map(log('Deposit', { owner: ME, assets: 2_450n * 10n ** 18n, shares: 2_400n }));
    expect(deposit?.kind).toBe('earn-deposit');
    expect(deposit?.musdWei).toBe(2_450n * 10n ** 18n);

    const withdraw = map(log('Withdraw', { owner: ME, assets: 500n * 10n ** 18n, shares: 480n }));
    expect(withdraw?.kind).toBe('earn-withdraw');
    expect(withdraw?.musdWei).toBe(500n * 10n ** 18n);
  });

  it('names MarenPay’s request and link events rather than dropping them', () => {
    expect(map(log('RequestCreated', { requester: ME, amount: 1n }))?.kind).toBe('request-created');
    expect(map(log('LinkCreated', { creator: ME, amount: 1n }))?.kind).toBe('link-created');
    expect(map(log('LinkClaimed', { recipient: ME, amount: 1n }))?.kind).toBe('link-claimed');
  });

  /** A row the app cannot describe is better absent than mislabelled. */
  it('drops an event it has no honest rendering for', () => {
    expect(map(log('SomethingNew', { user: ME }))).toBeNull();
  });

  it('drops a log with no transaction hash rather than rendering a dead link', () => {
    expect(map(log('Deposited', { user: ME, amount: 1n }, { transactionHash: null }))).toBeNull();
  });

  /** R15: status comes from the receipt, never from "we saw an event". */
  it('takes status from the receipt', () => {
    const item = map(log('Borrowed', { user: ME, amount: 1n }));
    expect(item?.status).toBe('confirmed');
  });

  it('reports a row whose receipt has not been read as pending, not as confirmed', () => {
    const item = toActivityItem(
      log('Borrowed', { user: ME, amount: 1n }),
      ME,
      'testnet',
      TIMESTAMPS,
      new Map(),
    );
    expect(item?.status).toBe('pending');
    // And it must not claim gas was paid, because nothing was read that could say so.
    expect(item?.gasPaidWei).toBe(0n);
    expect(item?.sponsored).toBe(false);
  });

  it('reports a reverted receipt as failed', () => {
    const item = toActivityItem(
      log('Borrowed', { user: ME, amount: 1n }),
      ME,
      'testnet',
      TIMESTAMPS,
      new Map([[HASH.toLowerCase(), { ...CONFIRMED, success: false }]]),
    );
    expect(item?.status).toBe('failed');
  });

  it('quotes the gas actually paid, from the receipt', () => {
    expect(map(log('Deposited', { user: ME, amount: 1n }))?.gasPaidWei).toBe(23_100_000_000_000n);
  });

  it('shows no gas against a sponsored row, because the user paid none', () => {
    const item = toActivityItem(
      log('Borrowed', { user: ME, amount: 1n }),
      ME,
      'testnet',
      TIMESTAMPS,
      new Map([[HASH.toLowerCase(), { gasPaid: 0n, sponsored: true, success: true }]]),
    );
    expect(item?.sponsored).toBe(true);
    expect(item?.gasPaidWei).toBe(0n);
  });

  /**
   * One transaction can emit several of these. Keying on the hash alone would collide and
   * React would silently drop rows from the list.
   */
  it('gives each log its own id, not one per transaction', () => {
    const first = map(log('Deposited', { user: ME, amount: 1n }, { logIndex: 0 }));
    const second = map(log('Borrowed', { user: ME, amount: 1n }, { logIndex: 1 }));
    expect(first?.id).not.toBe(second?.id);
  });

  it('carries the block number so a row can be told apart from a re-read one', () => {
    expect(map(log('Deposited', { user: ME, amount: 1n }))?.blockNumber).toBe(4_281_907n);
  });

  it('leaves the timestamp at zero rather than guessing when the block was not read', () => {
    const item = toActivityItem(
      log('Deposited', { user: ME, amount: 1n }),
      ME,
      'testnet',
      new Map(),
      RECEIPTS,
    );
    expect(item?.at).toBe(0);
  });
});

describe('newestFirst', () => {
  it('sorts higher blocks first', () => {
    const older = log('Deposited', {}, { blockNumber: 100n });
    const newer = log('Deposited', {}, { blockNumber: 200n });
    expect([older, newer].sort(newestFirst)[0]).toBe(newer);
  });

  it('breaks ties within a block by log index, newest first', () => {
    const first = log('Deposited', {}, { blockNumber: 100n, logIndex: 0 });
    const second = log('Deposited', {}, { blockNumber: 100n, logIndex: 1 });
    expect([first, second].sort(newestFirst)[0]).toBe(second);
  });
});

describe('splitRange', () => {
  /**
   * Mezo's public RPC refuses any span over 10,000 blocks with
   * `maximum [from, to] blocks distance: 10000`. Every window this produces has to be
   * inside that, inclusive of both ends, or the scan fails on a healthy network.
   */
  it('never produces a window wider than the RPC will answer', () => {
    for (const window of splitRange(1n, 45_000n)) {
      expect(window.to - window.from + 1n).toBeLessThanOrEqual(MEZO_MAX_LOG_RANGE);
    }
  });

  it('covers the whole span with no gap and no overlap', () => {
    const windows = splitRange(1_000n, 35_000n);
    expect(windows[0]?.from).toBe(1_000n);
    expect(windows[windows.length - 1]?.to).toBe(35_000n);
    for (let i = 1; i < windows.length; i += 1) {
      expect(windows[i]!.from).toBe(windows[i - 1]!.to + 1n);
    }
  });

  it('asks once for a span that already fits', () => {
    expect(splitRange(1n, 500n)).toEqual([{ from: 1n, to: 500n }]);
  });

  it('asks once for a single block', () => {
    expect(splitRange(42n, 42n)).toEqual([{ from: 42n, to: 42n }]);
  });
});
