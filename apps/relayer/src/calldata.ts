import { decodeFunctionData, slice, type Hex } from 'viem';
import { bad, forbidden } from './errors.js';
import type { AllowedTarget, RelayerConfig } from './config.js';
import type { RelayableFunction } from './registry.js';
import type { ForwardRequest } from './forwarder.js';

/**
 * Target + selector admission, and extraction of the in-band sponsorship fee.
 *
 * R4 — the relayer relays only to known Maren contracts and only for known
 * selectors, and the selector set is scoped to the target: `claimLink` is a
 * MarenPay function, so a request pointing it at MarenEarn is rejected even
 * though both addresses are allowlisted.
 *
 * R2 — the fee is read out of `request.data`, which is a field of the EIP-712
 * struct the user signed. It is never read from the HTTP body. That is the whole
 * point: Talise C7 validated the relayer fee off-chain while leaving it outside
 * the signed payload, so it could be swapped after signing.
 */

export interface AdmittedCall {
  readonly target: AllowedTarget;
  readonly fn: RelayableFunction;
  readonly selector: Hex;
  /** Decoded arguments of the signed calldata. */
  readonly args: readonly unknown[];
  /** The `relayFee` argument, in MUSD wei, taken from the signed calldata. */
  readonly signedFeeMusdWei: bigint;
}

export function admitCall(config: RelayerConfig, request: ForwardRequest): AdmittedCall {
  // --- value (R3) ----------------------------------------------------------
  // The relayer holds gas, never user funds. A non-zero `value` would make it
  // spend BTC into a target contract, which is exactly the custodial role it is
  // not allowed to take. There is no configuration that turns this off.
  if (request.value !== 0n) {
    throw forbidden(
      'VALUE_NOT_PERMITTED',
      'this relayer never forwards native BTC value; send value-bearing calls from your own account',
      { value: request.value.toString() },
    );
  }

  // --- gas bound -----------------------------------------------------------
  if (request.gas > config.policy.maxGasPerRequest) {
    throw forbidden('GAS_LIMIT_TOO_HIGH', 'requested gas exceeds the per-request cap', {
      requested: request.gas.toString(),
      cap: config.policy.maxGasPerRequest.toString(),
    });
  }

  // --- target allowlist (R4) ------------------------------------------------
  const target = config.targets.get(request.to.toLowerCase());
  if (target === undefined) {
    throw forbidden('TARGET_NOT_ALLOWED', 'the target contract is not on the relay allowlist', {
      target: request.to,
    });
  }

  // --- selector allowlist (R4) ---------------------------------------------
  if (request.data.length < 10) {
    throw bad('MALFORMED_REQUEST', 'calldata is shorter than a 4-byte selector');
  }
  const selector = slice(request.data as Hex, 0, 4);
  const fn = target.functions.get(selector.toLowerCase());
  if (fn === undefined) {
    throw forbidden(
      'SELECTOR_NOT_ALLOWED',
      `selector ${selector} is not a relayable function on ${target.name}`,
      { target: target.name, selector },
    );
  }

  // --- decode the signed calldata ------------------------------------------
  // If we cannot decode it we cannot read the fee, and a request whose economics
  // we cannot read is one we refuse rather than guess at.
  let decoded: { args?: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: [fn.abi], data: request.data as Hex });
  } catch {
    throw bad(
      'CALLDATA_UNDECODABLE',
      `calldata does not decode against ${fn.id}(${fn.signature})`,
      { functionId: fn.id },
    );
  }
  const args = decoded.args ?? [];
  const feeArg = args[fn.feeArgIndex];
  if (typeof feeArg !== 'bigint') {
    throw bad('CALLDATA_UNDECODABLE', `could not read relayFee from the signed calldata`, {
      functionId: fn.id,
    });
  }

  return { target, fn, selector, args, signedFeeMusdWei: feeArg };
}
