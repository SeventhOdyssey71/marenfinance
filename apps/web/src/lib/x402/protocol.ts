import {
  getMusdAddresses,
  PERMIT2_ADDRESS,
  X402_FACILITATOR_URL,
  X402_SETTLEMENT,
} from '@maren/sdk';
import type { Address, Hex } from 'viem';

/**
 * x402 over MUSD, hand-rolled to the wire — the protocol layer both halves of the demo
 * share. The merchant route handler (`app/api/x402/note/route.ts`) builds its 402 from
 * here; the buyer component (`components/app/x402-demo.tsx`) builds its signatures from
 * here; the tests pin the shapes so neither can drift from the other.
 *
 * WHY NOT `@x402/*`. The SDK route was read end to end before deciding this — every shape
 * below is transcribed from the published `@x402/evm@2.16.0` and `@x402/core@2.16.0` dist
 * (the exact release the Mezo quickstart pins), not from documentation. Three reasons to
 * hand-roll:
 *
 *   1. The client half of `@x402` (`@x402/fetch`, `@x402/paywall`) drags a Solana
 *      dependency tree into a browser bundle that pays with one EVM signature; Mezo's own
 *      quickstart carries a troubleshooting entry for that tree failing to install.
 *   2. Maren already ships viem + wagmi. The whole protocol is one typed-data signature,
 *      two base64 JSON headers and two facilitator POSTs; the primitives are here.
 *   3. This file states the exact bytes signed and sent, which is worth more to an
 *      auditor of a payments demo than an SDK call that resolves them at runtime.
 *
 * VERIFIED against the live facilitator: `GET https://facilitator.vativ.io/supported`
 * lists `{ scheme: "exact", network: "eip155:31611" }` with MUSD
 * 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503, `eip712: { name: "Mezo USD", version: "1" }`,
 * `assetTransferMethod: "permit2"`, `supportsEip2612: true`, and the
 * `eip2612GasSponsoring` extension. The domain name really is `Mezo USD`, not the `MUSD`
 * symbol — hand-rolling that wrong is the documented way to fail verification.
 */

// ── The offer ────────────────────────────────────────────────────────────────

/** The demo is testnet only. Every constant below is derived from that, on purpose. */
export const X402_DEMO_NETWORK = 'testnet' as const;

/**
 * Written as a literal so wagmi's registered-config types accept it as a `chainId`;
 * `protocol.test.ts` pins it to `getChain('testnet').id` so it cannot drift.
 */
export const X402_DEMO_CHAIN_ID = 31611 as const;

/** CAIP-2, the only network form x402 v2 accepts. `"mezo-testnet"` and `31611` are rejected. */
export const X402_DEMO_CAIP2 = `eip155:${X402_DEMO_CHAIN_ID}`;

export const X402_DEMO_ASSET: Address = getMusdAddresses(X402_DEMO_NETWORK).musd;

/** 0.01 MUSD in wei. 18 decimals is what makes a one-cent HTTP price exact, not rounded. */
export const X402_DEMO_PRICE_WEI = 10_000_000_000_000_000n;

/** The permit deadline horizon. The buyer's signature is dead ten minutes after signing. */
export const X402_DEMO_TIMEOUT_SECONDS = 600;

/**
 * MUSD's EIP-712 domain. `Mezo USD`, version `1` — NOT the symbol. Confirmed twice: in
 * Mezo's docs and in the facilitator's own /supported answer.
 */
export const MUSD_EIP712_DOMAIN = { name: 'Mezo USD', version: '1' } as const;

export const FACILITATOR_URL = X402_FACILITATOR_URL;

/** The extension key under which a gas-sponsored EIP-2612 permit rides in the payload. */
export const EIP2612_EXTENSION_KEY = 'eip2612GasSponsoring';

// ── Wire types (transcribed from @x402/core@2.16.0 zod schemas) ──────────────

export interface X402ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

export interface X402PaymentRequirements {
  scheme: 'exact';
  network: string;
  /** Atomic units as a decimal string: 0.01 MUSD is "10000000000000000". */
  amount: string;
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
  /** The asset's EIP-712 domain plus the transfer method the scheme should use. */
  extra: { name: string; version: string; assetTransferMethod: 'permit2' };
}

/** The 402 body / PAYMENT-REQUIRED header content. */
export interface X402PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: X402ResourceInfo;
  accepts: X402PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

/** What the buyer signs, minus the signature itself. */
export interface Permit2Authorization {
  from: Address;
  permitted: { token: Address; amount: string };
  /** Always the x402 settlement proxy: it is the contract Permit2 releases funds to. */
  spender: Address;
  nonce: string;
  deadline: string;
  witness: { to: Address; validAfter: string };
}

export interface Eip2612PermitInfo {
  from: Address;
  asset: Address;
  spender: Address;
  amount: string;
  nonce: string;
  deadline: string;
  signature: Hex;
  version: '1';
}

/** The PAYMENT-SIGNATURE header content: the chosen requirements plus the signature. */
export interface X402PaymentPayload {
  x402Version: 2;
  resource?: X402ResourceInfo;
  accepted: X402PaymentRequirements;
  payload: { signature: Hex; permit2Authorization: Permit2Authorization };
  extensions?: { [EIP2612_EXTENSION_KEY]?: { info: Eip2612PermitInfo } };
}

export interface X402VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
}

export interface X402SettleResponse {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
  errorMessage?: string;
}

// ── Header names ─────────────────────────────────────────────────────────────

export const HEADER_PAYMENT_REQUIRED = 'PAYMENT-REQUIRED';
export const HEADER_PAYMENT_SIGNATURE = 'PAYMENT-SIGNATURE';
export const HEADER_PAYMENT_RESPONSE = 'PAYMENT-RESPONSE';

// ── Building the offer ───────────────────────────────────────────────────────

/**
 * The demo's single payment option. `extra` carries MUSD's true EIP-712 domain so a
 * client that hand-builds asset metadata (this one, or any stranger's) signs against
 * `Mezo USD` and passes facilitator verification.
 */
export function buildDemoRequirements(payTo: Address): X402PaymentRequirements {
  return {
    scheme: 'exact',
    network: X402_DEMO_CAIP2,
    amount: X402_DEMO_PRICE_WEI.toString(),
    asset: X402_DEMO_ASSET,
    payTo,
    maxTimeoutSeconds: X402_DEMO_TIMEOUT_SECONDS,
    extra: { ...MUSD_EIP712_DOMAIN, assetTransferMethod: 'permit2' },
  };
}

export function buildPaymentRequired(
  payTo: Address,
  resourceUrl: string,
  error?: string,
): X402PaymentRequired {
  return {
    x402Version: 2,
    ...(error ? { error } : {}),
    resource: {
      url: resourceUrl,
      description: 'Maren x402 demo: a settlement note, unlocked by 0.01 MUSD on Mezo testnet',
      mimeType: 'application/json',
    },
    accepts: [buildDemoRequirements(payTo)],
    // Declared because the facilitator supports it: a buyer with no Permit2 allowance can
    // attach a gas-sponsored EIP-2612 permit instead of sending an approval transaction.
    extensions: { [EIP2612_EXTENSION_KEY]: {} },
  };
}

/**
 * Does the payload's `accepted` block match what this merchant actually offered? The
 * merchant re-derives its own requirements and refuses anything else — the facilitator is
 * told to verify OUR terms, never terms the client wrote for itself.
 */
export function requirementsMatch(
  accepted: X402PaymentRequirements,
  expected: X402PaymentRequirements,
): boolean {
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return (
    accepted.scheme === expected.scheme &&
    accepted.network === expected.network &&
    accepted.amount === expected.amount &&
    eq(accepted.asset, expected.asset) &&
    eq(accepted.payTo, expected.payTo)
  );
}

// ── The two EIP-712 messages ─────────────────────────────────────────────────

/**
 * The payment authorization itself: a Permit2 `PermitWitnessTransferFrom` with the
 * recipient bound into the witness, signed against the canonical Permit2 domain. The
 * types match `@x402/evm`'s `permit2WitnessTypes` field for field.
 */
export const PERMIT2_WITNESS_TYPES = {
  PermitWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'witness', type: 'Witness' },
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  Witness: [
    { name: 'to', type: 'address' },
    { name: 'validAfter', type: 'uint256' },
  ],
} as const;

/** EIP-2612, exactly as the standard writes it. Signed against MUSD's own domain. */
export const EIP2612_PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/** A random uint256 nonce as a decimal string, the form Permit2's unordered nonces take. */
export function createPermit2Nonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let hex = '0x';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return BigInt(hex).toString();
}

export function buildPermit2Authorization(params: {
  from: Address;
  requirements: X402PaymentRequirements;
  nowSeconds?: number;
}): Permit2Authorization {
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  return {
    from: params.from,
    permitted: { token: params.requirements.asset, amount: params.requirements.amount },
    spender: X402_SETTLEMENT,
    nonce: createPermit2Nonce(),
    deadline: (now + params.requirements.maxTimeoutSeconds).toString(),
    witness: { to: params.requirements.payTo, validAfter: '0' },
  };
}

/** The full typed-data argument for the payment signature, ready for `signTypedData`. */
export function permit2WitnessTypedData(auth: Permit2Authorization) {
  return {
    domain: {
      name: 'Permit2',
      chainId: X402_DEMO_CHAIN_ID,
      verifyingContract: PERMIT2_ADDRESS,
    },
    types: PERMIT2_WITNESS_TYPES,
    primaryType: 'PermitWitnessTransferFrom' as const,
    message: {
      permitted: {
        token: auth.permitted.token,
        amount: BigInt(auth.permitted.amount),
      },
      spender: auth.spender,
      nonce: BigInt(auth.nonce),
      deadline: BigInt(auth.deadline),
      witness: {
        to: auth.witness.to,
        validAfter: BigInt(auth.witness.validAfter),
      },
    },
  };
}

/**
 * The one-time approval signature, only needed while the buyer's Permit2 allowance on
 * MUSD is below the price. Signed against MUSD's own `Mezo USD` domain; the facilitator
 * submits it and pays the gas, so the buyer still never sends a transaction.
 */
export function eip2612PermitTypedData(params: {
  owner: Address;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}) {
  return {
    domain: {
      ...MUSD_EIP712_DOMAIN,
      chainId: X402_DEMO_CHAIN_ID,
      verifyingContract: X402_DEMO_ASSET,
    },
    types: EIP2612_PERMIT_TYPES,
    primaryType: 'Permit' as const,
    message: {
      owner: params.owner,
      spender: PERMIT2_ADDRESS,
      value: params.value,
      nonce: params.nonce,
      deadline: params.deadline,
    },
  };
}

// ── Header codecs ────────────────────────────────────────────────────────────

/**
 * x402 headers are plain base64 over JSON (not base64url). UTF-8 safe in both runtimes:
 * Buffer where it exists (the route handler), TextEncoder + btoa in the browser.
 */
export function encodeBase64Json(value: unknown): string {
  const json = JSON.stringify(value);
  if (typeof Buffer !== 'undefined') return Buffer.from(json, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64Json<T>(header: string): T {
  if (typeof Buffer !== 'undefined') {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as T;
  }
  const binary = atob(header);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

// ── Facilitator client (server side) ─────────────────────────────────────────

/**
 * `POST /verify` and `POST /settle`, the two facilitator calls a merchant makes. The body
 * shape is `HTTPFacilitatorClient`'s, verbatim: version, payload, requirements. A non-2xx
 * answer that still parses as a verify/settle result is returned as that result — the
 * facilitator reports "invalid payment" through both channels.
 */
export async function facilitatorPost<T extends X402VerifyResponse | X402SettleResponse>(
  path: 'verify' | 'settle',
  paymentPayload: X402PaymentPayload,
  paymentRequirements: X402PaymentRequirements,
  timeoutMs: number,
): Promise<T> {
  const response = await fetch(`${FACILITATOR_URL}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Facilitator ${path} answered ${response.status} with a non-JSON body.`);
  }
  const isResult =
    typeof parsed === 'object' &&
    parsed !== null &&
    (path === 'verify' ? 'isValid' in parsed : 'success' in parsed);
  if (!isResult) {
    throw new Error(`Facilitator ${path} answered ${response.status} in an unrecognised shape.`);
  }
  return parsed as T;
}
