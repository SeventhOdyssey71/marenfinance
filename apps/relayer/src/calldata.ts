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
  /**
   * The `relayFee` argument in MUSD wei, taken from the SIGNED calldata, or null
   * when this call shape carries no in-band fee (see the MarenRelayHub TODO in
   * registry.ts). Null closes the paid tier for the call; it never means free.
   */
  readonly signedFeeMusdWei: bigint | null;
}

/**
 * Largest signed calldata this relayer will pay to put on Mezo, in bytes.
 *
 * THIS IS A BUDGET CONTROL, NOT A SANITY CHECK. Every byte of calldata costs the
 * relayer intrinsic gas at the TRANSACTION level, and transaction-level gas is
 * not `ForwardRequest.gas` — that field is the gas handed to the INNER call. So
 * `maxGasPerRequest` bounds the wrong number, and the reservation, which is
 * `request.gas * maxFeePerGas`, bounds it too.
 *
 * Measured: `MarenPay.pay` with a 100,000-character memo is a perfectly valid,
 * fully decodable, allowlisted call. It costs about 1,600,000 gas in calldata
 * alone before the target does anything, and the request that carried it signed
 * `gas: 300000` and reserved for that. Nothing rejected it. The reservation was
 * out by more than 6x on one request, and reservations are what stop concurrent
 * traffic from overrunning the daily cap before the first receipt lands.
 *
 * 8 KiB is chosen from the widest call Maren actually has: `split` with the
 * contract's maximum 64 recipients is about 4,300 bytes plus the memo. It bounds
 * the unsigned share of the cost at roughly 131,000 gas, which is small beside
 * the smallest sensible `request.gas`. It also bounds what a single request can
 * make this process parse and hold.
 */
export const MAX_CALLDATA_BYTES = 8_192;

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

  // --- calldata bound ------------------------------------------------------
  // Before the decode, because decoding is the expensive part and this is the
  // cheap one. See MAX_CALLDATA_BYTES for why a gas cap does not cover it.
  const calldataBytes = Math.ceil((request.data.length - 2) / 2);
  if (calldataBytes > MAX_CALLDATA_BYTES) {
    throw forbidden(
      'CALLDATA_TOO_LARGE',
      'the signed calldata is larger than this relayer will pay to publish',
      { bytes: calldataBytes, cap: MAX_CALLDATA_BYTES },
    );
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

  // TODO(MarenRelayHub): when the hub lands, the fee comes from the hub request
  // rather than the target's calldata. Read it there and delete this branch.
  let signedFeeMusdWei: bigint | null = null;
  if (fn.feeArgIndex !== null) {
    const feeArg = args[fn.feeArgIndex];
    if (typeof feeArg !== 'bigint') {
      // The signature says there is a fee here and we cannot read it. Refuse
      // rather than guess at the economics of a call.
      throw bad('CALLDATA_UNDECODABLE', 'could not read relayFee from the signed calldata', {
        functionId: fn.id,
      });
    }
    signedFeeMusdWei = feeArg;
  }

  return { target, fn, selector, args, signedFeeMusdWei };
}
