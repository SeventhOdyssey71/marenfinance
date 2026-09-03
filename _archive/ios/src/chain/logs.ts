import {
  MAREN_EARN_EVENTS,
  MAREN_PAY_EVENTS,
  MAREN_VAULT_EVENTS,
  MEZO_MAX_LOG_RANGE,
  getDeploymentBlock,
  getMarenAddresses,
  type MezoNetwork,
} from '@maren/sdk';
import type { Address, Hash, Log, PublicClient } from 'viem';

import type { ActivityItem, ActivityKind, ActivityWindow } from '../data/types';

/**
 * Activity, read from the chain's own logs.
 *
 * EVERY FIELD ON EVERY ROW BELOW IS DECODED FROM A LOG THE NODE RETURNED. Nothing is
 * defaulted into existence, and when something cannot be read it is reported as unknown
 * rather than filled in. The rule matters because Activity renders explorer links: a
 * reviewer who taps one and finds no such transaction is entitled to disbelieve every
 * other number in the app.
 *
 * WHY IT WALKS BACKWARDS IN WINDOWS. Mezo's public RPC refuses any `eth_getLogs`
 * spanning more than 10,000 blocks (`MEZO_MAX_LOG_RANGE`, measured, see the SDK). At
 * roughly 4.7s blocks that is about thirteen hours per request, so "read all history" is
 * not one call. This reader scans a bounded span back from the head and SAYS SO when
 * that span does not reach the deployment block.
 *
 * WHY THE DEPLOYMENT BLOCK MATTERS MORE THAN THE SPAN. If the scan reaches
 * `getDeploymentBlock()`, no Maren event can exist earlier, and an empty result means
 * "you have done nothing yet", which is a fact. If it does not reach it, an empty result
 * only means "nothing in the last few days", which is a much weaker claim the UI must not
 * round up. `ActivityWindow.complete` is that distinction.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, AND WHY. The web reader resumes from a stored
 * window held in `localStorage`, so a repeat visit re-reads only the tail. There is no
 * equivalent here, and adding one was rejected rather than deferred: that cache is only
 * safe because its key pins the chain id, the account and a fingerprint of the contract
 * addresses, and every one of its rules exists to keep the coverage sentence true. A
 * hastily ported version storing bigints through `AsyncStorage` is a way to make the
 * sentence false, and the whole span is four requests today. The scan runs cold each
 * time; when that stops being cheap the answer is an indexer, not a rushed cache.
 */

/**
 * How far back a single load will scan, in 10,000-block windows.
 *
 * Six windows is 60,000 blocks, roughly 3.3 days on matsnet, for at most 18 requests.
 * Today the contracts are younger than one window, so a full history costs three calls
 * and `complete` is true. The cap is what stops that silently becoming a two-minute
 * screen six months from now. Identical to the web's, so the two apps cannot disagree
 * about how much history they claim to have looked at.
 */
const MAX_WINDOWS = 6n;

/** Rows rendered, newest first. Beyond this we stop reading receipts, not just drawing. */
const MAX_ROWS = 50;

type DecodedLog = Log & { eventName?: string; args?: Record<string, unknown> };

/**
 * Read this account's activity.
 *
 * Throws on transport failure rather than returning an empty list. An empty list is a
 * claim about the chain, and it must never be produced by a request that failed. That is
 * exactly how a UI ends up telling somebody their transactions are gone.
 */
export async function readActivityWindow(
  client: PublicClient,
  network: MezoNetwork,
  account: Address,
  /**
   * The endpoints to ask for receipts, in preference order.
   *
   * Separate from `client` because a receipt that comes back EMPTY is not a transport
   * failure and so is never failed over by `fallback()`. See `readReceipts` below and the
   * note on `getEndpointClients` in `./transport`. Defaults to the scan's own client, so
   * a caller that does not care keeps the previous single-endpoint behaviour.
   */
  receiptClients: PublicClient[] = [client],
): Promise<ActivityWindow> {
  const deployedAt = getDeploymentBlock(network);
  if (deployedAt === null) {
    throw new Error(`Maren is not deployed on Mezo ${network}, so there are no logs to read.`);
  }

  const maren = getMarenAddresses(network);
  const head = await client.getBlockNumber();

  const horizon = MAX_WINDOWS * MEZO_MAX_LOG_RANGE;
  const floor = head > horizon && head - horizon > deployedAt ? head - horizon : deployedAt;

  const raw: DecodedLog[] = [];

  for (const window of splitRange(floor, head)) {
    /**
     * Three requests per window, one per contract, with the event set as an OR of topic0.
     *
     * Filtering by the user happens below, on the device, because the account sits at a
     * different topic index in almost every one of these events: topic 1 for a vault
     * action, topic 2 for a payment received, topic 3 for an Earn withdrawal. A
     * server-side filter would therefore need one request per EVENT rather than one per
     * contract, which is more round trips on a mobile link, not fewer.
     */
    const [vault, pay, earn] = await Promise.all([
      client.getLogs({
        address: maren.marenVault,
        events: MAREN_VAULT_EVENTS,
        fromBlock: window.from,
        toBlock: window.to,
      }),
      client.getLogs({
        address: maren.marenPay,
        events: MAREN_PAY_EVENTS,
        fromBlock: window.from,
        toBlock: window.to,
      }),
      client.getLogs({
        address: maren.marenEarn,
        events: MAREN_EARN_EVENTS,
        fromBlock: window.from,
        toBlock: window.to,
      }),
    ]);
    raw.push(...(vault as DecodedLog[]), ...(pay as DecodedLog[]), ...(earn as DecodedLog[]));
  }

  const mine = raw.filter((log) => involves(log, account));
  mine.sort(newestFirst);

  const shown = mine.slice(0, MAX_ROWS);
  const [timestamps, receipts] = await Promise.all([
    readTimestamps(client, shown),
    readReceipts(receiptClients, shown, account),
  ]);

  const items: ActivityItem[] = [];
  for (const log of shown) {
    const item = toActivityItem(log, account, network, timestamps, receipts);
    if (item) items.push(item);
  }

  return { items, fromBlock: floor, toBlock: head, complete: floor === deployedAt };
}

// ── decoding ─────────────────────────────────────────────────────────────────
//
// Everything below is pure: logs and maps in, rows out, no client. That is what lets
// `src/data/live.test.ts` prove the mapping against fixture logs without a network.

export function sameAddress(a: unknown, b: Address): boolean {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

/** Is this log about the account on screen? */
export function involves(log: DecodedLog, account: Address): boolean {
  const args = log.args ?? {};
  return (
    sameAddress(args.user, account) ||
    sameAddress(args.from, account) ||
    sameAddress(args.to, account) ||
    sameAddress(args.owner, account) ||
    sameAddress(args.sender, account) ||
    sameAddress(args.receiver, account) ||
    sameAddress(args.recipient, account) ||
    sameAddress(args.requester, account) ||
    sameAddress(args.payer, account) ||
    sameAddress(args.creator, account)
  );
}

/**
 * Newest first, totally ordered.
 *
 * `blockNumber` and `logIndex` are both nullable on a pending log. Nothing pending can
 * reach here, but the comparison has to be total or the list order flickers between
 * renders, so they are coerced once rather than compared as unknowns.
 */
export function newestFirst(a: DecodedLog, b: DecodedLog): number {
  const left = a.blockNumber ?? 0n;
  const right = b.blockNumber ?? 0n;
  if (left !== right) return right > left ? 1 : -1;
  return (b.logIndex ?? 0) - (a.logIndex ?? 0);
}

function big(value: unknown): bigint | undefined {
  return typeof value === 'bigint' ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export interface ReceiptFacts {
  gasPaid: bigint;
  sponsored: boolean;
  success: boolean;
}

/**
 * One log becomes one row, or nothing.
 *
 * Returns `null` for a log this screen has no honest rendering for, rather than inventing
 * a kind for it. A row the app cannot describe is better absent than mislabelled.
 */
export function toActivityItem(
  log: DecodedLog,
  account: Address,
  network: MezoNetwork,
  timestamps: Map<string, number>,
  receipts: Map<string, ReceiptFacts>,
): ActivityItem | null {
  const args = log.args ?? {};
  const hash = log.transactionHash as Hash | null;
  const blockNumber = log.blockNumber;
  if (!hash || blockNumber === null || blockNumber === undefined) return null;

  const at = timestamps.get(blockNumber.toString());
  const receipt = receipts.get(hash.toLowerCase());

  let kind: ActivityKind;
  let musdWei: bigint | undefined;
  let btcWei: bigint | undefined;
  let counterparty: string | undefined;
  let counterpartyAddress: Address | undefined;
  const memo = str(args.memo);

  switch (log.eventName) {
    case 'Deposited':
      kind = 'deposit';
      btcWei = big(args.amount);
      break;
    case 'Withdrawn':
      kind = 'withdraw';
      btcWei = big(args.amount);
      break;
    case 'Borrowed':
      kind = 'borrow';
      musdWei = big(args.amount);
      break;
    case 'Repaid':
      kind = 'repay';
      musdWei = big(args.amount);
      break;
    case 'Paid':
    case 'PaidToHandle': {
      const outgoing = sameAddress(args.from, account);
      kind = outgoing ? 'send' : 'receive';
      musdWei = big(args.amount);
      const other = (outgoing ? args.to : args.from) as Address | undefined;
      counterpartyAddress = other;
      /**
       * The handle exists only on `PaidToHandle`, and only as the string the payer
       * actually typed. There is no reverse lookup here on purpose: guessing a handle for
       * an address would put a name on a row the chain never associated with one.
       */
      const handle = str(args.handle);
      counterparty = handle ? `@${handle}` : other;
      break;
    }
    case 'RequestCreated':
      kind = 'request-created';
      musdWei = big(args.amount);
      break;
    case 'LinkCreated':
      kind = 'link-created';
      musdWei = big(args.amount);
      break;
    case 'LinkClaimed':
      kind = 'link-claimed';
      musdWei = big(args.amount);
      break;
    case 'Deposit':
      kind = 'earn-deposit';
      musdWei = big(args.assets);
      break;
    case 'Withdraw':
      kind = 'earn-withdraw';
      musdWei = big(args.assets);
      break;
    default:
      return null;
  }

  return {
    // Unique per LOG, not per transaction: one transaction can emit several of these and
    // a key collision would drop rows from the list silently.
    id: `${hash}-${log.logIndex ?? 0}`,
    kind,
    /**
     * A log only exists in a mined block, and a reverted transaction emits none, so
     * anything decoded here was by construction in a receipt with `status: success`. The
     * receipt is read anyway and this stays derived from it rather than assumed, because
     * "we saw an event" and "the chain says it succeeded" must not drift apart. R15 is
     * the rule and this is the read path's half of it.
     */
    status: receipt ? (receipt.success ? 'confirmed' : 'failed') : 'pending',
    at: at ?? 0,
    musdWei,
    btcWei,
    counterparty,
    counterpartyAddress,
    memo,
    hash,
    blockNumber,
    sponsored: receipt?.sponsored ?? false,
    gasPaidWei: receipt?.gasPaid ?? 0n,
    network,
  };
}

/** The 10,000-block windows a `[from, to]` span has to be asked for as. */
export function splitRange(from: bigint, to: bigint): { from: bigint; to: bigint }[] {
  const windows: { from: bigint; to: bigint }[] = [];
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + MEZO_MAX_LOG_RANGE - 1n;
    windows.push({ from: cursor, to: end > to ? to : end });
    cursor = end + 1n;
  }
  return windows;
}

// ── the reads that turn a log into a row ─────────────────────────────────────

/**
 * WHY THESE TWO READS SWALLOW THEIR OWN FAILURES, AND WHY THAT IS NOT THE SAME AS
 * SWALLOWING AN OUTAGE.
 *
 * Measured on matsnet, 2026-08-19, with the funded test address: `eth_getLogs` against
 * https://rpc.test.mezo.org returned a MarenPay log, and `eth_getTransactionReceipt` for
 * that same transaction hash returned `null` from the same endpoint, while
 * https://mezo-testnet.drpc.org returned the receipt in full, log included. The endpoints
 * disagree, which is precisely the transient inconsistency `chains.ts` warns about at
 * length and instructs every client to expect.
 *
 * Before this, one such receipt threw out of `Promise.all` and the ENTIRE Activity screen
 * fell into its failure state. That is the wrong trade by a wide margin: a row whose
 * receipt could not be read is one row of partial information, and the type already has
 * the honest word for it. `status: 'pending'` is defined as "we have a hash and no
 * receipt yet", which is exactly what happened, and it renders as "Awaiting receipt".
 * Losing a whole confirmed history to it told the user their transactions were gone.
 *
 * The distinction that keeps this safe: a REAL outage cannot reach here. `getLogs` runs
 * first and throws, so "the RPC is down" still surfaces as a failure and never as a list
 * of pending rows. Only per-item gaps are absorbed, and each one degrades exactly the row
 * it belongs to.
 */

/** Block timestamps for the blocks about to be rendered, and only those. */
async function readTimestamps(
  client: PublicClient,
  logs: DecodedLog[],
): Promise<Map<string, number>> {
  const unique = [
    ...new Set(logs.map((log) => log.blockNumber).filter((n): n is bigint => n !== null)),
  ];
  const entries = await Promise.all(
    unique.map(async (blockNumber) => {
      try {
        const block = await client.getBlock({ blockNumber });
        return [blockNumber.toString(), Number(block.timestamp)] as const;
      } catch {
        // An unreadable block leaves the row's `at` at 0, which the screen renders as an
        // unknown time. Guessing one from an assumed block interval would be a fabricated
        // timestamp on a real transaction.
        return null;
      }
    }),
  );
  return new Map(entries.filter((entry): entry is [string, number] => entry !== null));
}

/**
 * Gas actually paid, per transaction.
 *
 * `sponsored` is a fact about the receipt, not a label the app applies to itself: under
 * ERC-2771 sponsorship physically IS `receipt.from !== account`, somebody else's address
 * having paid. Deriving it that way means the row tells the truth in both directions
 * without a copy change: with no relayer deployed every row reads unsponsored, and the
 * day one is running the same expression starts reporting sponsored on its own.
 *
 * `gasPaid` follows from the same fact. A user who did not send the transaction did not
 * pay for it, so a sponsored row is zero rather than the relayer's cost quoted at them.
 */
async function readReceipts(
  clients: PublicClient[],
  logs: DecodedLog[],
  account: Address,
): Promise<Map<string, ReceiptFacts>> {
  const unique = [
    ...new Set(logs.map((log) => log.transactionHash).filter((h): h is Hash => h !== null)),
  ];
  const entries = await Promise.all(
    unique.map(async (hash) => {
      /**
       * ASK EVERY ENDPOINT BEFORE BELIEVING AN EMPTY ANSWER.
       *
       * `{"result": null}` is a successful response, so `fallback()` has nothing to fail
       * over on and viem raises the not-found error only after the transport is satisfied.
       * On matsnet the endpoints genuinely disagree about mined transactions, so one
       * node's "I do not have it" is not the chain's answer. The loop stops at the first
       * endpoint that produces a receipt.
       */
      for (const client of clients) {
        try {
          const receipt = await client.getTransactionReceipt({ hash });
          const sponsored = !sameAddress(receipt.from, account);
          return [
            hash.toLowerCase(),
            {
              gasPaid: sponsored ? 0n : receipt.gasUsed * receipt.effectiveGasPrice,
              sponsored,
              success: receipt.status === 'success',
            },
          ] as const;
        } catch {
          // This endpoint could not answer. Try the next before concluding anything.
        }
      }
      // Nobody had it. No entry, so the row reports 'pending' rather than borrowing a
      // status from a receipt nobody read. See the note above this pair of functions.
      return null;
    }),
  );
  return new Map(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
}
