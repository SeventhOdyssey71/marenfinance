/**
 * The event set the metrics scan reads.
 *
 * The vault, pay and earn topics come straight from `@maren/sdk` so this tool cannot drift
 * from what the apps read: one transcription of each event signature, checked against the
 * deployed bytecode in the SDK, imported here.
 *
 * Two events are added that the SDK does not export because the apps' Activity screen has no
 * row for them, but the pilot does need them:
 *
 *   - RequestFulfilled: a payment request that was settled. `packages/contracts/src/
 *     MarenPay.sol:117`. This is the "requests settled" metric. Transcribed from the
 *     Solidity source, not invented; its four indexed/non-indexed slots match the emit at
 *     MarenPay.sol:442.
 *   - HandleRegistered: a handle claimed on the registry. `packages/contracts/src/
 *     MarenRegistry.sol:70`. This is the "handles registered" metric.
 */
import { MAREN_EARN_EVENTS, MAREN_PAY_EVENTS, MAREN_VAULT_EVENTS } from '@maren/sdk';
import { parseAbiItem } from 'viem';

export const REQUEST_FULFILLED = parseAbiItem(
  'event RequestFulfilled(uint256 indexed requestId, address indexed payer, address indexed requester, uint256 amount)',
);

export const HANDLE_REGISTERED = parseAbiItem(
  'event HandleRegistered(bytes32 indexed node, address indexed owner, string handle)',
);

/** Vault events, verbatim from the SDK. */
export const VAULT_EVENTS = MAREN_VAULT_EVENTS;

/** Pay events: the SDK set plus RequestFulfilled, which the apps do not render but the pilot counts. */
export const PAY_EVENTS = [...MAREN_PAY_EVENTS, REQUEST_FULFILLED];

/** Earn events (ERC-4626 Deposit/Withdraw), verbatim from the SDK. */
export const EARN_EVENTS = MAREN_EARN_EVENTS;

/** Registry events the pilot reads. Only HandleRegistered is needed for the count. */
export const REGISTRY_EVENTS = [HANDLE_REGISTERED];

/** Pull the logs of one named event out of a mixed decoded-log array. */
export function pick(logs, eventName) {
  return logs.filter((log) => log.eventName === eventName);
}
