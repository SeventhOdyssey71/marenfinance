import { getAddress, slice, type Address, type Hash, type Hex } from 'viem';

import { ExplainedError, type RevertReason } from './errors';

/**
 * The relayer client. Everything the app needs to hand a signed call to
 * `apps/relayer` instead of broadcasting it from the user's own wallet.
 *
 * THIS FILE IS BUILT TO THE RELAYER'S ACTUAL SURFACE, NOT TO AN IDEA OF IT.
 * Every shape below was read out of `apps/relayer/src`:
 *
 *   - the request body        `forwardRequestSchema` in `src/forwarder.ts:119`
 *   - the EIP-712 domain      `FORWARDER_DOMAIN_NAME` / `_VERSION`, `src/forwarder.ts:25`
 *   - the struct + field order `FORWARD_REQUEST_TYPES`, `src/forwarder.ts:28`
 *   - the success body        `RelayResult`, `src/service.ts:46`
 *   - the error body          `RelayError.toJSON`, `src/errors.ts:67`
 *   - the health probe        `GET /healthz`, `src/app.ts:149`
 *
 * The relayer's `POST /relay` takes an ERC-2771 `ForwardRequest` and puts it through
 * `MarenRelayHub.execute` — the fee-free path. It does NOT take the hub's fee-bearing
 * `RelayedCall` struct, and there is no endpoint that does. So this client builds a
 * `ForwardRequest`, and the sponsorship it asks for is the free tier. When the paid tier
 * lands, the relayer grows a `RelayedCall` shape and this file grows a second builder;
 * inventing one here now would produce a request the running service rejects as
 * MALFORMED_REQUEST.
 *
 * NOTHING HERE DECIDES A TRANSACTION SUCCEEDED. `POST /relay` answers 202 with an
 * explicit `success: false`, because a hash is not a receipt. This module returns the
 * hash and `useTxRunner` puts it through `confirmTransaction` exactly as it does for a
 * self-submitted one. There is one definition of "delivered" in this app and it is in
 * `receipt.ts`.
 */

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

/**
 * The relayer's base URL, or null when none is configured.
 *
 * Read through a literal `process.env.NEXT_PUBLIC_RELAYER_URL` so Next inlines it at
 * build time. That matters for more than convenience: the value is identical on the
 * server and in the browser, so any copy that depends only on "is a relayer configured"
 * renders the same in both and cannot cause a hydration mismatch. Whether that relayer is
 * actually ACCEPTING is a runtime question, answered by `probeRelayer` below, and copy
 * that depends on it must tolerate starting out false.
 */
export const RELAYER_URL: string | null = normaliseUrl(process.env.NEXT_PUBLIC_RELAYER_URL);

/** Trailing slashes stripped, empty and whitespace-only treated as unset. */
export function normaliseUrl(raw: string | undefined | null): string | null {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  return trimmed === '' ? null : trimmed;
}

/** True when a relayer URL is configured at all. Build-time, so it is SSR-safe. */
export const RELAYER_CONFIGURED = RELAYER_URL !== null;

/**
 * How long a request stays signable. Comfortably inside the relayer's own
 * `RELAYER_MAX_DEADLINE_SECONDS` (3600 by default, `src/config.ts`), because a deadline
 * past that ceiling is refused with DEADLINE_TOO_FAR after the user has already signed.
 */
export const RELAY_DEADLINE_SECONDS = 600;

/**
 * Ceiling on the `gas` we will ask a user to sign for.
 *
 * Mirrors the relayer's default `RELAYER_MAX_GAS_PER_REQUEST`. Signing a larger number
 * does not get more gas, it gets a 403 GAS_LIMIT_TOO_HIGH, so it is clamped here where we
 * can still say something useful about it.
 */
export const MAX_RELAY_GAS = 1_500_000n;

/** How long a `/healthz` answer is trusted before it is asked again. */
export const HEALTH_CACHE_MS = 30_000;

/** Network timeouts. A relayer that does not answer promptly is treated as absent. */
export const HEALTH_TIMEOUT_MS = 4_000;
export const RELAY_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// EIP-712: MarenForwarder / MarenRelayHub
// ---------------------------------------------------------------------------

/**
 * The domain, byte-identical to the contract.
 *
 * `MarenForwarder` passes `DOMAIN_NAME` to `ERC2771Forwarder`, which is an `EIP712` with
 * version "1". `MarenRelayHub` extends `MarenForwarder`, so a request signed for the hub
 * uses the hub's own address as `verifyingContract` — the standalone forwarder is
 * deliberately never deployed (see `packages/sdk/src/addresses.ts`).
 */
export const FORWARDER_DOMAIN_NAME = 'Maren Forwarder';
export const FORWARDER_DOMAIN_VERSION = '1';

/**
 * FIELD ORDER IS CONSENSUS-CRITICAL. `nonce` precedes `deadline`, matching
 * OpenZeppelin's `ForwardRequest` typehash. A transposition here produces a digest the
 * forwarder rejects, and the failure surfaces only after a relayer has paid to find out.
 * `relay.test.ts` pins this against a fixture the relayer's own suite also checks.
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
 * Build the struct, with `value` pinned at zero.
 *
 * Zero is not a default here, it is the only legal value: `MarenRelayHub.execute` reverts
 * `ValueNotRelayable` on any non-zero `value`, and the relayer refuses one before it ever
 * reaches the chain (`admitCall`, `src/calldata.ts:40`). A payable action is not a
 * relayable action, and `isRelayableCall` below refuses to route one here at all.
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
 * The JSON body, exactly as `forwardRequestSchema` accepts it.
 *
 * Every integer is a base-10 string: the schema's `uintString` takes a decimal string or
 * a non-negative integer, and a `bigint` cannot be serialised by `JSON.stringify` at all.
 * The schema is `.strict()`, so an extra key is a 400 — this function is the only place
 * that decides what goes on the wire, and it emits exactly the eight fields.
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

// ---------------------------------------------------------------------------
// what may be relayed
// ---------------------------------------------------------------------------

/**
 * The calls `MarenRelayHub` will forward, as the deploy script sets them.
 *
 * Transcribed from `packages/contracts/script/Deploy.s.sol:_allowlistRelayableCalls`,
 * which is the code that actually writes `allowedCall[target][selector]` on-chain. The
 * hub checks this on BOTH `executeWithFee` and the inherited `execute`, so a call missing
 * from here reverts `CallNotAllowed` no matter which entrypoint reaches it.
 *
 * TWO ABSENCES ARE DELIBERATE AND NEITHER IS AN OVERSIGHT:
 *
 *   - `MarenVault.deposit` and `depositAndBorrow` are payable. The hub reverts
 *     `ValueNotRelayable` on any request carrying value, so a Bitcoin deposit is a
 *     transaction the user sends themselves and always will be.
 *   - `MarenEarn` is not on the hub's allowlist at all, and neither is
 *     `MarenPay.createLink`. They are ordinary transactions today.
 *
 * Selectors are not written out here. They are derived from the ABI at the call site with
 * `viem`'s encoder, which is the same derivation Solidity does — a hand-typed selector is
 * a transcription error waiting to be paid for in gas.
 */
export const HUB_ALLOWED_FUNCTIONS: Readonly<Record<MarenTargetName, readonly string[]>> = {
  marenRegistry: ['commit', 'register', 'setPrimaryHandle', 'transferHandle'],
  marenPay: [
    'pay',
    'payToHandle',
    'payWithPermit',
    'payWithPermit2',
    'createRequest',
    'fulfillRequest',
    'fulfillRequestWithPermit',
    'cancelRequest',
    'split',
    'claimLink',
  ],
  marenVault: ['borrow', 'repay', 'withdraw', 'closePosition'],
  marenEarn: [],
};

export type MarenTargetName = 'marenRegistry' | 'marenPay' | 'marenVault' | 'marenEarn';

export interface RelayableCall {
  readonly target: MarenTargetName;
  readonly functionName: string;
  /** Non-zero native value. A payable call can never be relayed. */
  readonly carriesValue: boolean;
}

/**
 * Would the hub forward this call?
 *
 * Value is checked FIRST and independently of the allowlist, so a payable call is refused
 * on the ground that actually applies to it. `MarenVault.deposit` is not merely absent
 * from a list somebody could add to; it is unrelayable by construction.
 */
export function isRelayableCall(call: RelayableCall): boolean {
  if (call.carriesValue) return false;
  return HUB_ALLOWED_FUNCTIONS[call.target].includes(call.functionName);
}

/**
 * Every write this app can perform, and the call it becomes.
 *
 * ONE TABLE, READ BY BOTH SIDES. The routing in `write.ts` consults it to decide whether
 * to relay, and the screens consult it to decide what to claim about who pays. That is
 * the whole reason it exists: while the two were derived separately, the Earn panel said
 * an action was sponsorable and the router — correctly — self-submitted it, because
 * `MarenEarn` is not on the hub's allowlist. Copy and behaviour cannot disagree about a
 * fact they read from the same row.
 */
export interface WriteActionSpec {
  /** The Maren contract, or null for a call to something else entirely. */
  readonly target: MarenTargetName | null;
  readonly functionName: string;
  readonly carriesValue: boolean;
}

export const WRITE_ACTIONS = {
  // Payable. Never relayable, and the reason is the value, not the list.
  depositBtc: { target: 'marenVault', functionName: 'deposit', carriesValue: true },
  borrowMusd: { target: 'marenVault', functionName: 'borrow', carriesValue: false },
  repayMusd: { target: 'marenVault', functionName: 'repay', carriesValue: false },
  withdrawBtc: { target: 'marenVault', functionName: 'withdraw', carriesValue: false },
  // MUSD is not a Maren contract, so no forwarder trusts it and no allowlist covers it.
  approveMusd: { target: null, functionName: 'approve', carriesValue: false },
  payAddress: { target: 'marenPay', functionName: 'pay', carriesValue: false },
  payHandle: { target: 'marenPay', functionName: 'payToHandle', carriesValue: false },
  createRequest: { target: 'marenPay', functionName: 'createRequest', carriesValue: false },
  // On the hub's allowlist for `claimLink` but not `createLink`. Recorded rather than
  // quietly omitted, so the absence is visible to whoever next reads the deploy script.
  createLink: { target: 'marenPay', functionName: 'createLink', carriesValue: false },
  earnDeposit: { target: 'marenEarn', functionName: 'deposit', carriesValue: false },
  earnWithdraw: { target: 'marenEarn', functionName: 'withdraw', carriesValue: false },
  commitHandle: { target: 'marenRegistry', functionName: 'commit', carriesValue: false },
  registerHandle: { target: 'marenRegistry', functionName: 'register', carriesValue: false },
} as const satisfies Record<string, WriteActionSpec>;

export type WriteActionId = keyof typeof WRITE_ACTIONS;

/** Would `MarenRelayHub` forward this app action? The screens' sponsorship claim. */
export function actionIsRelayable(id: WriteActionId): boolean {
  const action: WriteActionSpec = WRITE_ACTIONS[id];
  if (action.target === null) return false;
  return isRelayableCall({
    target: action.target,
    functionName: action.functionName,
    carriesValue: action.carriesValue,
  });
}

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------

export interface RelayerHealth {
  /** The probe completed and the relayer answered. */
  readonly reachable: boolean;
  /** It answered AND said it is taking work. The only value that routes traffic. */
  readonly accepting: boolean;
  /** What it says is wrong, when it says anything. Never rendered to a user. */
  readonly problems: readonly string[];
  /** When this answer was taken, for the cache. */
  readonly at: number;
}

const UNREACHABLE: Omit<RelayerHealth, 'at'> = {
  reachable: false,
  accepting: false,
  problems: [],
};

let cached: RelayerHealth | null = null;
let inFlight: Promise<RelayerHealth> | null = null;

/** Drop the cached probe. Called after a refusal, and by tests. */
export function resetRelayerHealth(): void {
  cached = null;
  inFlight = null;
}

/**
 * Record that the relayer refused a request we had already routed to it.
 *
 * A cached "accepting" answer that has just been contradicted by a real 402/429/503 is
 * worse than no answer: the sheet would keep saying Maren pays while every attempt is
 * turned away. Marking it unavailable makes the next render tell the truth and the next
 * press go through the user's own wallet.
 */
export function noteRelayerRefusal(now: number = Date.now()): void {
  cached = { ...UNREACHABLE, at: now };
  inFlight = null;
}

export interface ProbeOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  /** Ignore the cache. Used by tests; the app always wants the cheap answer. */
  readonly force?: boolean;
}

/**
 * Ask `/healthz` whether this relayer is taking work.
 *
 * `/healthz`, not `/health`: the deployment probe makes no RPC calls, so polling it every
 * half minute from every open tab costs the relayer two counter reads rather than two
 * Mezo round trips. It answers 503 when it is not accepting, which is the case this
 * client cares about — see `src/app.ts:149`.
 *
 * ANY failure resolves to "not accepting". A relayer we cannot reach, that times out,
 * that answers with something we cannot parse, or that is on an origin the browser will
 * not let us call, are all the same fact from the app's point of view: this action is
 * going to be paid for by the user, so say so before they press anything.
 */
export async function probeRelayer(
  url: string | null = RELAYER_URL,
  options: ProbeOptions = {},
): Promise<RelayerHealth> {
  const now = options.now ?? Date.now;
  if (url === null) return { ...UNREACHABLE, at: now() };

  if (options.force !== true) {
    if (cached !== null && now() - cached.at < HEALTH_CACHE_MS) return cached;
    // One probe per window, however many components ask. A dozen screens mounting at
    // once must not turn into a dozen requests at a service whose whole budget is a
    // shared one.
    if (inFlight !== null) return inFlight;
  }

  const run = (async (): Promise<RelayerHealth> => {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? HEALTH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${url}/healthz`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      const body = (await response.json()) as { accepting?: unknown; problems?: unknown };
      const problems = Array.isArray(body.problems) ? body.problems.map(String) : [];
      return {
        reachable: true,
        // `accepting` is the relayer's own verdict and the status code agrees with it.
        // Both are required: a proxy that rewrites a 503 into a 200 must not be able to
        // talk this client into routing at a refusing relayer.
        accepting: body.accepting === true && response.ok,
        problems,
        at: now(),
      };
    } catch {
      return { ...UNREACHABLE, at: now() };
    } finally {
      clearTimeout(timer);
    }
  })();

  inFlight = run;
  const health = await run;
  cached = health;
  inFlight = null;
  return health;
}

// ---------------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------------

export interface RouteInput {
  /** `NEXT_PUBLIC_RELAYER_URL`, or null. */
  readonly url: string | null;
  /** The last probe. Null before one has completed. */
  readonly health: RelayerHealth | null;
  /** Would the hub forward this exact call? See `isRelayableCall`. */
  readonly relayable: boolean;
}

/**
 * THE ROUTING DECISION, in one function, so the app cannot make it three different ways.
 *
 * All three conditions, always. A missing URL is the default state of this repository. A
 * relayer that has not answered yet is not a relayer that said yes. And an action the hub
 * will not forward must never be sent to a service that would spend gas discovering that.
 * Anything else self-submits exactly as it did before this file existed.
 */
export function shouldRelay(input: RouteInput): boolean {
  if (input.url === null) return false;
  if (!input.relayable) return false;
  return input.health?.accepting === true;
}

// ---------------------------------------------------------------------------
// submission
// ---------------------------------------------------------------------------

/** The relayer's 202 body. `RelayResult` in `src/service.ts:46`. */
export interface RelayAccepted {
  readonly hash: Hash;
  readonly state: 'submitted';
  readonly payer: Address;
  readonly nonce: number;
  readonly sponsorship: 'free-tier' | 'fee-paid';
  readonly freeActionsRemaining: number;
  readonly function: string;
  readonly statusUrl: string;
}

/** The relayer's error body. `RelayError.toJSON` in `src/errors.ts:67`. */
export interface RelayErrorBody {
  readonly error: string;
  readonly detail: string;
  readonly meta?: Record<string, unknown>;
  readonly requestId?: string;
}

/**
 * Turn a relayer refusal into the app's own refusal copy.
 *
 * The relayer's `detail` is written for an operator reading a log, not for somebody
 * holding a phone, so it is replaced rather than printed. The code is kept as `name` in
 * the same slot a Solidity error name occupies, because that is the field the sheet
 * already renders small at the bottom for anyone who wants to grep the source.
 *
 * Every branch here says the same two things in different words: nothing was submitted,
 * and what to do next. A refusal that leaves a user unsure whether their money moved is
 * the failure this app spends the most code preventing.
 */
export function relayFailureReason(status: number, body: RelayErrorBody | null): RevertReason {
  const code = body?.error ?? 'UPSTREAM_ERROR';
  const nothingSent = 'Nothing was submitted and no gas was spent.';

  switch (code) {
    case 'SPONSORSHIP_FEE_REQUIRED':
    case 'SPONSORSHIP_UNAVAILABLE':
    case 'FEE_BELOW_REQUIRED':
      return {
        name: code,
        title: 'Maren has stopped covering the gas for this account',
        detail: `The sponsored allowance for this address is spent. ${nothingSent} You can send this yourself and pay the Bitcoin gas.`,
      };
    case 'ADDRESS_RATE_LIMIT':
    case 'IP_RATE_LIMIT':
      return {
        name: code,
        title: 'Too many sponsored actions in one day',
        detail: `This address has reached its daily limit for actions Maren pays for. ${nothingSent} It resets at 00:00 UTC, or you can send this yourself now.`,
      };
    case 'GLOBAL_DAILY_BUDGET_EXHAUSTED':
    case 'RELAYER_UNDERFUNDED':
      return {
        name: code,
        title: 'Maren cannot pay for gas right now',
        detail: `The sponsorship budget for today is used up. ${nothingSent} You can send this yourself and pay the Bitcoin gas.`,
      };
    case 'RELAYER_NOT_ACCEPTING':
    case 'RELAYER_SHUTTING_DOWN':
    case 'STORE_UNAVAILABLE':
      return {
        name: code,
        title: 'Maren’s relayer is not taking work',
        detail: `The service that would have paid your gas is not accepting requests. ${nothingSent} Try again, or send it yourself.`,
      };
    case 'NONCE_MISMATCH':
    case 'DUPLICATE_REQUEST_IN_FLIGHT':
      return {
        name: code,
        title: 'This action was signed against a stale position in the queue',
        detail: `Another action from this account is still in flight. ${nothingSent} Wait for it to confirm and try again.`,
      };
    case 'REQUEST_EXPIRED':
    case 'DEADLINE_TOO_FAR':
      return {
        name: code,
        title: 'The signature timed out before it was submitted',
        detail: `A relayed action is only valid for a few minutes after you sign it. ${nothingSent} Try again.`,
      };
    case 'INVALID_SIGNATURE':
    case 'SIGNER_MISMATCH':
      return {
        name: code,
        title: 'The relayer would not accept that signature',
        detail: `What arrived did not match what your wallet signed, so it was refused. ${nothingSent}`,
      };
    case 'TARGET_NOT_ALLOWED':
    case 'SELECTOR_NOT_ALLOWED':
    case 'CALLDATA_UNDECODABLE':
    case 'VALUE_NOT_PERMITTED':
    case 'GAS_LIMIT_TOO_HIGH':
    case 'MALFORMED_REQUEST':
    case 'UNSUPPORTED_CHAIN':
      return {
        name: code,
        title: 'Maren does not sponsor this action',
        detail: `The relayer only forwards a fixed set of calls to Maren’s own contracts, and this is not one of them. ${nothingSent} You can send it yourself.`,
      };
    case 'SIMULATION_REVERTED':
      return {
        name: code,
        title: 'This would have failed on-chain',
        detail: `The relayer ran the call against Mezo before paying for it and it reverted, so it was never broadcast. ${nothingSent}`,
      };
    case 'SUBMISSION_FAILED':
      return {
        name: code,
        title: 'The relayer could not broadcast this',
        detail: `The transaction was accepted and then failed to reach the chain. ${nothingSent} Check Activity before retrying.`,
      };
    default:
      return {
        name: code,
        title: 'Maren’s relayer refused this',
        detail: `The relayer answered ${status} and did not submit anything. ${nothingSent} You can send this yourself and pay the Bitcoin gas.`,
      };
  }
}

/**
 * Which refusals mean "stop routing at this relayer for now".
 *
 * A spent allowance, an exhausted budget or a service that is not accepting are all
 * conditions that will still hold on the next press, so the cached health is knocked down
 * and the interface goes back to saying the user pays. A bad signature or a stale nonce
 * is about this one request and says nothing about the service.
 */
const STICKY_REFUSALS = new Set([
  'SPONSORSHIP_FEE_REQUIRED',
  'SPONSORSHIP_UNAVAILABLE',
  'FEE_BELOW_REQUIRED',
  'ADDRESS_RATE_LIMIT',
  'IP_RATE_LIMIT',
  'GLOBAL_DAILY_BUDGET_EXHAUSTED',
  'RELAYER_UNDERFUNDED',
  'RELAYER_NOT_ACCEPTING',
  'RELAYER_SHUTTING_DOWN',
  'STORE_UNAVAILABLE',
  'TARGET_NOT_ALLOWED',
  'SELECTOR_NOT_ALLOWED',
  'VALUE_NOT_PERMITTED',
]);

export function isStickyRefusal(code: string | null | undefined): boolean {
  return code !== null && code !== undefined && STICKY_REFUSALS.has(code);
}

/**
 * Read a `/relay` response.
 *
 * A 202 with a hash is the ONLY success. Anything else throws an `ExplainedError`
 * carrying copy `explainError` will hand straight back, so a relayer refusal reaches the
 * sheet through the same path a contract revert does and renders identically.
 */
export function decodeRelayResponse(
  status: number,
  body: unknown,
): RelayAccepted | { failure: RevertReason; code: string } {
  if (status === 202 && isAccepted(body)) return body;
  const errorBody = isErrorBody(body) ? body : null;
  return {
    failure: relayFailureReason(status, errorBody),
    code: errorBody?.error ?? 'UPSTREAM_ERROR',
  };
}

function isAccepted(body: unknown): body is RelayAccepted {
  if (body === null || typeof body !== 'object') return false;
  const hash = (body as { hash?: unknown }).hash;
  return typeof hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(hash);
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
  readonly now?: () => number;
}

/**
 * POST the signed request, and return the hash the relayer broadcast under.
 *
 * The signature has already been given by this point, which is why every failure below is
 * explicit about the fact that nothing was submitted. A user who signed and then saw a
 * blank error would have no way to know whether their money moved.
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
    // Reaching the relayer failed, so it never saw the request. That is worth stating
    // plainly rather than reporting as an unknown outcome: unlike a broadcast that
    // vanished, this one provably did not happen.
    noteRelayerRefusal(options.now?.() ?? Date.now());
    throw new ExplainedError({
      name: 'RELAYER_UNREACHABLE',
      title: 'Could not reach Maren’s relayer',
      detail:
        'The request never left this device, so nothing was submitted and no gas was spent. ' +
        (error instanceof Error && /abort/i.test(error.message)
          ? 'It did not answer in time. '
          : '') +
        'You can send this yourself and pay the Bitcoin gas.',
    });
  } finally {
    clearTimeout(timer);
  }

  const decoded = decodeRelayResponse(status, parsed);
  if ('failure' in decoded) {
    if (isStickyRefusal(decoded.code)) noteRelayerRefusal(options.now?.() ?? Date.now());
    throw new ExplainedError(decoded.failure);
  }
  return decoded;
}

// ---------------------------------------------------------------------------
// gas
// ---------------------------------------------------------------------------

/**
 * The `gas` to sign into the request, from a direct-call estimate.
 *
 * The estimate is for the user calling the target themselves; the forwarded call adds the
 * hub's own frame, the ERC-2771 sender suffix, and OpenZeppelin's 63/64 headroom check.
 * A half of the estimate plus a flat 60k covers all three with room, and the number is a
 * CAP rather than a payment: the relayer runs its own `eth_estimateGas` and broadcasts
 * with that, so signing a generous ceiling costs nothing and signing a tight one buys an
 * out-of-gas revert that Maren pays for.
 *
 * Clamped to `MAX_RELAY_GAS`, because past that the relayer refuses the request outright.
 */
export function relayGasLimit(directEstimate: bigint): bigint {
  const padded = directEstimate + directEstimate / 2n + 60_000n;
  return padded > MAX_RELAY_GAS ? MAX_RELAY_GAS : padded;
}

/** The 4-byte selector of some calldata, for logging and for allowlist checks. */
export function selectorOf(data: Hex): Hex {
  return slice(data, 0, 4);
}
