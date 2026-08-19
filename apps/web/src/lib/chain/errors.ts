import { formatBtc, formatCollateralRatio, formatMusd } from '@maren/sdk';
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from 'viem';

/**
 * Revert reasons, decoded into something a person can act on.
 *
 * The failure this module exists to prevent is the one that made the app feel fake in the
 * other direction: a user presses Borrow, the chain refuses, and the interface prints
 * `0x9f4a2b1c00000000…`. That is not an error message, it is evidence that nobody
 * looked. Every custom error Maren's contracts can raise is listed below with copy that
 * says what happened and what to do instead.
 *
 * The most important entry is `TroveCollateralRatioTooLow`. Maren's pooled trove is
 * currently around 151% against its own 180% floor, so EVERY borrow reverts on it today.
 * That is a real, correct refusal — the vault is protecting the pool — and it has to read
 * as one rather than as a broken button.
 *
 * NOTE ON A NAME: there is no `BorrowBelowMinCR` in `MarenVault.sol`, though it is the
 * obvious name to reach for. The contract raises two distinct errors at the borrow check,
 * and the distinction matters to the user: `InsufficientCollateralRatio` is about YOUR
 * position and you fix it by depositing; `TroveCollateralRatioTooLow` is about the SHARED
 * trove and you cannot fix it at all. Collapsing them into one message would tell half
 * the users to do something that will not help.
 */

/**
 * Every custom error across Maren's contracts, transcribed from the Solidity.
 *
 * Kept here rather than in `abis.ts` because this is a decoding table, not a call
 * surface — viem only needs the shapes to turn four bytes of selector back into a name,
 * and the write ABIs stay readable as lists of things the app actually invokes.
 */
export const marenErrorsAbi = [
  // --- MarenVault -----------------------------------------------------------
  { type: 'error', name: 'PriceFeedUnavailable', inputs: [] },
  { type: 'error', name: 'DepositsArePaused', inputs: [] },
  { type: 'error', name: 'BorrowingIsPaused', inputs: [] },
  {
    type: 'error',
    name: 'DepositBelowMinimum',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'minimum', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'DepositCapExceeded',
    inputs: [
      { name: 'attempted', type: 'uint256' },
      { name: 'cap', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  {
    type: 'error',
    name: 'InsufficientCollateral',
    inputs: [
      { name: 'requested', type: 'uint256' },
      { name: 'available', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'InsufficientCollateralRatio',
    inputs: [
      { name: 'resultingCr', type: 'uint256' },
      { name: 'requiredCr', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'TroveCollateralRatioTooLow',
    inputs: [
      { name: 'resultingCr', type: 'uint256' },
      { name: 'requiredCr', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'TroveNotOpen', inputs: [] },
  { type: 'error', name: 'TroveAlreadyOpen', inputs: [] },
  {
    type: 'error',
    name: 'SeedDebtBelowProtocolMinimum',
    inputs: [
      { name: 'requested', type: 'uint256' },
      { name: 'minimum', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'PositionHealthy',
    inputs: [
      { name: 'cr', type: 'uint256' },
      { name: 'threshold', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'NothingToLiquidate', inputs: [{ name: 'user', type: 'address' }] },
  { type: 'error', name: 'NoDebt', inputs: [] },
  {
    type: 'error',
    name: 'ReserveTooSmall',
    inputs: [
      { name: 'requested', type: 'uint256' },
      { name: 'available', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'OutstandingUserDebt', inputs: [{ name: 'shares', type: 'uint256' }] },
  {
    type: 'error',
    name: 'CollateralTransferFailed',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'NothingToSkim', inputs: [] },

  // --- MarenRegistry --------------------------------------------------------
  { type: 'error', name: 'HandleTooShort', inputs: [{ name: 'length', type: 'uint256' }] },
  { type: 'error', name: 'HandleTooLong', inputs: [{ name: 'length', type: 'uint256' }] },
  {
    type: 'error',
    name: 'HandleInvalidCharacter',
    inputs: [
      { name: 'index', type: 'uint256' },
      { name: 'character', type: 'bytes1' },
    ],
  },
  { type: 'error', name: 'HandleTaken', inputs: [{ name: 'handle', type: 'string' }] },
  { type: 'error', name: 'HandleNotRegistered', inputs: [{ name: 'handle', type: 'string' }] },
  {
    type: 'error',
    name: 'NotHandleOwner',
    inputs: [
      { name: 'caller', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
  },
  { type: 'error', name: 'CommitmentNotFound', inputs: [{ name: 'commitment', type: 'bytes32' }] },
  {
    type: 'error',
    name: 'CommitmentTooNew',
    inputs: [
      { name: 'committedAt', type: 'uint256' },
      { name: 'revealableAt', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'CommitmentExpired',
    inputs: [
      { name: 'committedAt', type: 'uint256' },
      { name: 'expiredAt', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'CommitmentAlreadyExists',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
  },
  { type: 'error', name: 'ZeroAddress', inputs: [] },

  // --- MarenPay -------------------------------------------------------------
  { type: 'error', name: 'SelfPayment', inputs: [] },
  { type: 'error', name: 'Permit2NotConfigured', inputs: [] },
  {
    type: 'error',
    name: 'InvalidPermitToken',
    inputs: [
      { name: 'provided', type: 'address' },
      { name: 'expected', type: 'address' },
    ],
  },
  {
    type: 'error',
    name: 'RequestNotOpen',
    inputs: [
      { name: 'requestId', type: 'uint256' },
      { name: 'status', type: 'uint8' },
    ],
  },
  {
    type: 'error',
    name: 'NotRequestPayer',
    inputs: [
      { name: 'caller', type: 'address' },
      { name: 'expected', type: 'address' },
    ],
  },
  {
    type: 'error',
    name: 'NotRequester',
    inputs: [
      { name: 'caller', type: 'address' },
      { name: 'expected', type: 'address' },
    ],
  },
  { type: 'error', name: 'LinkAlreadySettled', inputs: [{ name: 'linkId', type: 'uint256' }] },
  {
    type: 'error',
    name: 'LinkExpired',
    inputs: [
      { name: 'linkId', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'LinkNotExpired',
    inputs: [
      { name: 'linkId', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'NotLinkCreator',
    inputs: [
      { name: 'caller', type: 'address' },
      { name: 'expected', type: 'address' },
    ],
  },
  { type: 'error', name: 'InvalidLinkSignature', inputs: [] },
  { type: 'error', name: 'InvalidExpiry', inputs: [{ name: 'expiry', type: 'uint64' }] },
  {
    type: 'error',
    name: 'ArrayLengthMismatch',
    inputs: [
      { name: 'recipients', type: 'uint256' },
      { name: 'amounts', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'TooManyRecipients',
    inputs: [
      { name: 'count', type: 'uint256' },
      { name: 'max', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'EmptySplit', inputs: [] },

  // --- MarenEarn ------------------------------------------------------------
  {
    type: 'error',
    name: 'FeeTooHigh',
    inputs: [
      { name: 'bps', type: 'uint256' },
      { name: 'max', type: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'SwapReturnedTooLittle',
    inputs: [
      { name: 'received', type: 'uint256' },
      { name: 'minimum', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'NoRouterConfigured', inputs: [] },

  // --- MarenRelayHub --------------------------------------------------------
  {
    type: 'error',
    name: 'CallNotAllowed',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'selector', type: 'bytes4' },
    ],
  },
  { type: 'error', name: 'TargetDoesNotTrustHub', inputs: [{ name: 'target', type: 'address' }] },
  { type: 'error', name: 'RelayExpired', inputs: [{ name: 'deadline', type: 'uint48' }] },
  { type: 'error', name: 'ValueNotRelayable', inputs: [] },
  { type: 'error', name: 'BatchExecutionDisabled', inputs: [] },
] as const;

/** A decoded refusal: what happened, and what the user can do about it. */
export interface RevertReason {
  /** Short headline, sentence case. */
  title: string;
  /** One or two sentences. Plain language, no selectors, no hex. */
  detail: string;
  /** The Solidity error name, shown small for anyone who wants to grep the source. */
  name: string | null;
}

/**
 * A failure that already knows how to describe itself.
 *
 * Some refusals never touch the chain and therefore have no revert data to decode: a
 * relayer answering `402 SPONSORSHIP_UNAVAILABLE`, or a fetch that never left the device.
 * Throwing one of these carries the finished copy through the same `throw` that a
 * contract revert travels along, so `explainError` hands it back unchanged and the sheet
 * renders it identically. The alternative — a second error channel beside the one every
 * screen already handles — is how one of the two paths ends up rendering a raw string.
 */
export class ExplainedError extends Error {
  readonly reason: RevertReason;

  constructor(reason: RevertReason) {
    super(reason.detail);
    this.name = 'ExplainedError';
    this.reason = reason;
  }
}

/**
 * A collateral ratio in these messages, rounded the safe way.
 *
 * This was `(Number(wad) / 1e16).toFixed(1)`, which ROUNDS TO NEAREST — so the pooled
 * trove's live 1.510537…e18 was reported to users as "151.1%" while the Portfolio, which
 * goes through the SDK, called the same number "151.0%". Two figures for one ratio is bad;
 * the direction is worse. BRAND.md §8: never round a number up in a way that flatters a
 * position's safety. `formatCollateralRatio` truncates, always, for exactly this reason,
 * and it is now the only thing in the app that turns a ratio into a string.
 */
const percent = (wad: bigint): string => formatCollateralRatio(wad);

/**
 * Copy for each error. Written per-error rather than templated, because "what to do
 * instead" is different every time and a generic "the transaction failed" helps nobody.
 *
 * EXPORTED, and that is the point of this pass.
 *
 * This table used to be reachable only by failing. `lib/chain/preflight.ts` now calls it
 * directly with the arguments the contract WOULD have reverted with, so the sentence a
 * user reads on a disabled Borrow button is the identical sentence they would have read
 * after paying for the revert — same words, same live numbers, one source. Writing a
 * second, softer version of "the pool itself is fully drawn right now" for the disabled
 * state is exactly how the two would drift apart, with the cheap one going stale.
 */
export function describeRevert(name: string, args: readonly unknown[] = []): RevertReason {
  return describe(name, args);
}

function describe(name: string, args: readonly unknown[]): RevertReason {
  const n = (i: number) => (typeof args[i] === 'bigint' ? (args[i] as bigint) : 0n);
  const s = (i: number) => String(args[i] ?? '');

  switch (name) {
    // --- the one that fires today -------------------------------------------
    case 'TroveCollateralRatioTooLow':
      return {
        name,
        title: 'The shared trove is too thin to lend against',
        detail:
          `Borrowing would leave Maren's pooled trove at ${percent(n(0))}, under the ` +
          `${percent(n(1))} floor it has to keep. This is not about your position. The pool ` +
          `itself is fully drawn right now, so no new MUSD can come out of it until someone ` +
          `deposits more Bitcoin or repays. Your collateral is untouched and you can withdraw it.`,
      };
    case 'InsufficientCollateralRatio':
      return {
        name,
        title: 'Not enough collateral behind this loan',
        detail:
          `That borrow would put your position at ${percent(n(0))}, below Maren's ${percent(n(1))} ` +
          `floor. Borrow less, or deposit more Bitcoin first.`,
      };

    // --- vault ---------------------------------------------------------------
    case 'PriceFeedUnavailable':
      return {
        name,
        title: 'Mezo’s price feed is stale',
        detail:
          'The BTC/USD oracle has not reported inside its 60-second tolerance, so the contract ' +
          'refuses anything that depends on a price. Repaying and withdrawing without debt still ' +
          'work. Try again shortly.',
      };
    case 'DepositsArePaused':
      return {
        name,
        title: 'Deposits are paused',
        detail:
          'A guardian has halted new deposits. Repay and withdraw are never pausable, so your ' +
          'existing position can still be exited.',
      };
    case 'BorrowingIsPaused':
      return {
        name,
        title: 'Borrowing is paused',
        detail:
          'A guardian has halted new borrowing. Repay and withdraw stay open. Maren closes ' +
          'entries before exits, never the other way round.',
      };
    case 'DepositBelowMinimum':
      return {
        name,
        title: 'Below the minimum deposit',
        detail: `Maren’s minimum deposit is ${formatBtc(n(1))}; this was ${formatBtc(n(0))}.`,
      };
    case 'DepositCapExceeded':
      return {
        name,
        title: 'Vault deposit cap reached',
        detail:
          `The vault is capped at ${formatBtc(n(1))} of collateral and this deposit would take ` +
          `it to ${formatBtc(n(0))}. The cap rises as the vault is reviewed.`,
      };
    case 'InsufficientCollateral':
      return {
        name,
        title: 'More than your collateral',
        detail: `You asked for ${formatBtc(n(0))} but only ${formatBtc(n(1))} is credited to you.`,
      };
    case 'TroveNotOpen':
      return {
        name,
        title: 'The pooled trove is not open',
        detail:
          'Maren’s shared trove has not been seeded on this network, so there is nothing to ' +
          'borrow against yet. Depositing still works.',
      };
    case 'ZeroAmount':
      return { name, title: 'Amount is zero', detail: 'Enter an amount above zero.' };
    case 'NoDebt':
      return { name, title: 'Nothing to repay', detail: 'This position has no outstanding debt.' };
    case 'ReserveTooSmall':
      return {
        name,
        title: 'Not enough MUSD in the reserve',
        detail:
          `This borrow needs ${formatMusd(n(0))} from Maren’s reserve, which holds ` +
          `${formatMusd(n(1))}. Try a smaller amount.`,
      };

    // --- registry -------------------------------------------------------------
    case 'CommitmentNotFound':
      return {
        name,
        title: 'No commitment for this handle',
        detail:
          'Step one was never confirmed on this network, or the secret in this browser does not ' +
          'match it. Start the registration again.',
      };
    case 'CommitmentTooNew':
      return {
        name,
        title: 'Too early to reveal',
        detail:
          'The commitment has to be at least 60 seconds old before the handle can be claimed. ' +
          'This is what stops someone watching the mempool from taking the name first. Wait for ' +
          'the countdown to finish.',
      };
    case 'CommitmentExpired':
      return {
        name,
        title: 'Commitment expired',
        detail: 'A commitment is only good for 7 days. Start the registration again.',
      };
    case 'CommitmentAlreadyExists':
      return {
        name,
        title: 'Already committed',
        detail:
          'This exact commitment is already on-chain and still live. Go straight to step two ' +
          'rather than committing again.',
      };
    case 'HandleTaken':
      return {
        name,
        title: 'Handle already taken',
        detail: `@${s(0)} belongs to someone else. Pick another.`,
      };
    case 'HandleNotRegistered':
      return {
        name,
        title: 'No such handle',
        detail: `@${s(0)} is not registered on this network. A payment to an unknown handle fails rather than guessing.`,
      };
    case 'HandleTooShort':
      return { name, title: 'Handle too short', detail: 'Handles are 3 to 32 characters.' };
    case 'HandleTooLong':
      return { name, title: 'Handle too long', detail: 'Handles are 3 to 32 characters.' };
    case 'HandleInvalidCharacter':
      return {
        name,
        title: 'Invalid character in handle',
        detail: 'Handles may only contain lowercase letters, digits and underscores.',
      };
    case 'NotHandleOwner':
      return { name, title: 'Not your handle', detail: 'Only the owner can change this handle.' };

    // --- pay -------------------------------------------------------------------
    case 'SelfPayment':
      return { name, title: 'That is your own address', detail: 'Pay someone else.' };
    case 'LinkAlreadySettled':
      return {
        name,
        title: 'Link already settled',
        detail: 'This link has already been claimed or reclaimed.',
      };
    case 'LinkExpired':
      return {
        name,
        title: 'Link expired',
        detail: 'Only the creator can reclaim it now.',
      };
    case 'InvalidLinkSignature':
      return {
        name,
        title: 'Link signature does not match',
        detail: 'The claim secret in this link is not the one the contract is holding.',
      };

    // --- vault, the rarer refusals ------------------------------------------------
    //
    // Everything from here down used to fall through to the default and render as
    // `SomeError(0, 0)`. That is a selector with punctuation, not an explanation, and a
    // user who hits one of these is having an unusual day already. `errors.test.ts`
    // asserts that no error in the table can reach the default any more.
    case 'TroveAlreadyOpen':
      return {
        name,
        title: 'The pooled trove is already open',
        detail: 'Maren’s shared trove only needs seeding once, and it has been. Nothing to do.',
      };
    case 'SeedDebtBelowProtocolMinimum':
      return {
        name,
        title: 'Seed debt below MUSD’s minimum',
        detail: `Opening a trove needs at least ${formatMusd(n(1))} of net debt; this asked for ${formatMusd(n(0))}.`,
      };
    case 'PositionHealthy':
      return {
        name,
        title: 'That position is healthy',
        detail:
          `It sits at ${percent(n(0))}, above the ${percent(n(1))} at which Maren liquidates. ` +
          'There is nothing to liquidate, which is the outcome everyone wants.',
      };
    case 'NothingToLiquidate':
      return {
        name,
        title: 'Nothing to liquidate',
        detail: 'That account holds no collateral and owes nothing in this vault.',
      };
    case 'OutstandingUserDebt':
      return {
        name,
        title: 'Debt is still outstanding',
        detail:
          'This cannot be closed while MUSD is still owed against it. Repay in full first. ' +
          'Repayment is never paused.',
      };
    case 'CollateralTransferFailed':
      return {
        name,
        title: 'The Bitcoin transfer failed',
        detail:
          'The vault could not send collateral to the destination address, so the whole ' +
          'transaction was reverted and your position is untouched. A contract that rejects ' +
          'plain transfers is the usual cause.',
      };
    case 'NothingToSkim':
      return {
        name,
        title: 'Nothing to skim',
        detail: 'The vault holds no surplus beyond what is credited to users.',
      };
    case 'ZeroAddress':
      return {
        name,
        title: 'That address is empty',
        detail: 'A zero address was passed where a real one is required.',
      };

    // --- pay, the rarer refusals ---------------------------------------------------
    case 'Permit2NotConfigured':
      return {
        name,
        title: 'Permit2 is not configured',
        detail:
          'This deployment has no Permit2 address set, so the signature-based payment path is ' +
          'unavailable. An ordinary approval and payment still work.',
      };
    case 'InvalidPermitToken':
      return {
        name,
        title: 'That permit is for the wrong token',
        detail: 'MarenPay only accepts permits for MUSD. Nothing was moved.',
      };
    case 'RequestNotOpen':
      return {
        name,
        title: 'That request is no longer open',
        detail: 'It has already been fulfilled or cancelled, so it cannot be paid again.',
      };
    case 'NotRequestPayer':
      return {
        name,
        title: 'That request is addressed to someone else',
        detail:
          'It names a specific payer, and it is not this account. Ask for an unaddressed ' +
          'request, which anyone may fulfil.',
      };
    case 'NotRequester':
      return {
        name,
        title: 'Not your request',
        detail: 'Only the account that created a request can cancel it.',
      };
    case 'LinkNotExpired':
      return {
        name,
        title: 'Too early to reclaim',
        detail:
          'A link can only be reclaimed after it expires. Until then the escrow belongs to ' +
          'whoever holds the link.',
      };
    case 'NotLinkCreator':
      return {
        name,
        title: 'Not your link',
        detail: 'Only the account that created a link can reclaim it.',
      };
    case 'InvalidExpiry':
      return {
        name,
        title: 'That expiry will not work',
        detail: 'A link has to expire in the future, and within the contract’s maximum window.',
      };
    case 'ArrayLengthMismatch':
      return {
        name,
        title: 'Recipients and amounts do not line up',
        detail: `${n(0)} recipients against ${n(1)} amounts. Every recipient needs exactly one amount.`,
      };
    case 'TooManyRecipients':
      return {
        name,
        title: 'Too many recipients in one split',
        detail: `A split takes at most ${n(1)} recipients; this had ${n(0)}. Send it as more than one.`,
      };
    case 'EmptySplit':
      return {
        name,
        title: 'That split has no recipients',
        detail: 'Add at least one recipient and amount.',
      };

    // --- earn ----------------------------------------------------------------------
    case 'FeeTooHigh':
      return {
        name,
        title: 'That performance fee is too high',
        detail: `The vault caps it at ${Number(n(1)) / 100}%, and this asked for ${Number(n(0)) / 100}%.`,
      };
    case 'SwapReturnedTooLittle':
      return {
        name,
        title: 'The swap came back short',
        detail:
          `It returned ${formatMusd(n(0))} against a ${formatMusd(n(1))} minimum, so the harvest ` +
          'was reverted rather than accepting a bad price. The Bitcoin is still held by the vault.',
      };
    case 'NoRouterConfigured':
      return {
        name,
        title: 'No swap route is configured',
        detail:
          'Earn cannot convert seized Bitcoin into MUSD until a router Maren has reviewed exists ' +
          'on Mezo. The Bitcoin is held, not lost, and shows in the vault’s asset breakdown.',
      };

    // --- relay ------------------------------------------------------------------
    case 'ValueNotRelayable':
      return {
        name,
        title: 'This call cannot be sponsored',
        detail:
          'It carries Bitcoin with it, and Maren’s relay hub refuses any request with value. ' +
          'Deposits are always paid for by the user in BTC gas.',
      };
    case 'CallNotAllowed':
      return {
        name,
        title: 'That call is not on the relay allowlist',
        detail:
          'Maren’s relay hub will only sponsor a fixed set of functions. Anything else has to be ' +
          'submitted by your own wallet.',
      };
    case 'TargetDoesNotTrustHub':
      return {
        name,
        title: 'That contract does not trust the relay hub',
        detail:
          'It is not configured to accept forwarded calls, so a sponsored transaction to it ' +
          'would be attributed to the hub rather than to you.',
      };
    case 'RelayExpired':
      return {
        name,
        title: 'That sponsored request expired',
        detail: 'Its deadline has passed. Build a fresh one and sign again.',
      };
    case 'BatchExecutionDisabled':
      return {
        name,
        title: 'Batched relaying is switched off',
        detail: 'The hub is accepting one request at a time.',
      };

    default:
      return {
        name,
        title: 'The contract refused this',
        detail:
          `${name}${args.length > 0 ? `(${args.map(String).join(', ')})` : ''}. This refusal has ` +
          `no plain-language mapping yet. It is a real on-chain revert, not a network problem.`,
      };
  }
}

/**
 * MUSD's own `require` strings, translated.
 *
 * Mezo's `BorrowerOperations` predates custom errors and refuses with `Error(string)`, so
 * these arrive as English that is accurate and useless in equal measure: it names the rule
 * without saying whose rule it is, whether the user did anything wrong, or what to do. The
 * strings below are transcribed EXACTLY as they appear in the deployed runtime bytecode
 * (matsnet BorrowerOperations impl 0xc05bf344bd5b58825784326dd3112fb6cc160dcc, read
 * 2026-08-19), not from Mezo's documentation and not from Liquity, which words several of
 * them differently.
 *
 * Matched on a substring rather than on equality on purpose. These are protocol strings
 * behind an upgradeable proxy, and a wording tweak in a future MUSD release should degrade
 * this to the raw string, never to a WRONG explanation.
 *
 * `preflight.ts` already stops all three before a signature is requested. This exists for
 * the gap it cannot close: Recovery Mode is a property of the whole protocol and can begin
 * between the render and the press, so the last word has to be legible too.
 */
/**
 * The single entry point for a Solidity `require` string, wherever it was unpacked.
 *
 * There are three of those paths (viem's native decode, our own `decodeRaw`, and viem's
 * `reason` shortcut) and they used to produce three different results for identical bytes.
 * One function so they cannot drift again.
 */
function describeErrorString(message: string): RevertReason {
  return (
    describeMusdRequire(message) ?? {
      name: 'Error(string)',
      title: 'The contract refused this',
      detail: message || 'No reason given.',
    }
  );
}

function describeMusdRequire(message: string): RevertReason | null {
  const has = (needle: string) => message.includes(needle);

  if (has('Collateral withdrawal not permitted Recovery Mode')) {
    return {
      name: 'Error(string)',
      title: 'MUSD entered Recovery Mode',
      detail:
        'MUSD fell under its 150% system-wide collateral ratio, and while it is there Mezo ' +
        'refuses every withdrawal from every trove on the chain, whatever your own ratio is. ' +
        'Nothing moved and nothing was lost. Repaying is still open, and it is one of the two ' +
        'things that lifts the protocol back out.',
    };
  }
  if (has("Cannot decrease your Trove's ICR in Recovery Mode")) {
    return {
      name: 'Error(string)',
      title: 'MUSD entered Recovery Mode',
      detail:
        'MUSD fell under its 150% system-wide collateral ratio. While it is there Mezo refuses ' +
        'anything that would lower a trove’s ratio, and borrowing always does, so no borrow can ' +
        'go through at any size. Nothing moved. Depositing and repaying both still work.',
    };
  }
  if (has('Operation not permitted during Recovery Mode')) {
    return {
      name: 'Error(string)',
      title: 'MUSD entered Recovery Mode',
      detail:
        'MUSD fell under its 150% system-wide collateral ratio, and Mezo blocks closing and ' +
        'refinancing a trove while it is there. Nothing moved.',
    };
  }
  if (has('exceeds maxBorrowingCapacity')) {
    return {
      name: 'Error(string)',
      title: 'Past Mezo’s per-trove ceiling',
      detail:
        'Mezo fixes a borrowing ceiling per trove at the BTC price the trove opened at, and this ' +
        'borrow would cross it. Adding collateral does not raise that ceiling; only a refinance ' +
        'does. Nothing moved.',
    };
  }
  if (has('Oracle is stale')) {
    return {
      name: 'Error(string)',
      title: 'The price feed is stale',
      detail:
        'Mezo’s BTC/USD oracle has not reported inside its 60-second tolerance, so MUSD refused ' +
        'to price the transaction rather than use an old number. Nothing moved. This clears on ' +
        'its own, usually within a block or two.',
    };
  }
  return null;
}

/** Solidity's built-in `Error(string)` and `Panic(uint256)`. */
const builtinsAbi = [
  { type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] },
  { type: 'error', name: 'Panic', inputs: [{ name: 'code', type: 'uint256' }] },
] as const;

function decodeRaw(data: Hex): RevertReason | null {
  try {
    const decoded = decodeErrorResult({ abi: marenErrorsAbi, data });
    return describe(decoded.errorName, (decoded.args ?? []) as readonly unknown[]);
  } catch {
    // Not one of ours — try Solidity's built-ins before giving up.
  }
  try {
    const decoded = decodeErrorResult({ abi: builtinsAbi, data });
    if (decoded.errorName === 'Error') {
      return describeErrorString(String(decoded.args?.[0] ?? ''));
    }
    return {
      name: 'Panic(uint256)',
      title: 'The contract hit an internal error',
      detail: `Solidity panic code ${String(decoded.args?.[0] ?? '?')}. This is a bug, not a user error.`,
    };
  } catch {
    return null;
  }
}

/**
 * Turn anything thrown by viem/wagmi into copy.
 *
 * Order matters: a user closing their wallet is by far the most common "failure" and is
 * not a failure at all, so it is checked first and never reaches the revert decoder.
 */
export function explainError(error: unknown): RevertReason {
  // Already explained by whoever threw it — a relayer refusal, or a request that never
  // reached one. Checked before the wallet-rejection test because these carry their own
  // finished copy and there is nothing left to decide.
  if (error instanceof ExplainedError) return error.reason;

  if (isUserRejection(error)) {
    return {
      name: null,
      title: 'Cancelled in your wallet',
      detail: 'Nothing was signed and nothing was sent.',
    };
  }

  // viem nests the real cause several levels down; `walk` is how you get at it.
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      // Solidity's built-in `Error(string)` has to be intercepted BEFORE the generic
      // `describe()` below. viem decodes it natively, so it arrives here already unpacked
      // as `errorName: 'Error'` and never reaches `decodeRaw`, where the string handling
      // lives. Left to fall through, every `require` message in MUSD rendered as
      // `Error(BorrowerOps: ...)` with "this refusal has no plain-language mapping yet"
      // appended to a sentence that was already plain language.
      if (reverted.data?.errorName === 'Error') {
        return describeErrorString(String(reverted.data.args?.[0] ?? reverted.reason ?? ''));
      }
      if (reverted.data?.errorName) {
        return describe(reverted.data.errorName, (reverted.data.args ?? []) as readonly unknown[]);
      }
      if (reverted.raw) {
        const decoded = decodeRaw(reverted.raw);
        if (decoded) return decoded;
      }
      if (reverted.reason) return describeErrorString(reverted.reason);
    }

    const raw = extractRawData(error);
    if (raw) {
      const decoded = decodeRaw(raw);
      if (decoded) return decoded;
    }

    if (/insufficient funds/i.test(error.message)) {
      return {
        name: null,
        title: 'Not enough BTC for gas',
        detail:
          'This account cannot cover the Bitcoin gas for this transaction. Deposits and any ' +
          'unsponsored call need a small BTC balance.',
      };
    }

    return {
      name: null,
      title: 'Not submitted',
      detail: error.shortMessage || error.message,
    };
  }

  return {
    name: null,
    title: 'Not submitted',
    detail: error instanceof Error ? error.message : String(error),
  };
}

function extractRawData(error: BaseError): Hex | null {
  const candidate = error.walk((e) => {
    const data = (e as { data?: unknown }).data;
    return typeof data === 'string' && data.startsWith('0x') && data.length >= 10;
  });
  const data = (candidate as { data?: unknown } | null)?.data;
  return typeof data === 'string' ? (data as Hex) : null;
}

/**
 * Did the user dismiss their wallet?
 *
 * EIP-1193 says 4001, and most wallets send it — but not all, and not consistently
 * through a wagmi connector, so the message is checked too. Getting this wrong in the
 * false-positive direction would hide a genuine failure, so the string match is kept
 * narrow.
 */
export function isUserRejection(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (code === 4001) return true;
  if (error instanceof BaseError) {
    if (error.walk((e) => (e as { code?: unknown })?.code === 4001)) return true;
    return /user (rejected|denied)|rejected the request|denied transaction/i.test(error.message);
  }
  return false;
}
