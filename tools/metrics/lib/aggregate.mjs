/**
 * Pure aggregation and derivation for Maren pilot metrics.
 *
 * NOTHING in this file touches the network. Every function takes decoded logs (or maps
 * derived from live reads) and returns a number, a set size or a ratio. That is the whole
 * point: the arithmetic that decides whether the demand bet is real has to be testable
 * against fixtures without an RPC, so a green test is proof of the derivation and not proof
 * that a testnet happened to be up.
 *
 * A "decoded log" here is the shape viem's `getLogs({ events })` returns, narrowed to what
 * the aggregation reads:
 *   { eventName: string, args: Record<string, bigint|string|...>, blockNumber: bigint,
 *     logIndex: number }
 *
 * Addresses are compared case-folded throughout. An EVM address is the same address in any
 * casing, and a Set that treated `0xAbc` and `0xabc` as two members would double-count the
 * single most load-bearing number in the pilot (distinct funded addresses) and quietly
 * understate the spend ratio.
 */

/** Lower-case an address-shaped value, or return it unchanged if it is not a string. */
export function lower(value) {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

/**
 * Every arg field a Maren event can carry an address in. Used by `firstSeenAll` to decide
 * when an address is appearing for the FIRST time anywhere in Maren, which is what "brand
 * new" means for the growth-loop signal. Kept in one place so a new event with a new
 * address field is added here once rather than missed in one derivation and not another.
 */
export const ADDRESS_FIELDS = [
  'user',
  'from',
  'to',
  'owner',
  'sender',
  'receiver',
  'recipient',
  'requester',
  'payer',
  'creator',
];

/** A log's position in the total order of the chain: block first, then log index. */
function position(log) {
  return { blockNumber: BigInt(log.blockNumber ?? 0n), logIndex: Number(log.logIndex ?? 0) };
}

/** Compare two positions. <0 if a is earlier, >0 if later, 0 if identical. */
export function comparePosition(a, b) {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

/** Distinct case-folded addresses appearing in `field` across `logs`. */
export function distinctByField(logs, field) {
  const set = new Set();
  for (const log of logs) {
    const value = log.args?.[field];
    if (typeof value === 'string') set.add(value.toLowerCase());
  }
  return set;
}

/** Sum a uint arg across logs. Non-bigint values are skipped, never coerced to 0 silently. */
export function sumField(logs, field) {
  let total = 0n;
  for (const log of logs) {
    const value = log.args?.[field];
    if (typeof value === 'bigint') total += value;
  }
  return total;
}

/** Count of logs and the summed `amountField` volume across them. */
export function countAndVolume(logs, amountField = 'amount') {
  return { count: logs.length, volume: sumField(logs, amountField) };
}

/**
 * Funded positions: how many addresses currently hold collateral in the vault.
 *
 * This is a live-read number, not a log number: a deposit followed by a full withdrawal
 * leaves a Deposited log behind but zero collateral, and that address is NOT funded. So the
 * caller reads `collateral(addr)` for every address that ever deposited and passes the
 * resulting map here; this counts the ones that came back greater than zero.
 */
export function countFunded(collateralByAddress) {
  let funded = 0;
  for (const wei of collateralByAddress.values()) {
    if (typeof wei === 'bigint' && wei > 0n) funded += 1;
  }
  return funded;
}

/**
 * Payments summary over the Paid + PaidToHandle logs.
 *
 * `count` and `volume` are the headline. `distinctSenders` / `distinctRecipients` are kept
 * because a payments layer where one address pays itself a hundred times is a different
 * signal from a hundred addresses paying once, and the pilot wants to be able to tell them
 * apart.
 */
export function summarizePayments(payLogs) {
  return {
    count: payLogs.length,
    volume: sumField(payLogs, 'amount'),
    distinctSenders: distinctByField(payLogs, 'from').size,
    distinctRecipients: distinctByField(payLogs, 'to').size,
  };
}

/** Money-link summary: created vs claimed, each with count and MUSD volume. */
export function summarizeLinks(createdLogs, claimedLogs) {
  return {
    created: countAndVolume(createdLogs, 'amount'),
    claimed: countAndVolume(claimedLogs, 'amount'),
  };
}

/**
 * First appearance of every address anywhere in Maren, as a position.
 *
 * "Anywhere" is the whole set of Maren logs across all four contracts, considered in chain
 * order. The earliest position at which an address shows up in ANY address field is its
 * first-seen. This is the backbone of the growth-loop signal below.
 */
export function firstSeenAll(allLogs, fields = ADDRESS_FIELDS) {
  const ordered = [...allLogs].sort((a, b) => comparePosition(position(a), position(b)));
  const first = new Map();
  for (const log of ordered) {
    const pos = position(log);
    for (const field of fields) {
      const value = log.args?.[field];
      if (typeof value === 'string') {
        const addr = value.toLowerCase();
        if (!first.has(addr)) first.set(addr, pos);
      }
    }
  }
  return first;
}

/**
 * The growth-loop signal: money-link claims made by addresses that were BRAND NEW.
 *
 * "Brand new" is defined precisely and honestly: the claim is the FIRST time that recipient
 * address appears in ANY Maren log. It is new to Maren, which is what the referral loop is
 * meant to create; it is NOT a claim about the address being new to the whole chain, which
 * these logs cannot prove. The summary labels it that way so the distinction survives.
 *
 * A recipient whose first Maren footprint is the claim itself is somebody the loop pulled
 * in. A recipient who had already deposited or paid before claiming is an existing user
 * moving money around, which is real but is not growth.
 */
export function newAddressClaims(claimLogs, allLogs) {
  const first = firstSeenAll(allLogs);
  let brandNew = 0;
  for (const claim of claimLogs) {
    const recipient = claim.args?.recipient;
    if (typeof recipient !== 'string') continue;
    const firstPos = first.get(recipient.toLowerCase());
    if (firstPos && comparePosition(firstPos, position(claim)) === 0) brandNew += 1;
  }
  return { totalClaims: claimLogs.length, brandNewClaims: brandNew };
}

/**
 * THE demand test: of the addresses that borrowed, how many then SPENT what they borrowed?
 *
 * Definition, stated so it cannot drift:
 *   - A borrower is any address that appears as `user` on a Borrowed event.
 *   - A borrower "spent" if it appears as `from` on at least one payment (Paid or
 *     PaidToHandle) at a position AT OR AFTER its FIRST Borrowed event. The ordering is
 *     load-bearing: a payment made before the first borrow is not spending borrowed money,
 *     and counting it would flatter the ratio. Same-transaction (equal position) counts,
 *     since a borrow-and-pay batched into one tx is exactly the loop we are hoping to see.
 *   - ratio = borrowedThenSpent / borrowers, or null when nobody has borrowed yet (0/0 is
 *     not 0% adoption, it is "no data", and the two must never be conflated).
 *
 * This is the number the whole pilot exists to move. Everything else is context for it.
 */
export function spendRatio(borrowLogs, payLogs) {
  const firstBorrow = new Map();
  for (const log of borrowLogs) {
    const user = log.args?.user;
    if (typeof user !== 'string') continue;
    const addr = user.toLowerCase();
    const pos = position(log);
    const existing = firstBorrow.get(addr);
    if (!existing || comparePosition(pos, existing) < 0) firstBorrow.set(addr, pos);
  }

  const sendsByAddr = new Map();
  for (const log of payLogs) {
    const sender = log.args?.from;
    if (typeof sender !== 'string') continue;
    const addr = sender.toLowerCase();
    const list = sendsByAddr.get(addr) ?? [];
    list.push(position(log));
    sendsByAddr.set(addr, list);
  }

  let borrowedThenSpent = 0;
  for (const [addr, borrowPos] of firstBorrow) {
    const sends = sendsByAddr.get(addr) ?? [];
    if (sends.some((sendPos) => comparePosition(sendPos, borrowPos) >= 0)) borrowedThenSpent += 1;
  }

  const borrowers = firstBorrow.size;
  return {
    borrowers,
    borrowedThenSpent,
    ratio: borrowers === 0 ? null : borrowedThenSpent / borrowers,
  };
}

/** Distinct handle registrations, counted by node (the namehash), across HandleRegistered. */
export function countHandles(handleLogs) {
  return distinctByField(handleLogs, 'node').size;
}
