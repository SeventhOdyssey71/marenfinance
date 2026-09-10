import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { Activity } from '../generated/schema';
import {
  Deposited,
  Withdrawn,
  Borrowed,
  Repaid,
} from '../generated/MarenVault/MarenVault';
import {
  Paid,
  PaidToHandle,
  RequestCreated,
  LinkCreated,
  LinkClaimed,
} from '../generated/MarenPay/MarenPay';
import { Deposit, Withdraw } from '../generated/MarenEarn/MarenEarn';

/**
 * Write one Activity row for one participant.
 *
 * The id carries the account as well as the tx and log index, because a two-sided event
 * writes a row per side and they must not collide. Two rows sharing a txHash and logIndex
 * but differing in `account` is the intended shape, not a duplicate.
 *
 * `timestamp` is taken from the block and stored on the row. That denormalisation is the
 * point of this subgraph as much as the removal of paging: the client used to spend an
 * eth_getBlockByNumber per distinct block, about 445ms each on matsnet, purely to date its
 * own history.
 */
function record(
  event: ethereum.Event,
  account: Address,
  counterparty: Address | null,
  kind: string,
  amount: BigInt,
  memo: string | null,
  refId: BigInt | null,
  outgoing: boolean,
): void {
  const id = event.transaction.hash
    .concatI32(event.logIndex.toI32())
    .concat(Bytes.fromHexString(account.toHexString()));

  const row = new Activity(id);
  row.account = account;
  row.counterparty = counterparty === null ? null : Bytes.fromHexString(counterparty.toHexString());
  row.kind = kind;
  row.amount = amount;
  row.memo = memo;
  row.refId = refId;
  row.outgoing = outgoing;
  row.blockNumber = event.block.number;
  row.timestamp = event.block.timestamp;
  row.txHash = event.transaction.hash;
  row.logIndex = event.logIndex;
  row.save();
}

// --- MarenVault: one-sided, the account is the only participant ---------------

export function handleDeposited(e: Deposited): void {
  record(e, e.params.user, null, 'Deposited', e.params.amount, null, null, true);
}
export function handleWithdrawn(e: Withdrawn): void {
  record(e, e.params.user, null, 'Withdrawn', e.params.amount, null, null, false);
}
export function handleBorrowed(e: Borrowed): void {
  record(e, e.params.user, null, 'Borrowed', e.params.amount, null, null, false);
}
export function handleRepaid(e: Repaid): void {
  record(e, e.params.user, null, 'Repaid', e.params.amount, null, null, true);
}

// --- MarenPay: two-sided, so a row each ---------------------------------------

export function handlePaid(e: Paid): void {
  record(e, e.params.from, e.params.to, 'Paid', e.params.amount, e.params.memo, null, true);
  record(e, e.params.to, e.params.from, 'Paid', e.params.amount, e.params.memo, null, false);
}

export function handlePaidToHandle(e: PaidToHandle): void {
  // The text field here is `handle`, not `memo` — this event records WHICH @handle was paid,
  // which is the more useful thing to show anyway: "paid @sele" beats an empty memo line.
  record(e, e.params.from, e.params.to, 'PaidToHandle', e.params.amount, e.params.handle, null, true);
  record(e, e.params.to, e.params.from, 'PaidToHandle', e.params.amount, e.params.handle, null, false);
}

export function handleRequestCreated(e: RequestCreated): void {
  // The requester is asking the payer for money: outgoing is false for the requester,
  // because nothing has left either account yet and the requester expects to RECEIVE.
  record(e, e.params.requester, e.params.payer, 'RequestCreated', e.params.amount,
    e.params.memo, e.params.requestId, false);
  record(e, e.params.payer, e.params.requester, 'RequestCreated', e.params.amount,
    e.params.memo, e.params.requestId, true);
}

export function handleLinkCreated(e: LinkCreated): void {
  // Only the creator has a row. A link has no recipient until it is claimed, and inventing
  // one here would put a stranger's row in a history before they had anything to do with it.
  record(e, e.params.creator, null, 'LinkCreated', e.params.amount, null, e.params.linkId, true);
}

export function handleLinkClaimed(e: LinkClaimed): void {
  record(e, e.params.recipient, null, 'LinkClaimed', e.params.amount, null, e.params.linkId, false);
}

// --- MarenEarn: ERC-4626, owner is the participant ----------------------------

export function handleEarnDeposit(e: Deposit): void {
  record(e, e.params.owner, null, 'Deposit', e.params.assets, null, null, true);
}
export function handleEarnWithdraw(e: Withdraw): void {
  record(e, e.params.owner, null, 'Withdraw', e.params.assets, null, null, false);
}
