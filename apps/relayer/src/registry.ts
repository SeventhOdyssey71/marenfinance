import { parseAbiItem, toFunctionSelector, type AbiFunction, type Hex } from 'viem';

/**
 * The set of calls this relayer is willing to pay BTC gas for.
 *
 * R4 — "Allowlist targets and selectors. A generic 'relay any call' endpoint is
 * how R1 happens." This file is the closed set. It is code, not configuration:
 * environment variables can only ever *narrow* it (see config.ts). There is no
 * env var, header, or request field that can add a selector at runtime.
 *
 * INVARIANT — every relayable Maren function takes `uint256 relayFee` as its
 * final argument. That is what makes the sponsorship fee an *in-band* parameter:
 * it lives inside `ForwardRequest.data`, which is inside the EIP-712 struct the
 * user signed (R2). Nothing that moves value travels beside the signature.
 *   - Free-tier requests sign `relayFee = 0`.
 *   - Post-free-tier requests sign `relayFee >= policy.feeMusd`.
 * The relayer decodes the signed calldata to read the fee. It never reads a fee
 * from the request body, because a body field is not signed and can be swapped
 * after the fact (this is Talise C7, restated as R2).
 *
 * The fee recipient is a constant inside the Maren contract, not a parameter.
 * A caller cannot redirect it, and neither can the relayer.
 *
 * These signatures MUST stay byte-identical to `packages/contracts/src/*.sol`.
 * If a contract signature changes, the selector changes, and this relayer will
 * reject the call with SELECTOR_NOT_ALLOWED rather than relay something it
 * cannot decode — which is the correct failure direction.
 */

/** Names of the Maren contracts the relayer knows about. Mirrors `MarenAddresses`. */
export type MarenContractName =
  | 'marenPay'
  | 'marenRegistry'
  | 'marenVault'
  | 'marenEarn'
  | 'marenForwarder';

export interface RelayableFunction {
  /** Human-readable ABI signature, exactly as declared in Solidity. */
  readonly signature: string;
  /** Parsed ABI item, for decoding the signed calldata. */
  readonly abi: AbiFunction;
  /** 4-byte selector. */
  readonly selector: Hex;
  /** `contract.functionName`, the stable identifier used in config and logs. */
  readonly id: string;
  /** Index of the `uint256 relayFee` argument in the decoded args tuple. */
  readonly feeArgIndex: number;
}

function fn(contract: MarenContractName, signature: string): RelayableFunction {
  const abi = parseAbiItem(signature) as AbiFunction;
  const feeArgIndex = abi.inputs.findIndex((input) => input.name === 'relayFee');
  if (feeArgIndex === -1) {
    // A relayable function with no in-band fee argument could never charge for
    // sponsorship, so the free tier would be the only tier. Fail at module load
    // rather than discover it in production.
    throw new Error(`relayable function ${signature} is missing a uint256 relayFee argument`);
  }
  if (abi.inputs[feeArgIndex]?.type !== 'uint256') {
    throw new Error(`relayFee on ${signature} must be uint256`);
  }
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
 */
export const RELAYABLE_FUNCTIONS: Readonly<Record<MarenContractName, readonly RelayableFunction[]>> =
  {
    marenPay: [
      fn('marenPay', 'function pay(address to, uint256 amount, string memo, uint256 relayFee)'),
      fn('marenPay', 'function payTo(string handle, uint256 amount, string memo, uint256 relayFee)'),
      fn(
        'marenPay',
        'function createRequest(address from, uint256 amount, string memo, uint256 relayFee)',
      ),
      fn('marenPay', 'function fulfillRequest(bytes32 id, uint256 relayFee)'),
      fn('marenPay', 'function cancelRequest(bytes32 id, uint256 relayFee)'),
      fn(
        'marenPay',
        'function createLink(bytes32 amountHash, uint256 amount, uint64 expiry, uint256 relayFee)',
      ),
      fn('marenPay', 'function claimLink(bytes32 secret, uint256 relayFee)'),
      fn(
        'marenPay',
        'function split(address[] recipients, uint256[] amounts, string memo, uint256 relayFee)',
      ),
    ],
    marenRegistry: [
      fn('marenRegistry', 'function commitHandle(bytes32 commitment, uint256 relayFee)'),
      fn('marenRegistry', 'function revealHandle(string handle, bytes32 salt, uint256 relayFee)'),
      fn('marenRegistry', 'function setPrimaryHandle(string handle, uint256 relayFee)'),
    ],
    marenVault: [
      fn('marenVault', 'function borrow(uint256 amount, uint256 relayFee)'),
      fn('marenVault', 'function repay(uint256 amount, uint256 relayFee)'),
      fn(
        'marenVault',
        'function withdrawCollateral(uint256 amount, address to, uint256 relayFee)',
      ),
    ],
    marenEarn: [
      fn('marenEarn', 'function depositFor(uint256 assets, address receiver, uint256 relayFee)'),
      fn('marenEarn', 'function redeemFor(uint256 shares, address receiver, uint256 relayFee)'),
    ],
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
