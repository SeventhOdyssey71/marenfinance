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

import type { ActivityItem, ActivityKind } from '../data/types';
import { mergeActivity, planResume } from './activity-cache';

/**
 * Activity, read from the chain's own logs.
 *
 * This module replaced a file of invented history. That file rendered fabricated hashes
 * as clickable explorer links under a header reading "Live from Mezo testnet", which is
 * the single most damaging thing a chain app can do: a reviewer clicks one, the explorer
 * says no such transaction, and every other number in the product becomes suspect. So the
 * rule this module is built to enforce is absolute — EVERY field on every row below is
 * decoded from a log the node returned. Nothing is defaulted into existence, and when
 * something cannot be read it is reported as unknown rather than filled in.
 *
 * WHY IT WALKS BACKWARDS IN WINDOWS. Mezo's public RPC refuses any `eth_getLogs` spanning
 * more than 10,000 blocks (`MEZO_MAX_LOG_RANGE`, measured — see the SDK). At ~4.7s blocks
 * that is about thirteen hours per request, so "read all history" is not one call and, as
 * the chain grows, is not a bounded number of calls either. This reader therefore scans a
 * fixed maximum span back from the head and SAYS SO when that span does not reach the
 * deployment block.
 *
 * WHY THE DEPLOYMENT BLOCK MATTERS MORE THAN THE SPAN. If the scan reaches
 * `getDeploymentBlock()`, then no Maren event can possibly exist earlier, and an empty
 * result means "you have done nothing yet" — a fact. If it does not reach it, an empty
 * result only means "nothing in the last few days" — a much weaker claim, and one the UI
 * must not round up. `ActivityWindow.complete` is that distinction, and the Activity
 * screen renders a different empty state for each.
 *
 * WHY IT DOES NOT READ THE SAME BLOCKS TWICE. A block that was mined last week will say
 * the same thing next week, so re-scanning from the deployment block on every visit is
 * work with a known answer. `readActivity` takes the window a previous visit produced and
 * resumes from a reorg depth behind its end; `activity-cache.ts` holds the storage, the
 * invalidation and the merge, and is where the rules that keep the coverage line TRUE are
 * written down. The distinction above survives the cache intact, because the merged
 * `fromBlock` is a block that really was read — by this browser, for this account, against
 * these contract addresses — or the stored window is discarded rather than joined.
 */

/**
 * How far back a single page load will scan, in 10,000-block windows.
 *
 * Six windows is 60,000 blocks — roughly 3.3 days on matsnet — for at most 24 requests.
 * Today the contracts are younger than one window, so a full history costs four calls and
 * `complete` is true. The cap is what stops that silently becoming a two-minute page load
 * six months from now; when it starts biting, the answer is an indexer, not a bigger
 * number here. `apps/web/README.md` records that.
 */
const MAX_WINDOWS = 6n;

/** Rows rendered, newest first. Beyond this we stop reading receipts, not just drawing. */
const MAX_ROWS = 50;

export interface ActivityWindow {
  items: ActivityItem[];
  /** Oldest block actually scanned, inclusive. */
  fromBlock: bigint;
  /** Newest block actually scanned, inclusive. */
  toBlock: bigint;
  /**
   * True when `fromBlock` is the deployment block — i.e. the whole of Maren's history was
   * read and an empty `items` is a complete answer rather than a recent one.
   */
  complete: boolean;
}

/**
 * The events, from `@maren/sdk`.
 *
 * They used to be transcribed here. The iOS app now runs the same scan against the same
 * three contracts, and two copies of a topic layout is how two apps come to disagree
 * about what a user's history is. The SDK holds one copy, with the note about why
 * indexed-ness is stated inline; both readers import it.
 */
const VAULT_EVENTS = MAREN_VAULT_EVENTS;
const PAY_EVENTS = MAREN_PAY_EVENTS;
const EARN_EVENTS = MAREN_EARN_EVENTS;

type DecodedLog = Log & { eventName?: string; args?: Record<string, unknown> };

/**
 * Read this account's activity.
 *
 * Throws on transport failure rather than returning an empty list. An empty list is a
 * claim about the chain — "you have no history" — and it must never be produced by a
 * request that failed, which is exactly how a UI ends up telling someone their
 * transactions are gone.
 */
export async function readActivity(
  client: PublicClient,
  network: MezoNetwork,
  account: Address,
  /**
   * A previously scanned window for this same account and deployment, if one is stored.
   *
   * Passing it makes this a RESUME: the scan starts a reorg depth behind where the stored
   * one ended, and the caller merges the two. Passing `null` — or passing a window that
   * cannot be honestly joined to this one — makes it a cold scan, which is what every call
   * did before the cache existed and what every call still does the first time.
   */
  cached: ActivityWindow | null = null,
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
  const coldFloor = head > horizon && head - horizon > deployedAt ? head - horizon : deployedAt;

  const plan = planResume({ cached, coldFloor, head });
  const floor = plan.fromBlock;

  const windows = splitRange(floor, head);
  const raw: DecodedLog[] = [];

  for (const window of windows) {
    // Four requests per window — one per contract — with the event set as an OR of
    // topic0. Filtering by the user happens below, in this process: the account sits at a
    // different topic index in almost every one of these events (topic1 for a vault
    // action, topic2 for a payment received, topic3 for an Earn withdrawal), so a
    // server-side filter would need a separate request per event rather than per contract.
    const [vault, pay, earn] = await Promise.all([
      client.getLogs({
        address: maren.marenVault,
        events: VAULT_EVENTS,
        fromBlock: window.from,
        toBlock: window.to,
      }),
      client.getLogs({
        address: maren.marenPay,
        events: PAY_EVENTS,
        fromBlock: window.from,
        toBlock: window.to,
      }),
      client.getLogs({
        address: maren.marenEarn,
        events: EARN_EVENTS,
        fromBlock: window.from,
        toBlock: window.to,
      }),
    ]);
    raw.push(...(vault as DecodedLog[]), ...(pay as DecodedLog[]), ...(earn as DecodedLog[]));
  }

  const mine = raw.filter((log) => involves(log, account));

  // Newest first. `blockNumber`/`logIndex` are both nullable on a pending log; nothing
  // pending can reach here, but sorting has to be total or the order flickers between
  // renders, so they are coerced once rather than compared as unknowns.
  mine.sort((a, b) => {
    const block = Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n));
    if (block !== 0) return block;
    return (b.logIndex ?? 0) - (a.logIndex ?? 0);
  });

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

  const fresh: ActivityWindow = {
    items,
    fromBlock: floor,
    toBlock: head,
    complete: floor === deployedAt,
  };

  // The merge decides for itself whether the two ranges can honestly be stated as one; it
  // returns `fresh` untouched when they cannot. `plan.reuse` is passed rather than `cached`
  // so a window the plan already rejected cannot sneak back in here.
  return mergeActivity(plan.reuse, fresh, deployedAt);
}

// ── decoding ─────────────────────────────────────────────────────────────────

function sameAddress(a: unknown, b: Address): boolean {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

/** Is this log about the account on screen? */
function involves(log: DecodedLog, account: Address): boolean {
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

function big(value: unknown): bigint | undefined {
  return typeof value === 'bigint' ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * One log becomes one row, or nothing.
 *
 * Returns `null` for a log this screen has no honest rendering for, rather than inventing
 * a kind for it. A row the app cannot describe is better absent than mislabelled.
 */
function toActivityItem(
  log: DecodedLog,
  account: Address,
  network: MezoNetwork,
  timestamps: Map<string, number>,
  receipts: Map<string, { gasPaid: bigint; sponsored: boolean; success: boolean }>,
): ActivityItem | null {
  const args = log.args ?? {};
  const hash = log.transactionHash as Hash | null;
  const blockNumber = log.blockNumber;
  if (!hash || blockNumber === null) return null;

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
      // The handle only exists on `PaidToHandle`, and only as the string the payer
      // actually typed. There is no reverse lookup here on purpose: guessing a handle for
      // an address would put a name on a row the chain never associated with one.
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
    // Unique per log, not per transaction: one transaction can emit several of these and
    // a key collision would drop rows from the list silently.
    id: `${hash}-${log.logIndex ?? 0}`,
    kind,
    /**
     * A log only exists in a mined block, and a reverted transaction emits none — so
     * anything decoded here was, by construction, in a receipt with `status: success`.
     * The receipt is read anyway and this stays derived from it rather than assumed,
     * because "we saw an event" and "the chain says it succeeded" must not drift apart.
     */
    status: receipt ? (receipt.success ? 'confirmed' : 'failed') : 'pending',
    at: at ?? 0,
    musdWei,
    btcWei,
    counterparty,
    counterpartyAddress,
    memo,
    hash,
    // Carried so a cached row can be told apart from one the next scan will re-read. It is
    // the log's own block, never a guess: `blockNumber === null` was rejected above.
    blockNumber,
    sponsored: receipt?.sponsored ?? false,
    gasPaidWei: receipt?.gasPaid ?? 0n,
    network,
  };
}

// ── chain reads that turn a log into a row ───────────────────────────────────

function splitRange(from: bigint, to: bigint): { from: bigint; to: bigint }[] {
  const windows: { from: bigint; to: bigint }[] = [];
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + MEZO_MAX_LOG_RANGE - 1n;
    windows.push({ from: cursor, to: end > to ? to : end });
    cursor = end + 1n;
  }
  return windows;
}

/**
 * WHY THESE TWO READS ABSORB THEIR OWN PER-ITEM FAILURES.
 *
 * Measured on matsnet, 2026-08-19: `eth_getLogs` against https://rpc.test.mezo.org
 * returned a MarenPay log, and `eth_getTransactionReceipt` for that same transaction
 * returned `null` from the same endpoint, while https://mezo-testnet.drpc.org returned
 * the receipt in full. The endpoints disagree, which is exactly the transient
 * inconsistency `chains.ts` warns about and tells every client to expect.
 *
 * Before this, one such receipt threw out of `Promise.all` and the whole Activity screen
 * fell into its failure state, telling the user their history could not be read when in
 * fact all of it but one row's status had been. `status: 'pending'` is already defined as
 * "we have a hash and no receipt yet", which is precisely the situation, so the gap
 * degrades the ROW and nothing more.
 *
 * A real outage still surfaces as a failure: `getLogs` runs first and throws, so a dead
 * endpoint can never arrive here and be rendered as a list of pending rows.
 */

/** Block timestamps for the blocks we are about to render, and only those. */
async function readTimestamps(
  client: PublicClient,
  logs: DecodedLog[],
): Promise<Map<string, number>> {
  const unique = [...new Set(logs.map((log) => log.blockNumber).filter((n) => n !== null))];
  const entries = await Promise.all(
    unique.map(async (blockNumber) => {
      try {
        const block = await client.getBlock({ blockNumber });
        return [blockNumber.toString(), Number(block.timestamp)] as const;
      } catch {
        // Leaves `at` at 0, an unknown time. Deriving one from an assumed block interval
        // would be a fabricated timestamp on a real transaction.
        return null;
      }
    }),
  );
  return new Map(entries.filter((entry): entry is [string, number] => entry !== null));
}

/**
 * Gas actually paid, per transaction.
 *
 * `sponsored` is not a label the app applies to itself — it is `receipt.from !== account`,
 * which is what sponsorship physically IS under ERC-2771: somebody else's address paid.
 * With no relayer running this is false on every row today, and it becomes true on its
 * own the day one is deployed, without a copy change.
 *
 * That last sentence used to be aspirational rather than true: this function read
 * `receipt.from`, discarded it, and wrote a literal `false`, so nothing would ever have
 * changed on its own. The expression below is now the definition the comment describes.
 */
async function readReceipts(
  clients: PublicClient[],
  logs: DecodedLog[],
  account: Address,
): Promise<Map<string, { gasPaid: bigint; sponsored: boolean; success: boolean }>> {
  const unique = [
    ...new Set(logs.map((log) => log.transactionHash).filter((h): h is Hash => h !== null)),
  ];
  const entries = await Promise.all(
    unique.map(async (hash) => {
      /**
       * ASK EVERY ENDPOINT BEFORE BELIEVING AN EMPTY ANSWER.
       *
       * `{"result": null}` is a successful response, so `fallback()` has nothing to fail
       * over on. On matsnet the endpoints genuinely disagree about mined transactions, so
       * one node's "I do not have it" is not the chain's answer. The loop stops at the
       * first endpoint that produces a receipt.
       */
      for (const client of clients) {
        try {
          const receipt = await client.getTransactionReceipt({ hash });
          /**
           * Derived rather than hard-coded. This used to read `receipt.from` and then
           * throw it away in favour of a literal `false`, so the comment above described
           * a behaviour the code did not have: nothing would have started reporting
           * sponsored on its own. Now it will, because this IS the definition.
           */
          const sponsored = receipt.from.toLowerCase() !== account.toLowerCase();
          return [
            hash.toLowerCase(),
            {
              // A user who did not send the transaction did not pay for it, so a
              // sponsored row shows nothing rather than the relayer's cost quoted at them.
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
