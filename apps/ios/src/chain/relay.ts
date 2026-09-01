import Constants from 'expo-constants';
import { getAddress, type Address, type Hash, type Hex } from 'viem';

/**
 * The MarenRelayHub relayer client for iOS.
 *
 * This is the phone-side counterpart of `apps/web/src/lib/chain/relay.ts`, and it is built
 * to the SAME contract surface: the EIP-712 `ForwardRequest` domain and type, the wire
 * body, and the 202/refusal shapes were all matched against that file and against
 * `packages/contracts/src/MarenRelayHub.sol` / `MarenForwarder.sol`. Where the web reads
 * `NEXT_PUBLIC_RELAYER_URL` this reads `EXPO_PUBLIC_RELAYER_URL`; where it signs through
 * wagmi this signs with the viem account derived from the Keychain key. Everything else is
 * deliberately identical, because a one-character drift in the domain or the field order is
 * "every sponsored transaction fails signature recovery in production and nothing catches
 * it first".
 *
 * WHAT THIS DOES NOT DO. It never decides a transaction succeeded. `POST /relay` answers
 * 202 with an explicit `success: false`, because a hash is not a receipt. This module
 * returns the hash and `actions.ts` puts it through `confirmTransaction` exactly as it does
 * a self-submitted one — there is one definition of "delivered" in this app and it lives in
 * `receipt.ts`. And it never invents a success: a relayer that refuses, times out, or
 * cannot be reached throws a typed `RelayRefused`, which the action layer renders as an
 * honest "nothing was submitted", never as a fake hash.
 *
 * The hub's fee-free `execute` path (an ERC-2771 `ForwardRequest`) is the only one built
 * here, matching the deployed relayer. The fee-bearing `RelayedCall` struct exists in the
 * contract but no endpoint takes it yet; inventing one would produce a request the running
 * service rejects.
 */

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

/**
 * Trailing slashes stripped, empty treated as unset, and anything that is not a transport
 * we would send a signature over treated as unset too. A signed `ForwardRequest` exposes
 * the user's address, target, amount and memo to anyone who can read the connection, so
 * plain `http://` to a remote host is refused rather than trusted. The failure direction is
 * safe: an unset URL means the live path never engages and the app self-submits.
 */
export function normaliseUrl(raw: string | undefined | null): string | null {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (trimmed === '') return null;
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(trimmed)) return trimmed;
  return null;
}

/**
 * The relayer's base URL, or null when none is configured.
 *
 * Read from `EXPO_PUBLIC_RELAYER_URL`, which Expo inlines at build time, with a fallback to
 * an `expo.extra.marenRelayerUrl` entry in `app.json` for anyone who would rather configure
 * it there beside `marenNetwork`. Neither is set in this repository as it ships, which is
 * why the live write path is dormant until a relayer is actually hosted.
 */
export const RELAYER_URL: string | null =
  normaliseUrl(process.env.EXPO_PUBLIC_RELAYER_URL) ??
  normaliseUrl((Constants.expoConfig?.extra as { marenRelayerUrl?: string } | undefined)?.marenRelayerUrl);

/** True when a relayer URL is configured at all. Build-time. */
export function isRelayerConfigured(): boolean {
  return RELAYER_URL !== null;
}

/**
 * How long a request stays signable. Comfortably inside the relayer's own
 * `RELAYER_MAX_DEADLINE_SECONDS` default of 3600, past which it refuses a request the user
 * has already signed.
 */
export const RELAY_DEADLINE_SECONDS = 600;

/** Ceiling on the `gas` we will ask a user to sign for. Mirrors the relayer's default. */
export const MAX_RELAY_GAS = 1_500_000n;

/** A relayer that does not answer promptly is treated as absent. */
export const RELAY_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// EIP-712: MarenForwarder / MarenRelayHub
// ---------------------------------------------------------------------------

/**
 * The domain, byte-identical to the contract. `MarenForwarder` passes `DOMAIN_NAME` to
 * `ERC2771Forwarder` (an `EIP712` with version "1"), and `MarenRelayHub` extends it, so a
 * request uses the HUB's own address as `verifyingContract`.
 */
export const FORWARDER_DOMAIN_NAME = 'Maren Forwarder';
export const FORWARDER_DOMAIN_VERSION = '1';

/**
 * FIELD ORDER IS CONSENSUS-CRITICAL. `nonce` precedes `deadline`, matching OpenZeppelin's
 * `ForwardRequest` typehash. A transposition here produces a digest the forwarder rejects,
 * and the failure surfaces only after a relayer has paid to find out.
 */
export const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
    { name: 'data', type: 'bytes' },
  ],
} as const;

export interface ForwarderDomain {
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: Address;
}

export function forwarderDomain(chainId: number, verifyingContract: Address): ForwarderDomain {
  return {
    name: FORWARDER_DOMAIN_NAME,
    version: FORWARDER_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

/** The message a wallet signs. `deadline` is a number because the type is uint48. */
export interface ForwardRequestMessage {
  readonly from: Address;
  readonly to: Address;
  readonly value: bigint;
  readonly gas: bigint;
  readonly nonce: bigint;
  readonly deadline: number;
  readonly data: Hex;
}

export interface BuildRequestInput {
  readonly from: Address;
  readonly to: Address;
  readonly data: Hex;
  /** Inner-call gas. Clamped to `MAX_RELAY_GAS`. */
  readonly gas: bigint;
  /** `MarenRelayHub.nonces(from)`, read on-chain. Never guessed. */
  readonly nonce: bigint;
  /** Seconds since the epoch. Injected so tests are not clock-dependent. */
  readonly nowSeconds: number;
  readonly deadlineSeconds?: number;
}

/**
 * Build the struct, with `value` pinned at zero. Zero is not a default here, it is the only
 * legal value: `MarenRelayHub.execute` reverts `ValueNotRelayable` on any non-zero value,
 * and the relayer refuses one before it reaches the chain. A payable action (the BTC
 * deposit) is never routed here.
 */
export function buildForwardRequest(input: BuildRequestInput): ForwardRequestMessage {
  if (input.gas <= 0n) throw new Error('a forwarded call needs a positive gas limit');
  const deadline = input.nowSeconds + (input.deadlineSeconds ?? RELAY_DEADLINE_SECONDS);
  return {
    from: getAddress(input.from),
    to: getAddress(input.to),
    value: 0n,
    gas: input.gas > MAX_RELAY_GAS ? MAX_RELAY_GAS : input.gas,
    nonce: input.nonce,
    deadline,
    data: input.data,
  };
}

/**
 * The JSON body, exactly as the relayer's `forwardRequestSchema` accepts it. Every integer
 * is a base-10 string (a bigint cannot be `JSON.stringify`d), and the schema is strict, so
 * exactly the eight fields go on the wire.
 */
export function relayRequestBody(
  message: ForwardRequestMessage,
  signature: Hex,
): Record<string, string> {
  return {
    from: message.from,
    to: message.to,
    value: message.value.toString(),
    gas: message.gas.toString(),
    nonce: message.nonce.toString(),
    deadline: message.deadline.toString(),
    data: message.data,
    signature,
  };
}

/**
 * The `gas` to sign into the request, from a direct-call estimate. The forwarded call adds
 * the hub's own frame, the ERC-2771 sender suffix and OpenZeppelin's 63/64 headroom check;
 * half the estimate plus a flat 60k covers all three. This is a CAP, not a payment — the
 * relayer runs its own estimate and broadcasts with that — so a generous ceiling costs
 * nothing and a tight one buys an out-of-gas revert Maren pays for. Clamped to the ceiling
 * past which the relayer refuses outright.
 */
export function relayGasLimit(directEstimate: bigint): bigint {
  const padded = directEstimate + directEstimate / 2n + 60_000n;
  return padded > MAX_RELAY_GAS ? MAX_RELAY_GAS : padded;
}

/** `MarenRelayHub.nonces(owner)`. The only forwarder read this app performs. */
export const forwarderNoncesAbi = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ---------------------------------------------------------------------------
// responses and refusals
// ---------------------------------------------------------------------------

/** The relayer's 202 body. `RelayResult` in the service. */
export interface RelayAccepted {
  readonly hash: Hash;
  readonly state: 'submitted';
  readonly payer: Address;
  readonly sponsorship?: 'free-tier' | 'fee-paid';
}

/** The relayer's error body. `RelayError.toJSON` in the service. */
export interface RelayErrorBody {
  readonly error: string;
  readonly detail: string;
  readonly meta?: Record<string, unknown>;
  readonly requestId?: string;
}

/** A stated, human-readable reason nothing was submitted. Never a raw native/stack string. */
export interface RelayReason {
  readonly name: string;
  readonly title: string;
  readonly detail: string;
}

/**
 * Thrown for every failure on the relay path. It exists so the action layer can render one
 * honest sentence: nothing was submitted, and what to do next. A relayer this app has been
 * pointed at is trusted to spend its own BTC, not to talk the app into reporting a success.
 */
export class RelayRefused extends Error {
  readonly reason: RelayReason;
  constructor(reason: RelayReason) {
    super(`${reason.title}: ${reason.detail}`);
    this.name = 'RelayRefused';
    this.reason = reason;
  }
}

const NOTHING_SENT = 'Nothing was submitted and no gas was spent.';

/**
 * Turn a relayer refusal into the app's own copy. The relayer's `detail` is written for an
 * operator reading a log, so it is replaced rather than printed; the code is kept as `name`
 * for anyone who wants to grep the source. Every branch says the same two things in
 * different words: nothing moved, and what to do instead.
 */
export function relayFailureReason(status: number, body: RelayErrorBody | null): RelayReason {
  const code = body?.error ?? 'UPSTREAM_ERROR';

  switch (code) {
    case 'SPONSORSHIP_FEE_REQUIRED':
    case 'SPONSORSHIP_UNAVAILABLE':
    case 'FEE_BELOW_REQUIRED':
      return {
        name: code,
        title: 'Maren has stopped covering the gas for this account',
        detail: `The sponsored allowance for this address is spent. ${NOTHING_SENT} You can send this yourself and pay the Bitcoin gas.`,
      };
    case 'ADDRESS_RATE_LIMIT':
    case 'IP_RATE_LIMIT':
      return {
        name: code,
        title: 'Too many sponsored actions in one day',
        detail: `This address has reached its daily limit for actions Maren pays for. ${NOTHING_SENT} It resets at 00:00 UTC, or you can send this yourself now.`,
      };
    case 'GLOBAL_DAILY_BUDGET_EXHAUSTED':
    case 'RELAYER_UNDERFUNDED':
      return {
        name: code,
        title: 'Maren cannot pay for gas right now',
        detail: `The sponsorship budget for today is used up. ${NOTHING_SENT} You can send this yourself and pay the Bitcoin gas.`,
      };
    case 'RELAYER_NOT_ACCEPTING':
    case 'RELAYER_SHUTTING_DOWN':
    case 'STORE_UNAVAILABLE':
      return {
        name: code,
        title: 'Maren’s relayer is not taking work',
        detail: `The service that would have paid your gas is not accepting requests. ${NOTHING_SENT} Try again, or send it yourself.`,
      };
    case 'NONCE_MISMATCH':
    case 'DUPLICATE_REQUEST_IN_FLIGHT':
      return {
        name: code,
        title: 'This action was signed against a stale position in the queue',
        detail: `Another action from this account is still in flight. ${NOTHING_SENT} Wait for it to confirm and try again.`,
      };
    case 'REQUEST_EXPIRED':
    case 'DEADLINE_TOO_FAR':
      return {
        name: code,
        title: 'The signature timed out before it was submitted',
        detail: `A relayed action is only valid for a few minutes after you sign it. ${NOTHING_SENT} Try again.`,
      };
    case 'INVALID_SIGNATURE':
    case 'SIGNER_MISMATCH':
      return {
        name: code,
        title: 'The relayer would not accept that signature',
        detail: `What arrived did not match what your wallet signed, so it was refused. ${NOTHING_SENT}`,
      };
    case 'TARGET_NOT_ALLOWED':
    case 'SELECTOR_NOT_ALLOWED':
    case 'CALLDATA_UNDECODABLE':
    case 'VALUE_NOT_PERMITTED':
    case 'GAS_LIMIT_TOO_HIGH':
    case 'CALLDATA_TOO_LARGE':
    case 'MALFORMED_REQUEST':
    case 'UNSUPPORTED_CHAIN':
      return {
        name: code,
        title: 'Maren does not sponsor this action',
        detail: `The relayer only forwards a fixed set of calls to Maren’s own contracts, and this is not one of them. ${NOTHING_SENT} You can send it yourself.`,
      };
    case 'SIMULATION_REVERTED':
      return {
        name: code,
        title: 'This would have failed on-chain',
        detail: `The relayer ran the call against Mezo before paying for it and it reverted, so it was never broadcast. ${NOTHING_SENT}`,
      };
    case 'SUBMISSION_FAILED':
      return {
        name: code,
        title: 'The relayer could not broadcast this',
        detail: `The transaction was accepted and then failed to reach the chain. ${NOTHING_SENT} Check Activity before retrying.`,
      };
    default:
      return {
        name: code,
        title: 'Maren’s relayer refused this',
        detail: `The relayer answered ${status} and did not submit anything. ${NOTHING_SENT} You can send this yourself and pay the Bitcoin gas.`,
      };
  }
}

/**
 * Read a `/relay` response. A 202 that names OUR signer and carries a hash is the only
 * success; anything else is a `RelayReason`.
 *
 * `expectedPayer` is checked because the hash is where this client stops being sceptical:
 * `confirmTransaction` reads a receipt for whatever hash it is handed, so a 202 carrying
 * SOMEBODY ELSE'S real, confirmed hash would render as this action succeeding. Only the
 * relayer's own `payer` field ties the answer back to the request that was signed.
 */
export function decodeRelayResponse(
  status: number,
  body: unknown,
  expectedPayer?: string,
): RelayAccepted | { failure: RelayReason } {
  if (status === 202 && isAccepted(body, expectedPayer)) return body;
  if (status === 202) {
    return {
      failure: {
        name: 'RELAYER_ANSWER_UNRECOGNISED',
        title: 'Maren’s relayer answered with something unrecognisable',
        detail:
          'It accepted the request but did not return a broadcast this app can tie back to ' +
          'what you signed, so nothing is being reported as sent. Check Activity before retrying.',
      },
    };
  }
  const errorBody = isErrorBody(body) ? body : null;
  return { failure: relayFailureReason(status, errorBody) };
}

function isAccepted(body: unknown, expectedPayer?: string): body is RelayAccepted {
  if (body === null || typeof body !== 'object') return false;
  const { hash, state, payer } = body as { hash?: unknown; state?: unknown; payer?: unknown };
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return false;
  if (state !== 'submitted') return false;
  if (expectedPayer === undefined) return true;
  return typeof payer === 'string' && payer.toLowerCase() === expectedPayer.toLowerCase();
}

function isErrorBody(body: unknown): body is RelayErrorBody {
  return (
    body !== null &&
    typeof body === 'object' &&
    typeof (body as { error?: unknown }).error === 'string'
  );
}

export interface PostRelayOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * POST the signed request and return the hash the relayer broadcast under.
 *
 * The signature has already been given by this point, which is why every failure is
 * explicit that nothing was submitted: a user who signed and then saw a blank error would
 * have no way to know whether their money moved.
 */
export async function postRelay(
  url: string,
  body: Record<string, string>,
  options: PostRelayOptions = {},
): Promise<RelayAccepted> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? RELAY_TIMEOUT_MS);

  let status: number;
  let parsed: unknown;
  try {
    const response = await fetchImpl(`${url}/relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    status = response.status;
    parsed = await response.json().catch(() => null);
  } catch (error) {
    // Reaching the relayer failed, so it never saw the request. Unlike a broadcast that
    // vanished, this one provably did not happen — say so.
    throw new RelayRefused({
      name: 'RELAYER_UNREACHABLE',
      title: 'Could not reach Maren’s relayer',
      detail:
        'The request never left this device, so nothing was submitted and no gas was spent. ' +
        (error instanceof Error && /abort/i.test(error.message) ? 'It did not answer in time. ' : '') +
        'You can send this yourself and pay the Bitcoin gas.',
    });
  } finally {
    clearTimeout(timer);
  }

  const decoded = decodeRelayResponse(status, parsed, body['from']);
  if ('failure' in decoded) throw new RelayRefused(decoded.failure);
  return decoded;
}
