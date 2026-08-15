import { describe, expect, it } from 'vitest';
import { getAddress, keccak256, toHex, type Address } from 'viem';
import {
  FORWARD_REQUEST_TYPES,
  FORWARDER_ABI,
  FORWARDER_DOMAIN_NAME,
  FORWARDER_DOMAIN_VERSION,
  forwarderDomain,
} from '../src/forwarder.js';

/**
 * F5 — the EIP-712 domain had no coverage.
 *
 * `test/helpers.ts` signs through the same `forwarderDomain()` the service
 * verifies against, so changing `FORWARDER_DOMAIN_NAME` to anything at all
 * survived the entire suite: both sides moved together. It fails closed (every
 * relay would be rejected rather than mis-executed), so this is correctness
 * rather than fund loss — but a wrong domain would break every relay against the
 * deployed forwarder with nothing going red, which is the worst kind of bug to
 * ship: silent in CI, total in production.
 *
 * The fix is the one the contracts author used for the typehash: pin the values
 * against hardcoded literals, so the constant cannot move without a test
 * failing. These literals must match `MarenForwarder`'s EIP712 constructor
 * arguments exactly.
 */

describe('EIP-712 domain is pinned', () => {
  it('has the exact name MarenForwarder is constructed with', () => {
    expect(FORWARDER_DOMAIN_NAME).toBe('Maren Forwarder');
  });

  it('has the exact version MarenForwarder is constructed with', () => {
    expect(FORWARDER_DOMAIN_VERSION).toBe('1');
  });

  it('builds a domain with the pinned literals, not with itself', () => {
    const verifyingContract = getAddress('0x1111111111111111111111111111111111111111');
    expect(forwarderDomain(31611, verifyingContract)).toEqual({
      name: 'Maren Forwarder',
      version: '1',
      chainId: 31611,
      verifyingContract,
    });
  });

  it('binds the chain id, so a mainnet signature cannot verify on testnet', () => {
    const verifyingContract = getAddress('0x1111111111111111111111111111111111111111');
    expect(forwarderDomain(31612, verifyingContract).chainId).toBe(31612);
    expect(forwarderDomain(31611, verifyingContract).chainId).toBe(31611);
  });

  it('binds the verifying contract, so a signature for another forwarder cannot verify', () => {
    const a = getAddress('0x1111111111111111111111111111111111111111');
    const b = getAddress('0x2222222222222222222222222222222222222222');
    expect(forwarderDomain(31611, a).verifyingContract).not.toBe(
      forwarderDomain(31611, b).verifyingContract,
    );
  });
});

describe('ForwardRequest type is pinned to OpenZeppelin v5', () => {
  /**
   * The literal string OpenZeppelin hashes into `_FORWARD_REQUEST_TYPEHASH`.
   * FIELD ORDER IS CONSENSUS-CRITICAL — `nonce` precedes `deadline`. Swapping
   * them produces a digest the deployed forwarder will never accept, and we
   * would only discover it after paying gas to find out.
   */
  const OZ_TYPE_STRING =
    'ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)';

  /** keccak256 of the string above — OpenZeppelin's `_FORWARD_REQUEST_TYPEHASH`. */
  const OZ_TYPEHASH = keccak256(toHex(OZ_TYPE_STRING));

  it('encodes to exactly OpenZeppelin’s type string', () => {
    const encoded = `ForwardRequest(${FORWARD_REQUEST_TYPES.ForwardRequest.map(
      (field) => `${field.type} ${field.name}`,
    ).join(',')})`;
    expect(encoded).toBe(OZ_TYPE_STRING);
  });

  it('hashes to the pinned typehash', () => {
    const encoded = `ForwardRequest(${FORWARD_REQUEST_TYPES.ForwardRequest.map(
      (field) => `${field.type} ${field.name}`,
    ).join(',')})`;
    expect(keccak256(toHex(encoded))).toBe(OZ_TYPEHASH);
  });

  it('keeps nonce before deadline', () => {
    const names = FORWARD_REQUEST_TYPES.ForwardRequest.map((field) => field.name);
    expect(names.indexOf('nonce')).toBeLessThan(names.indexOf('deadline'));
    expect(names).toEqual(['from', 'to', 'value', 'gas', 'nonce', 'deadline', 'data']);
  });

  it('types deadline as uint48, matching the on-chain struct', () => {
    const deadline = FORWARD_REQUEST_TYPES.ForwardRequest.find((f) => f.name === 'deadline');
    expect(deadline?.type).toBe('uint48');
  });
});

describe('forwarder ABI matches the struct we sign', () => {
  it('execute takes the 7-field ForwardRequestData tuple, without a nonce', () => {
    const execute = FORWARDER_ABI.find((entry) => entry.name === 'execute');
    const components = execute?.inputs[0]?.components?.map((c) => c.name);
    // `nonce` is read from storage on-chain, so it is signed but NOT passed.
    expect(components).toEqual(['from', 'to', 'value', 'gas', 'deadline', 'data', 'signature']);
  });

  it('exposes nonces() for the replay check', () => {
    const nonces = FORWARDER_ABI.find((entry) => entry.name === 'nonces');
    expect(nonces?.stateMutability).toBe('view');
    expect(nonces?.inputs[0]?.type).toBe('address');
  });
});

describe('a signature is bound to the pinned domain', () => {
  it('produces a different digest under a different domain name', async () => {
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    );
    const verifyingContract: Address = getAddress(
      '0x1111111111111111111111111111111111111111',
    );
    const message = {
      from: account.address,
      to: getAddress('0x2222222222222222222222222222222222222222'),
      value: 0n,
      gas: 200_000n,
      nonce: 0n,
      deadline: 1_800_000_000,
      data: '0x1234abcd' as const,
    };

    const correct = await account.signTypedData({
      domain: forwarderDomain(31611, verifyingContract),
      types: FORWARD_REQUEST_TYPES,
      primaryType: 'ForwardRequest',
      message,
    });
    const wrongName = await account.signTypedData({
      domain: { name: 'Not Maren Forwarder', version: '1', chainId: 31611, verifyingContract },
      types: FORWARD_REQUEST_TYPES,
      primaryType: 'ForwardRequest',
      message,
    });

    // If these were equal, the domain would not be binding anything.
    expect(correct).not.toBe(wrongName);
  });
});
