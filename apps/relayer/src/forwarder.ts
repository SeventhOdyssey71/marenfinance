import {
  getAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
} from 'viem';
import { z } from 'zod';
import { bad, conflict, unauthorized } from './errors.js';

/**
 * ERC-2771 `ForwardRequest` handling for `MarenForwarder`
 * (OpenZeppelin v5 `ERC2771Forwarder`).
 *
 * The typehash below is byte-identical to OpenZeppelin's:
 *
 *   keccak256("ForwardRequest(address from,address to,uint256 value,uint256 gas,
 *              uint256 nonce,uint48 deadline,bytes data)")
 *
 * Field ORDER is consensus-critical — `nonce` precedes `deadline`. Getting it
 * wrong produces a digest the forwarder will not accept, and every relay would
 * fail on-chain after we had already paid to find out.
 */

export const FORWARDER_DOMAIN_NAME = 'Maren Forwarder';
export const FORWARDER_DOMAIN_VERSION = '1';

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

/** The slice of `ERC2771Forwarder` this service uses. */
export const FORWARDER_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'gas', type: 'uint256' },
          { name: 'deadline', type: 'uint48' },
          { name: 'data', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'verify',
    stateMutability: 'view',
    inputs: [
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'gas', type: 'uint256' },
          { name: 'deadline', type: 'uint48' },
          { name: 'data', type: 'bytes' },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ---------------------------------------------------------------------------
// request schema
// ---------------------------------------------------------------------------

const hexString = z.string().regex(/^0x[0-9a-fA-F]*$/, 'must be 0x-prefixed hex');
const addressString = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte address')
  .transform((value) => getAddress(value));
const uintString = z
  .union([z.string().regex(/^[0-9]+$/, 'must be a base-10 integer string'), z.number().int().nonnegative()])
  .transform((value) => BigInt(value));

/**
 * `.strict()` is a security control, not tidiness.
 *
 * R1 — "A relay request may not name its own funding source." Talise C1 was a
 * relayer that could be induced to fund an attacker's deposit. Any unexpected
 * key here (`sponsor`, `payer`, `funder`, `feePayer`, `relayer`, ...) is a hard
 * 400, so a field that a future version of this service might learn to read
 * cannot be smuggled past an older one. The only identity this service trusts is
 * the one recovered from the signature.
 */
export const forwardRequestSchema = z
  .object({
    from: addressString,
    to: addressString,
    value: uintString,
    gas: uintString,
    nonce: uintString,
    deadline: uintString,
    data: hexString,
    signature: hexString,
  })
  .strict();

export type ForwardRequest = z.infer<typeof forwardRequestSchema>;

/** Field names that would imply a client-chosen funding source. Never accepted. */
const FUNDING_FIELD_NAMES = [
  'sponsor',
  'payer',
  'funder',
  'feePayer',
  'fee_payer',
  'relayer',
  'fundingSource',
  'sender',
];

export function parseForwardRequest(body: unknown): ForwardRequest {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw bad('MALFORMED_REQUEST', 'expected a JSON object');
  }
  const present = FUNDING_FIELD_NAMES.filter((name) =>
    Object.prototype.hasOwnProperty.call(body, name),
  );
  if (present.length > 0) {
    throw bad(
      'MALFORMED_REQUEST',
      `request names a funding source (${present.join(', ')}); the payer is derived from the signature and may not be supplied`,
      { fields: present.join(',') },
    );
  }
  const parsed = forwardRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw bad(
      'MALFORMED_REQUEST',
      issue === undefined
        ? 'request does not match the ForwardRequest schema'
        : `${issue.path.join('.') || 'request'}: ${issue.message}`,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------

export function forwarderDomain(chainId: number, verifyingContract: Address): TypedDataDomain {
  return {
    name: FORWARDER_DOMAIN_NAME,
    version: FORWARDER_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

/** The tuple shape `execute`/`verify` take on-chain (no `nonce` — it is read from storage). */
export function toOnChainRequest(request: ForwardRequest): {
  from: Address;
  to: Address;
  value: bigint;
  gas: bigint;
  deadline: number;
  data: Hex;
  signature: Hex;
} {
  return {
    from: request.from,
    to: request.to,
    value: request.value,
    gas: request.gas,
    deadline: Number(request.deadline),
    data: request.data as Hex,
    signature: request.signature as Hex,
  };
}

export interface ForwarderReader {
  /** Current forwarder nonce for `owner`. */
  nonces(owner: Address): Promise<bigint>;
  /** Whether `from` is a contract account (7702-delegated or smart wallet). */
  hasCode(address: Address): Promise<boolean>;
  /** On-chain `ERC2771Forwarder.verify`, used for contract signers. */
  verify(request: ReturnType<typeof toOnChainRequest>): Promise<boolean>;
}

export type SignerKind = 'eoa' | 'contract';

export interface VerifiedRequest {
  readonly request: ForwardRequest;
  /**
   * THE payer. Derived from the recovered signature (EOA) or from an on-chain
   * `verify()` that itself checks the signature (contract account). Every quota,
   * rate limit and spend record in this service keys off this value and nothing
   * else. R1.
   */
  readonly payer: Address;
  readonly signerKind: SignerKind;
  readonly onChainNonce: bigint;
}

export interface VerifyOptions {
  readonly chainId: number;
  readonly forwarder: Address;
  readonly maxDeadlineSeconds: number;
  readonly now?: number;
}

/**
 * Verify a `ForwardRequest` end to end.
 *
 * The order is: cheap local checks, then signature recovery, then one chain read
 * for the nonce. A tampered request is rejected before it costs an RPC round
 * trip, and certainly before it costs gas.
 */
export async function verifyForwardRequest(
  reader: ForwarderReader,
  request: ForwardRequest,
  options: VerifyOptions,
): Promise<VerifiedRequest> {
  const now = options.now ?? Math.floor(Date.now() / 1000);

  if (request.deadline <= BigInt(now)) {
    throw bad('REQUEST_EXPIRED', 'the signed request deadline has passed', {
      deadline: request.deadline.toString(),
      now,
    });
  }
  // A deadline years out is a signature that stays replayable for years if the
  // user's nonce never advances. Bound it.
  if (request.deadline > BigInt(now + options.maxDeadlineSeconds)) {
    throw bad(
      'DEADLINE_TOO_FAR',
      `the signed request deadline is more than ${options.maxDeadlineSeconds}s in the future`,
      { deadline: request.deadline.toString(), maxDeadlineSeconds: options.maxDeadlineSeconds },
    );
  }
  if (request.deadline > 0xffffffffffffn) {
    throw bad('MALFORMED_REQUEST', 'deadline does not fit in uint48');
  }

  const domain = forwarderDomain(options.chainId, options.forwarder);
  const message = {
    from: request.from,
    to: request.to,
    value: request.value,
    gas: request.gas,
    nonce: request.nonce,
    deadline: Number(request.deadline),
    data: request.data as Hex,
  };

  const isContract = await reader.hasCode(request.from);
  let payer: Address;
  let signerKind: SignerKind;

  if (isContract) {
    // ERC-1271 / EIP-7702 accounts cannot be ecrecovered. Defer to the
    // forwarder's own `verify()`, which runs OpenZeppelin's SignatureChecker
    // against the same digest and the same on-chain nonce. If it says no, we do
    // not relay. Keeping this branch is what leaves the EIP-7702 upgrade path
    // (live on Mezo mainnet since block 9,275,000) open.
    const ok = await reader.verify(toOnChainRequest(request));
    if (!ok) {
      throw unauthorized(
        'INVALID_SIGNATURE',
        'the forwarder rejected this contract-account signature',
        { signerKind: 'contract' },
      );
    }
    payer = request.from;
    signerKind = 'contract';
  } else {
    if (!/^0x[0-9a-fA-F]{130}$/.test(request.signature)) {
      throw unauthorized('INVALID_SIGNATURE', 'signature is not 65 bytes');
    }
    let recovered: Address;
    try {
      recovered = await recoverTypedDataAddress({
        domain,
        types: FORWARD_REQUEST_TYPES,
        primaryType: 'ForwardRequest',
        message,
        signature: request.signature as Hex,
      });
    } catch {
      throw unauthorized('INVALID_SIGNATURE', 'signature could not be recovered');
    }
    // The recovered address IS the payer. `request.from` is treated as a claim
    // that must match it, never as an input to accounting.
    if (recovered.toLowerCase() !== request.from.toLowerCase()) {
      throw unauthorized(
        'SIGNER_MISMATCH',
        'the address recovered from the signature does not match the request signer',
      );
    }
    payer = recovered;
    signerKind = 'eoa';
  }

  const onChainNonce = await reader.nonces(payer);
  if (request.nonce !== onChainNonce) {
    throw conflict('NONCE_MISMATCH', 'the signed nonce is not the current forwarder nonce', {
      signed: request.nonce.toString(),
      expected: onChainNonce.toString(),
    });
  }

  return { request, payer, signerKind, onChainNonce };
}
