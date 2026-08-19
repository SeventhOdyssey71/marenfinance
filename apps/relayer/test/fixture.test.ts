import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hashTypedData, recoverTypedDataAddress, type Hex, type TypedDataDomain } from 'viem';

import {
  FORWARD_REQUEST_TYPES,
  FORWARDER_DOMAIN_NAME,
  FORWARDER_DOMAIN_VERSION,
  forwarderDomain,
  parseForwardRequest,
} from '../src/forwarder.js';

/**
 * The shared EIP-712 fixture, checked from THIS side.
 *
 * `apps/web/src/lib/chain/relay.test.ts` reads the same file and runs the same
 * assertions against its own copy of the domain and the type list. The point is
 * mechanical: web and relayer each transcribe the forwarder's typed data, and a
 * transcription that drifts produces a digest the forwarder rejects — a failure that
 * would otherwise surface for the first time in production, after a relayer has already
 * paid the gas to discover it. Here it surfaces in a unit test on both sides at once.
 *
 * Nothing in this file may import from the web app, and nothing in the web test may
 * import from here. The JSON is the only shared thing, and it holds the answer rather
 * than the method, so agreeing with it is evidence and not tautology.
 */

interface Fixture {
  domain: { name: string; version: string; chainId: number; verifyingContract: Hex };
  types: typeof FORWARD_REQUEST_TYPES;
  primaryType: 'ForwardRequest';
  message: Record<string, string>;
  digest: Hex;
  signature: Hex;
  body: Record<string, string>;
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/forward-request.json', import.meta.url), 'utf8'),
) as Fixture;

/** The wire form is all decimal strings; the digest needs the real types back. */
function typedMessage(message: Record<string, string>) {
  return {
    from: message['from'] as Hex,
    to: message['to'] as Hex,
    value: BigInt(message['value']!),
    gas: BigInt(message['gas']!),
    nonce: BigInt(message['nonce']!),
    deadline: Number(message['deadline']!),
    data: message['data'] as Hex,
  };
}

describe('the shared ForwardRequest fixture', () => {
  it('rebuilds the fixture digest from this package’s own domain and types', () => {
    const domain = forwarderDomain(
      fixture.domain.chainId,
      fixture.domain.verifyingContract,
    ) as TypedDataDomain;

    expect(domain.name).toBe(FORWARDER_DOMAIN_NAME);
    expect(domain.version).toBe(FORWARDER_DOMAIN_VERSION);

    const digest = hashTypedData({
      domain,
      types: FORWARD_REQUEST_TYPES,
      primaryType: 'ForwardRequest',
      message: typedMessage(fixture.message),
    });
    expect(digest).toBe(fixture.digest);
  });

  it('agrees with the fixture on the struct fields and their ORDER', () => {
    // Order is consensus-critical: `nonce` before `deadline`. Compared as a list, not
    // as a set, because a set comparison would pass on a transposition.
    expect(FORWARD_REQUEST_TYPES.ForwardRequest.map((f) => `${f.name}:${f.type}`)).toEqual(
      fixture.types.ForwardRequest.map((f) => `${f.name}:${f.type}`),
    );
  });

  it('recovers the fixture signer from the fixture signature', async () => {
    const recovered = await recoverTypedDataAddress({
      domain: forwarderDomain(fixture.domain.chainId, fixture.domain.verifyingContract),
      types: FORWARD_REQUEST_TYPES,
      primaryType: 'ForwardRequest',
      message: typedMessage(fixture.message),
      signature: fixture.signature,
    });
    expect(recovered.toLowerCase()).toBe(fixture.message['from']!.toLowerCase());
  });

  it('accepts the fixture body through the real request schema', () => {
    // The same `.strict()` parse `POST /relay` runs. If the web client's serialiser ever
    // emits a ninth key or renames one, this is where it is caught.
    const parsed = parseForwardRequest(fixture.body);
    expect(parsed.value).toBe(0n);
    expect(parsed.nonce).toBe(BigInt(fixture.message['nonce']!));
    expect(parsed.deadline).toBe(BigInt(fixture.message['deadline']!));
    expect(parsed.data).toBe(fixture.message['data']);
  });
});
