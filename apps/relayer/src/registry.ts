import { parseAbiItem, toFunctionSelector, type AbiFunction, type Hex } from 'viem';

/**
 * The set of calls this relayer is willing to pay BTC gas for.
 *
 * R4 — "Allowlist targets and selectors. A generic 'relay any call' endpoint is
 * how R1 happens." This file is the closed set. It is code, not configuration:
 * environment variables can only ever *narrow* it (see config.ts). There is no
 * env var, header, or request field that can add a selector at runtime.
 *
 * TODO(MarenRelayHub) — THE FEE PATH ATTACHES HERE.
 *
 * An earlier design required every relayable function to take a trailing
 * `uint256 relayFee`, so the fee rode inside `ForwardRequest.data` and was
 * therefore inside the signed EIP-712 struct (R2). That invariant is WITHDRAWN,
 * because the two-leg alternative it was competing with turned out to be unsafe
 * and the single-leg version turned out to be unnecessary:
 *
 *   `ERC2771Forwarder.executeBatch`'s `atomic` flag governs VALIDATION only, not
 *   inner-call failures. A batched fee leg settles even when the work leg
 *   reverts (including with `refundReceiver == address(0)`), so batching would
 *   silently charge users for work that did not happen. Single `execute` does
 *   bubble correctly.
 *
 * The replacement is `MarenRelayHub`: one forwarded call that takes the fee and
 * invokes the target atomically — fee and work settle together or neither does —
 * with the fee amount, token and recipient inside the signed payload. R2 is
 * preserved, just relocated from the target's calldata into the hub's request.
 *
 * Until the hub exists, `feeArgIndex` may be null. A call with no readable fee
 * cannot be charged for, so the paid tier is CLOSED for it rather than free:
 * `policy.ts` returns a typed `SPONSORSHIP_UNAVAILABLE` once the free tier is
 * spent. That keeps R16 (no silent subsidy) while the contract lands.
 *
 * The fee recipient is never a relayer-supplied parameter. A caller cannot
 * redirect it, and neither can the relayer.
 *
 * These signatures MUST stay byte-identical to `packages/contracts/src/*.sol`.
 * If a contract signature changes, the selector changes, and this relayer will
 * reject the call with SELECTOR_NOT_ALLOWED rather than relay something it
 * cannot decode — which is the correct failure direction.
 */

/** Names of the Maren contracts the relayer knows about. Mirrors `MarenAddresses`. */
export type MarenContractName =
  'marenPay' | 'marenRegistry' | 'marenVault' | 'marenEarn' | 'marenForwarder';

export interface RelayableFunction {
  /** Human-readable ABI signature, exactly as declared in Solidity. */
  readonly signature: string;
  /** Parsed ABI item, for decoding the signed calldata. */
  readonly abi: AbiFunction;
  /** 4-byte selector. */
  readonly selector: Hex;
  /** `contract.functionName`, the stable identifier used in config and logs. */
  readonly id: string;
  /**
   * Index of the `uint256 relayFee` argument in the decoded args tuple, or null
   * when this call shape carries no in-band fee. Null means the paid tier is
   * closed for it — see the MarenRelayHub note above.
   */
  readonly feeArgIndex: number | null;
}

/** Exported so tests can assert what the registry will and will not accept. */
export function defineRelayableFunction(
  contract: MarenContractName,
  signature: string,
): RelayableFunction {
  return fn(contract, signature);
}

function fn(contract: MarenContractName, signature: string): RelayableFunction {
  const abi = parseAbiItem(signature) as AbiFunction;
  const declared = abi.inputs.findIndex((input) => input.name === 'relayFee');
  // A missing fee argument is legal. What is NOT legal is a `relayFee` of the
  // wrong type, because that would decode to something we would then treat as a
  // fee — a parameter that is signed but not meaningfully enforced is exactly
  // the security-theatre shape R13 forbids.
  if (declared !== -1 && abi.inputs[declared]?.type !== 'uint256') {
    throw new Error(`relayFee on ${signature} must be uint256`);
  }
  const feeArgIndex = declared === -1 ? null : declared;
  return {
    signature,
    abi,
    selector: toFunctionSelector(abi),
    id: `${contract}.${abi.name}`,
    feeArgIndex,
  };
}

/**
 * NOTE ON VALUE-BEARING CALLS: `MarenVault` collateral deposits take native BTC
 * as `msg.value` and therefore can never be gasless in this design — the relayer
 * refuses any request with a non-zero `value` (R3), so a BTC deposit is a call
 * the user makes themselves. Only the MUSD-denominated vault operations are
 * relayable. This is a deliberate omission, not an oversight.
 *
 * THESE SIGNATURES WERE RE-READ FROM `packages/contracts/src/*.sol`.
 *
 * They had drifted, and the drift was total: every entry here carried a trailing
 * `uint256 relayFee` that the contracts author later removed, and several named
 * functions the contracts do not have (`payTo`, `commitHandle`, `revealHandle`,
 * `withdrawCollateral`, `depositFor`, `redeemFor`). This file predates
 * `packages/contracts` — the README still said the package "does not exist yet"
 * — so every signature here was a guess at an unwritten contract, and every one
 * of them was wrong.
 *
 * The failure that produces is the one the header above warns about, at full
 * scale: a different signature is a different selector, so EVERY relay request
 * the web app could ever send was destined for `403 SELECTOR_NOT_ALLOWED`. The
 * failure direction was safe. The service was not usable.
 *
 * The set below is the intersection of two authorities: the Solidity, for the
 * signatures, and `_allowlistRelayableCalls` in `script/Deploy.s.sol`, for which
 * of them `MarenRelayHub` will forward on-chain. This relayer is willing to pay
 * for exactly what the hub will accept, and for nothing that would revert
 * `CallNotAllowed` after we had spent gas discovering it. `allowlist.test.ts`
 * reads that script and fails if the two ever diverge again.
 *
 * A consequence worth stating: no contract carries a `relayFee` argument any
 * more, so every `feeArgIndex` below is null, so the paid tier is CLOSED rather
 * than free on every call. Once the free 25 are spent the relayer answers
 * `402 SPONSORSHIP_UNAVAILABLE`. That is the documented behaviour and the safe
 * one — a missing fee mechanism must never become an unbounded subsidy (R16).
 */
export const RELAYABLE_FUNCTIONS: Readonly<
  Record<MarenContractName, readonly RelayableFunction[]>
> = {
  marenPay: [
    fn('marenPay', 'function pay(address to, uint256 amount, string memo)'),
    fn('marenPay', 'function payToHandle(string handle, uint256 amount, string memo)'),
    fn(
      'marenPay',
      'function payWithPermit(address to, uint256 amount, string memo, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
    ),
    fn(
      'marenPay',
      'function payWithPermit2(address to, uint256 amount, string memo, ((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature)',
    ),
    fn('marenPay', 'function createRequest(address payer, uint256 amount, string memo)'),
    fn('marenPay', 'function fulfillRequest(uint256 requestId)'),
    fn(
      'marenPay',
      'function fulfillRequestWithPermit(uint256 requestId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
    ),
    fn('marenPay', 'function cancelRequest(uint256 requestId)'),
    fn('marenPay', 'function split(address[] recipients, uint256[] amounts, string memo)'),
    fn('marenPay', 'function claimLink(uint256 linkId, address recipient, bytes signature)'),
  ],
  marenRegistry: [
    fn('marenRegistry', 'function commit(bytes32 commitment)'),
    fn('marenRegistry', 'function register(string handle, bytes32 secret)'),
    fn('marenRegistry', 'function setPrimaryHandle(string handle)'),
    fn('marenRegistry', 'function transferHandle(string handle, address to)'),
  ],
  marenVault: [
    fn('marenVault', 'function borrow(uint256 amount, address upperHint, address lowerHint)'),
    fn('marenVault', 'function repay(uint256 amount, address upperHint, address lowerHint)'),
    fn('marenVault', 'function withdraw(uint256 amount, address upperHint, address lowerHint)'),
    fn('marenVault', 'function closePosition(address upperHint, address lowerHint)'),
  ],
  // EMPTY ON PURPOSE, AND NOT AN OVERSIGHT. `script/Deploy.s.sol` allowlists
  // MarenRegistry, MarenPay and MarenVault on the hub and does not allowlist
  // MarenEarn at all. A selector this relayer admitted but the hub then reverted
  // with `CallNotAllowed` would be caught in simulation and cost nothing — and it
  // would still be this service advertising a sponsorship the chain refuses, which
  // is the "documented here, broken in the code" shape R13 forbids. Add MarenEarn
  // here in the same change that adds it to the deploy script, never before.
  marenEarn: [],
  // The forwarder is never itself a relay target — relaying a call *to* the
  // forwarder would let a request nest another request. Explicitly empty.
  marenForwarder: [],
};

export const MAREN_CONTRACT_NAMES = Object.keys(RELAYABLE_FUNCTIONS) as MarenContractName[];

export function isMarenContractName(value: string): value is MarenContractName {
  return Object.prototype.hasOwnProperty.call(RELAYABLE_FUNCTIONS, value);
}

/** Every known relayable function id, e.g. `marenPay.pay`. */
export function allFunctionIds(): string[] {
  return MAREN_CONTRACT_NAMES.flatMap((name) => RELAYABLE_FUNCTIONS[name].map((f) => f.id));
}

export function functionsFor(contract: MarenContractName): readonly RelayableFunction[] {
  return RELAYABLE_FUNCTIONS[contract];
}
