import { describe, expect, it } from 'vitest';
import { hashTypedData } from 'viem';
import { getChain, PERMIT2_ADDRESS, X402_SETTLEMENT } from '@maren/sdk';

import {
  buildDemoRequirements,
  buildPaymentRequired,
  buildPermit2Authorization,
  createPermit2Nonce,
  decodeBase64Json,
  eip2612PermitTypedData,
  encodeBase64Json,
  permit2WitnessTypedData,
  requirementsMatch,
  X402_DEMO_ASSET,
  X402_DEMO_CAIP2,
  X402_DEMO_PRICE_WEI,
} from './protocol';

/**
 * The wire shapes, pinned. Every value asserted here was transcribed from the published
 * `@x402/evm@2.16.0` / `@x402/core@2.16.0` dist and cross-checked against the live
 * facilitator's /supported answer, so a future edit that drifts from the protocol fails
 * here rather than inside the facilitator's signature verification.
 */

const MERCHANT = '0x54196397D6f01b48739dB3957257cB33cD341885' as const;
const BUYER = '0x1111111111111111111111111111111111111111' as const;

describe('x402 payment requirements', () => {
  const req = buildDemoRequirements(MERCHANT);

  it('offers 0.01 MUSD on Mezo testnet in CAIP-2 form', () => {
    expect(req.scheme).toBe('exact');
    expect(req.network).toBe('eip155:31611');
    // The literal chain id in protocol.ts must be the SDK's testnet chain, not a typo.
    expect(getChain('testnet').id).toBe(31611);
    expect(req.network).toBe(X402_DEMO_CAIP2);
    expect(req.amount).toBe('10000000000000000');
    expect(BigInt(req.amount)).toBe(X402_DEMO_PRICE_WEI);
    expect(req.asset).toBe('0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503');
    expect(req.payTo).toBe(MERCHANT);
  });

  it('carries the true MUSD EIP-712 domain: Mezo USD, not the symbol', () => {
    expect(req.extra).toEqual({
      name: 'Mezo USD',
      version: '1',
      assetTransferMethod: 'permit2',
    });
  });

  it('wraps into a v2 PaymentRequired with the eip2612 extension declared', () => {
    const body = buildPaymentRequired(MERCHANT, 'https://example.test/api/x402/note');
    expect(body.x402Version).toBe(2);
    expect(body.accepts).toHaveLength(1);
    expect(body.resource.url).toBe('https://example.test/api/x402/note');
    expect(body.extensions).toHaveProperty('eip2612GasSponsoring');
  });
});

describe('requirementsMatch', () => {
  const ours = buildDemoRequirements(MERCHANT);

  it('accepts a byte-identical echo and case-shifted addresses', () => {
    expect(requirementsMatch(ours, ours)).toBe(true);
    expect(
      requirementsMatch({ ...ours, asset: ours.asset.toLowerCase() as typeof ours.asset }, ours),
    ).toBe(true);
  });

  it('refuses a changed price, recipient or network', () => {
    expect(requirementsMatch({ ...ours, amount: '1' }, ours)).toBe(false);
    expect(requirementsMatch({ ...ours, payTo: BUYER }, ours)).toBe(false);
    expect(requirementsMatch({ ...ours, network: 'eip155:31612' }, ours)).toBe(false);
  });
});

describe('permit2 witness typed data', () => {
  const req = buildDemoRequirements(MERCHANT);
  const auth = buildPermit2Authorization({ from: BUYER, requirements: req, nowSeconds: 1_000 });

  it('binds spender to the settlement proxy and recipient into the witness', () => {
    expect(auth.spender).toBe(X402_SETTLEMENT);
    expect(auth.witness.to).toBe(MERCHANT);
    expect(auth.witness.validAfter).toBe('0');
    expect(auth.deadline).toBe(String(1_000 + req.maxTimeoutSeconds));
    expect(auth.permitted.token).toBe(X402_DEMO_ASSET);
    expect(auth.permitted.amount).toBe(req.amount);
  });

  it('signs against the canonical Permit2 domain and hashes cleanly', () => {
    const typed = permit2WitnessTypedData(auth);
    expect(typed.domain).toEqual({
      name: 'Permit2',
      chainId: 31611,
      verifyingContract: PERMIT2_ADDRESS,
    });
    expect(typed.primaryType).toBe('PermitWitnessTransferFrom');
    // hashTypedData throws on any incomplete type graph; a clean hash proves the
    // PermitWitnessTransferFrom / TokenPermissions / Witness set is self-consistent.
    expect(hashTypedData(typed)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('eip2612 permit typed data', () => {
  it('signs against MUSD itself with the Mezo USD domain, spender Permit2', () => {
    const typed = eip2612PermitTypedData({
      owner: BUYER,
      value: X402_DEMO_PRICE_WEI,
      nonce: 0n,
      deadline: 1_600n,
    });
    expect(typed.domain).toEqual({
      name: 'Mezo USD',
      version: '1',
      chainId: 31611,
      verifyingContract: X402_DEMO_ASSET,
    });
    expect(typed.message.spender).toBe(PERMIT2_ADDRESS);
    expect(hashTypedData(typed)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('nonces and header codecs', () => {
  it('creates decimal uint256 nonces that do not repeat', () => {
    const a = createPermit2Nonce();
    const b = createPermit2Nonce();
    expect(a).toMatch(/^[0-9]+$/);
    expect(BigInt(a)).toBeLessThan(2n ** 256n);
    expect(a).not.toBe(b);
  });

  it('round-trips JSON through base64, unicode included', () => {
    const value = { hello: 'x402', amount: '10000000000000000', note: 'café →' };
    const encoded = encodeBase64Json(value);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(decodeBase64Json(encoded)).toEqual(value);
  });
});
