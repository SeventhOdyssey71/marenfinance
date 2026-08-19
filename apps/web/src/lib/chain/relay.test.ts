import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  encodeFunctionData,
  getAddress,
  hashTypedData,
  parseEther,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from 'viem';

import { ExplainedError, explainError } from './errors';
import {
  buildForwardRequest,
  decodeRelayResponse,
  FORWARD_REQUEST_TYPES,
  FORWARDER_DOMAIN_NAME,
  FORWARDER_DOMAIN_VERSION,
  forwarderDomain,
  HUB_ALLOWED_FUNCTIONS,
  isRelayableCall,
  isStickyRefusal,
  MAX_RELAY_GAS,
  noteRelayerRefusal,
  normaliseUrl,
  postRelay,
  probeRelayer,
  RELAY_DEADLINE_SECONDS,
  relayFailureReason,
  relayGasLimit,
  relayRequestBody,
  resetRelayerHealth,
  selectorOf,
  shouldRelay,
  type RelayerHealth,
} from './relay';
import { marenPayAbi, marenVaultAbi } from './abis';

/**
 * The relayer client, tested against the relayer.
 *
 * THE FIRST BLOCK IS THE ONE THAT MATTERS. It reads
 * `apps/relayer/test/fixtures/forward-request.json` — the same file
 * `apps/relayer/test/fixture.test.ts` reads — and rebuilds its digest from THIS package's
 * domain and type constants. Nothing is imported across the two packages, so the only way
 * both suites pass is if both transcriptions of the forwarder's typed data agree with a
 * third artefact that was generated from the relayer's.
 *
 * That is a specific failure being designed out. A transposed field or a wrong domain
 * string produces a perfectly well-formed signature over the wrong digest, which no
 * amount of local testing catches: it fails at `recoverTypedDataAddress` inside the
 * relayer, on the first real sponsored transaction, after the gas has been committed.
 */

const FIXTURE_PATH = new URL(
  '../../../../relayer/test/fixtures/forward-request.json',
  import.meta.url,
);

interface Fixture {
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
  types: { ForwardRequest: Array<{ name: string; type: string }> };
  message: Record<string, string>;
  digest: Hex;
  signature: Hex;
  body: Record<string, string>;
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;

function typedMessage(message: Record<string, string>) {
  return {
    from: message['from'] as Address,
    to: message['to'] as Address,
    value: BigInt(message['value']!),
    gas: BigInt(message['gas']!),
    nonce: BigInt(message['nonce']!),
    deadline: Number(message['deadline']!),
    data: message['data'] as Hex,
  };
}

const USER = getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
const MAREN_PAY = getAddress('0xe475Ff919D54E055809f516E3bed8a5c7a101836');
const HUB = getAddress('0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C');

const accepting: RelayerHealth = { reachable: true, accepting: true, problems: [], at: 0 };
const refusing: RelayerHealth = {
  reachable: true,
  accepting: false,
  problems: ['daily BTC sponsorship budget is exhausted'],
  at: 0,
};

// ---------------------------------------------------------------------------

describe('EIP-712 construction, against the relayer’s own fixture', () => {
  it('rebuilds the fixture digest from this package’s domain and types', () => {
    const domain = forwarderDomain(fixture.domain.chainId, fixture.domain.verifyingContract);
    expect(domain.name).toBe(FORWARDER_DOMAIN_NAME);
    expect(domain.version).toBe(FORWARDER_DOMAIN_VERSION);
    expect(domain).toEqual(fixture.domain);

    const digest = hashTypedData({
      domain,
      types: FORWARD_REQUEST_TYPES,
      primaryType: 'ForwardRequest',
      message: typedMessage(fixture.message),
    });
    expect(digest).toBe(fixture.digest);
  });

  it('agrees on the struct fields and their order, nonce before deadline', () => {
    expect(FORWARD_REQUEST_TYPES.ForwardRequest.map((f) => `${f.name}:${f.type}`)).toEqual(
      fixture.types.ForwardRequest.map((f) => `${f.name}:${f.type}`),
    );
    // Stated separately, because a list comparison against a drifted fixture would agree
    // with the drift. This is the invariant OpenZeppelin's typehash encodes.
    const names = FORWARD_REQUEST_TYPES.ForwardRequest.map((f) => f.name);
    expect(names.indexOf('nonce')).toBeLessThan(names.indexOf('deadline'));
  });

  it('recovers the fixture signer from the fixture signature', async () => {
    const recovered = await recoverTypedDataAddress({
      domain: forwarderDomain(fixture.domain.chainId, fixture.domain.verifyingContract),
      types: FORWARD_REQUEST_TYPES,
      primaryType: 'ForwardRequest',
      message: typedMessage(fixture.message),
      signature: fixture.signature,
    });
    expect(recovered).toBe(USER);
  });

  it('serialises to exactly the fixture body', () => {
    const body = relayRequestBody(typedMessage(fixture.message), fixture.signature);
    expect(body).toEqual(fixture.body);
    // `.strict()` on the relayer side means a ninth key is a 400. Eight, always.
    expect(Object.keys(body).sort()).toEqual([
      'data',
      'deadline',
      'from',
      'gas',
      'nonce',
      'signature',
      'to',
      'value',
    ]);
    // Every integer is a base-10 string. A bigint cannot survive JSON.stringify, and a
    // hex-encoded number is not what `uintString` accepts.
    for (const key of ['value', 'gas', 'nonce', 'deadline']) {
      expect(body[key]).toMatch(/^[0-9]+$/);
    }
  });
});

describe('buildForwardRequest', () => {
  const base = {
    from: USER,
    to: MAREN_PAY,
    data: '0xdeadbeef' as Hex,
    gas: 250_000n,
    nonce: 3n,
    nowSeconds: 1_770_000_000,
  };

  it('pins value at zero, which is the only value the hub will forward', () => {
    expect(buildForwardRequest(base).value).toBe(0n);
  });

  it('puts the deadline a bounded distance ahead, inside the relayer’s ceiling', () => {
    const built = buildForwardRequest(base);
    expect(built.deadline).toBe(base.nowSeconds + RELAY_DEADLINE_SECONDS);
    // The relayer refuses anything more than RELAYER_MAX_DEADLINE_SECONDS (3600) out
    // with DEADLINE_TOO_FAR, after the user has already signed.
    expect(RELAY_DEADLINE_SECONDS).toBeLessThan(3600);
  });

  it('clamps gas to the cap the relayer would refuse above', () => {
    expect(buildForwardRequest({ ...base, gas: 9_000_000n }).gas).toBe(MAX_RELAY_GAS);
  });

  it('refuses to build a request with no gas rather than sign a doomed one', () => {
    expect(() => buildForwardRequest({ ...base, gas: 0n })).toThrow(/positive gas/);
  });

  it('checksums the addresses it was handed', () => {
    const built = buildForwardRequest({ ...base, from: USER.toLowerCase() as Address });
    expect(built.from).toBe(USER);
  });
});

describe('what the hub will forward', () => {
  it('never relays a payable call, allowlist or no allowlist', () => {
    // MarenVault.deposit is payable; the hub reverts ValueNotRelayable. It is refused on
    // the ground that actually applies, before any list is consulted.
    expect(
      isRelayableCall({ target: 'marenVault', functionName: 'deposit', carriesValue: true }),
    ).toBe(false);
    expect(
      isRelayableCall({ target: 'marenVault', functionName: 'borrow', carriesValue: true }),
    ).toBe(false);
  });

  it('mirrors the deploy script’s allowlist for the calls this app makes', () => {
    const relayable: Array<[Parameters<typeof isRelayableCall>[0]['target'], string]> = [
      ['marenVault', 'borrow'],
      ['marenVault', 'repay'],
      ['marenVault', 'withdraw'],
      ['marenPay', 'pay'],
      ['marenPay', 'payToHandle'],
      ['marenPay', 'createRequest'],
      ['marenRegistry', 'commit'],
      ['marenRegistry', 'register'],
    ];
    for (const [target, functionName] of relayable) {
      expect(isRelayableCall({ target, functionName, carriesValue: false })).toBe(true);
    }
  });

  it('does not claim to relay what the deploy script leaves off', () => {
    // MarenEarn is absent from _allowlistRelayableCalls entirely, and so is
    // MarenPay.createLink. Claiming either would be sponsorship the hub then reverts.
    expect(HUB_ALLOWED_FUNCTIONS.marenEarn).toEqual([]);
    expect(
      isRelayableCall({ target: 'marenEarn', functionName: 'deposit', carriesValue: false }),
    ).toBe(false);
    expect(
      isRelayableCall({ target: 'marenEarn', functionName: 'withdraw', carriesValue: false }),
    ).toBe(false);
    expect(
      isRelayableCall({ target: 'marenPay', functionName: 'createLink', carriesValue: false }),
    ).toBe(false);
    expect(
      isRelayableCall({ target: 'marenVault', functionName: 'deposit', carriesValue: false }),
    ).toBe(false);
    expect(
      isRelayableCall({
        target: 'marenVault',
        functionName: 'depositAndBorrow',
        carriesValue: false,
      }),
    ).toBe(false);
  });

  it('the selectors the app encodes are the ones the allowlist names', () => {
    // Not a tautology: this encodes real calldata through the app's own ABIs and reads
    // the selector back, so a signature change in packages/contracts moves this.
    const pay = encodeFunctionData({
      abi: marenPayAbi,
      functionName: 'pay',
      args: [USER, parseEther('10'), 'lunch'],
    });
    expect(selectorOf(pay)).toBe(fixture.message['data']!.slice(0, 10));

    const borrow = encodeFunctionData({
      abi: marenVaultAbi,
      functionName: 'borrow',
      args: [parseEther('10'), USER, USER],
    });
    expect(selectorOf(borrow)).toMatch(/^0x[0-9a-f]{8}$/);
  });
});

describe('the routing decision', () => {
  it('self-submits when no relayer URL is configured, which is the default', () => {
    expect(shouldRelay({ url: null, health: accepting, relayable: true })).toBe(false);
    expect(normaliseUrl(undefined)).toBeNull();
    expect(normaliseUrl('   ')).toBeNull();
    expect(normaliseUrl('https://relay.example.com/')).toBe('https://relay.example.com');
  });

  /**
   * A relayer URL that is not a transport worth signing over is the same as no relayer.
   * What crosses that connection is a `ForwardRequest`: the signature covers every field,
   * so nobody can alter it, but an observer on a plain-HTTP hop reads the user's address,
   * the target, the amount and the memo, and can replay it to the hub inside the deadline.
   * Refusing the URL means `shouldRelay` is false and the screen says the user pays,
   * which is the honest end state for a misconfiguration.
   */
  it('treats a plaintext relayer URL as no relayer at all', () => {
    expect(normaliseUrl('http://relay.example.com')).toBeNull();
    expect(normaliseUrl('ftp://relay.example.com')).toBeNull();
    expect(normaliseUrl('javascript:alert(1)')).toBeNull();
    expect(
      shouldRelay({
        url: normaliseUrl('http://relay.example.com'),
        health: accepting,
        relayable: true,
      }),
    ).toBe(false);
  });

  it('keeps the two shapes DEPLOY.md actually tells an operator to use', () => {
    // A same-origin path, because the relayer sets no CORS headers and must be proxied.
    expect(normaliseUrl('/api/relayer/')).toBe('/api/relayer');
    // And plain HTTP to localhost, for `pnpm dev`.
    expect(normaliseUrl('http://localhost:8787')).toBe('http://localhost:8787');
    expect(normaliseUrl('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787');
  });

  it('self-submits while the health probe has not answered', () => {
    expect(shouldRelay({ url: 'https://r.test', health: null, relayable: true })).toBe(false);
  });

  it('self-submits when the relayer says it is not accepting', () => {
    expect(shouldRelay({ url: 'https://r.test', health: refusing, relayable: true })).toBe(false);
  });

  it('self-submits a payable action even against a healthy relayer', () => {
    expect(shouldRelay({ url: 'https://r.test', health: accepting, relayable: false })).toBe(false);
  });

  it('relays only when all three hold at once', () => {
    expect(shouldRelay({ url: 'https://r.test', health: accepting, relayable: true })).toBe(true);
  });
});

describe('the health probe', () => {
  beforeEach(() => resetRelayerHealth());

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('reports accepting only when the body AND the status agree', async () => {
    const health = await probeRelayer('https://r.test', {
      fetchImpl: async () => jsonResponse(200, { ok: true, accepting: true, problems: [] }),
    });
    expect(health).toMatchObject({ reachable: true, accepting: true });
  });

  it('does not route at a relayer whose 503 a proxy rewrote to 200', async () => {
    const health = await probeRelayer('https://r.test', {
      fetchImpl: async () =>
        new Response(JSON.stringify({ accepting: true }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    });
    expect(health.accepting).toBe(false);
  });

  it('treats a 503 with problems as not accepting, and keeps the problems', async () => {
    const health = await probeRelayer('https://r.test', {
      fetchImpl: async () =>
        jsonResponse(503, {
          accepting: false,
          problems: ['daily BTC sponsorship budget is exhausted'],
        }),
    });
    expect(health.accepting).toBe(false);
    expect(health.reachable).toBe(true);
    expect(health.problems).toEqual(['daily BTC sponsorship budget is exhausted']);
  });

  it('treats an unreachable relayer, a timeout and unparseable JSON all as absent', async () => {
    const cases: Array<typeof fetch> = [
      (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
      (async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }) as unknown as typeof fetch,
      (async () =>
        new Response('<html>gateway</html>', { status: 200 })) as unknown as typeof fetch,
    ];
    for (const fetchImpl of cases) {
      resetRelayerHealth();
      const health = await probeRelayer('https://r.test', { fetchImpl });
      expect(health).toMatchObject({ reachable: false, accepting: false });
    }
  });

  it('answers null-URL without a request at all', async () => {
    let called = 0;
    const health = await probeRelayer(null, {
      fetchImpl: (async () => {
        called += 1;
        return jsonResponse(200, { accepting: true });
      }) as unknown as typeof fetch,
    });
    expect(called).toBe(0);
    expect(health.accepting).toBe(false);
  });

  it('caches, so a dozen screens mounting at once are one request', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse(200, { accepting: true, problems: [] });
    }) as unknown as typeof fetch;

    await Promise.all([
      probeRelayer('https://r.test', { fetchImpl }),
      probeRelayer('https://r.test', { fetchImpl }),
      probeRelayer('https://r.test', { fetchImpl }),
    ]);
    await probeRelayer('https://r.test', { fetchImpl });
    expect(calls).toBe(1);
  });

  it('asks again once the cache window has passed', async () => {
    let calls = 0;
    let clock = 1_000_000;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse(200, { accepting: true, problems: [] });
    }) as unknown as typeof fetch;
    const now = () => clock;

    await probeRelayer('https://r.test', { fetchImpl, now });
    clock += 60_000;
    await probeRelayer('https://r.test', { fetchImpl, now });
    expect(calls).toBe(2);
  });

  it('goes cold the moment a routed request is refused', async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, { accepting: true, problems: [] })) as unknown as typeof fetch;
    const health = await probeRelayer('https://r.test', { fetchImpl });
    expect(health.accepting).toBe(true);

    noteRelayerRefusal(health.at);
    const after = await probeRelayer('https://r.test', {
      fetchImpl: (async () => {
        throw new Error('must not be asked again inside the window');
      }) as unknown as typeof fetch,
      now: () => health.at,
    });
    expect(after.accepting).toBe(false);
  });
});

describe('error mapping', () => {
  it('turns every relayer code into copy that says nothing was submitted', () => {
    const codes = [
      'MALFORMED_REQUEST',
      'INVALID_SIGNATURE',
      'SIGNER_MISMATCH',
      'NONCE_MISMATCH',
      'DUPLICATE_REQUEST_IN_FLIGHT',
      'REQUEST_EXPIRED',
      'DEADLINE_TOO_FAR',
      'TARGET_NOT_ALLOWED',
      'SELECTOR_NOT_ALLOWED',
      'CALLDATA_UNDECODABLE',
      'VALUE_NOT_PERMITTED',
      'GAS_LIMIT_TOO_HIGH',
      'SPONSORSHIP_FEE_REQUIRED',
      'SPONSORSHIP_UNAVAILABLE',
      'FEE_BELOW_REQUIRED',
      'ADDRESS_RATE_LIMIT',
      'IP_RATE_LIMIT',
      'GLOBAL_DAILY_BUDGET_EXHAUSTED',
      'SIMULATION_REVERTED',
      'SUBMISSION_FAILED',
      'RELAYER_UNDERFUNDED',
      'RELAYER_NOT_ACCEPTING',
      'RELAYER_SHUTTING_DOWN',
      'STORE_UNAVAILABLE',
      'NOT_FOUND',
      'UPSTREAM_ERROR',
    ];
    for (const code of codes) {
      const reason = relayFailureReason(402, { error: code, detail: 'operator prose', meta: {} });
      expect(reason.name).toBe(code);
      expect(reason.title.length).toBeGreaterThan(0);
      // Two promises in every branch: it did not happen, and nothing was charged.
      expect(reason.detail).toMatch(/[Nn]othing was submitted/);
      // The relayer's own detail is written for a log, not a person. It is never shown.
      expect(reason.detail).not.toContain('operator prose');
    }
  });

  it('never tells a user their money may have moved when it provably did not', () => {
    const reason = relayFailureReason(429, { error: 'ADDRESS_RATE_LIMIT', detail: '', meta: {} });
    expect(reason.detail).toMatch(/no gas was spent|Nothing was submitted/);
  });

  it('has a branch for a code it has never heard of', () => {
    const reason = relayFailureReason(418, { error: 'SOMETHING_NEW', detail: '', meta: {} });
    expect(reason.name).toBe('SOMETHING_NEW');
    expect(reason.detail).toContain('418');
  });

  it('separates refusals that should stop routing from ones about this request only', () => {
    expect(isStickyRefusal('SPONSORSHIP_UNAVAILABLE')).toBe(true);
    expect(isStickyRefusal('RELAYER_NOT_ACCEPTING')).toBe(true);
    expect(isStickyRefusal('GLOBAL_DAILY_BUDGET_EXHAUSTED')).toBe(true);
    // A stale nonce says nothing about the service.
    expect(isStickyRefusal('NONCE_MISMATCH')).toBe(false);
    expect(isStickyRefusal('SIMULATION_REVERTED')).toBe(false);
    expect(isStickyRefusal(null)).toBe(false);
  });

  it('reaches the transaction sheet through the same path a revert does', () => {
    const reason = relayFailureReason(402, {
      error: 'SPONSORSHIP_UNAVAILABLE',
      detail: '',
      meta: {},
    });
    // explainError is what every screen already calls. An ExplainedError comes back out
    // of it unchanged, so there is no second rendering path for relayer failures.
    expect(explainError(new ExplainedError(reason))).toEqual(reason);
  });
});

describe('decoding a /relay response', () => {
  const accepted = {
    hash: `0x${'ab'.repeat(32)}`,
    state: 'submitted',
    success: false,
    payer: USER,
    nonce: 41,
    sponsorship: 'free-tier',
    freeActionsRemaining: 24,
    function: 'marenPay.pay',
    statusUrl: `/status/0x${'ab'.repeat(32)}`,
  };

  it('accepts a 202 with a hash, and only a 202', () => {
    const decoded = decodeRelayResponse(202, accepted);
    expect('failure' in decoded).toBe(false);
    expect((decoded as typeof accepted).hash).toBe(accepted.hash);
  });

  it('refuses a 200 that carries the same body', () => {
    // The relayer answers 202 deliberately: the transaction is broadcast, not delivered.
    // A 200 from this endpoint is something other than the relayer answering.
    const decoded = decodeRelayResponse(200, accepted);
    expect('failure' in decoded).toBe(true);
  });

  it('refuses a 202 with no usable hash rather than report a submission', () => {
    expect('failure' in decodeRelayResponse(202, { state: 'submitted' })).toBe(true);
    expect('failure' in decodeRelayResponse(202, { hash: 'not-a-hash' })).toBe(true);
    expect('failure' in decodeRelayResponse(202, null)).toBe(true);
  });

  /**
   * THE HASH IS WHERE SCEPTICISM STOPS, SO IT HAS TO BE OUR HASH.
   *
   * `useTxRunner` hands whatever comes back to `confirmTransaction`, which reads a receipt
   * and reports what it finds. So a relayer answering 202 with SOMEBODY ELSE'S already
   * confirmed transaction hash renders as this action succeeding, on a screen that also
   * says Maren paid for it. Neither is true. `payer` is the only field tying the answer to
   * the request, and it is now checked rather than displayed.
   */
  it('refuses a 202 that names a different payer than the one who signed', () => {
    const someoneElse = {
      ...accepted,
      payer: '0x000000000000000000000000000000000000dEaD',
    };
    const decoded = decodeRelayResponse(202, someoneElse, USER);
    expect('failure' in decoded).toBe(true);
    expect((decoded as { code: string }).code).toBe('RELAYER_ANSWER_UNRECOGNISED');
  });

  it('accepts a 202 that names the signer, whatever the case', () => {
    const decoded = decodeRelayResponse(202, { ...accepted, payer: USER.toLowerCase() }, USER);
    expect('failure' in decoded).toBe(false);
  });

  it('refuses a 202 whose state is not the relayer word for broadcast', () => {
    // `state` is `'submitted'` and nothing else. A body claiming `'confirmed'` is not the
    // relayer, which never makes that judgement — see `receipt.ts` and R15.
    expect('failure' in decodeRelayResponse(202, { ...accepted, state: 'confirmed' }, USER)).toBe(
      true,
    );
  });
});

describe('postRelay', () => {
  beforeEach(() => resetRelayerHealth());

  const body = { ...fixture.body };

  it('posts the eight-field body to /relay and returns the broadcast hash', async () => {
    let seenUrl = '';
    let seenBody: unknown = null;
    const hash = `0x${'cd'.repeat(32)}`;
    const result = await postRelay('https://r.test', body, {
      fetchImpl: (async (url: string, init: RequestInit) => {
        seenUrl = url;
        seenBody = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({
            hash,
            state: 'submitted',
            success: false,
            // The real service always names the payer it recovered from the signature.
            payer: body.from,
            sponsorship: 'free-tier',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch,
    });
    expect(seenUrl).toBe('https://r.test/relay');
    expect(seenBody).toEqual(body);
    expect(result.hash).toBe(hash);
  });

  it('throws explained copy on a refusal, and stops routing on a sticky one', async () => {
    await probeRelayer('https://r.test', {
      fetchImpl: (async () =>
        new Response(JSON.stringify({ accepting: true }), {
          status: 200,
        })) as unknown as typeof fetch,
    });

    await expect(
      postRelay('https://r.test', body, {
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              error: 'SPONSORSHIP_UNAVAILABLE',
              detail: 'free tier spent',
              meta: {},
            }),
            { status: 402, headers: { 'content-type': 'application/json' } },
          )) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(ExplainedError);

    // The next render must stop claiming Maren pays. Asking again is answered from the
    // knocked-down cache without a request.
    const after = await probeRelayer('https://r.test', {
      fetchImpl: (async () => {
        throw new Error('must not be asked again');
      }) as unknown as typeof fetch,
    });
    expect(after.accepting).toBe(false);
  });

  it('says plainly that a request which never left the device submitted nothing', async () => {
    const error = await postRelay('https://r.test', body, {
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ExplainedError);
    expect((error as ExplainedError).reason.detail).toMatch(/never left this device/);
    expect((error as ExplainedError).reason.detail).toMatch(/no gas was spent/);
  });

  it('does not knock down health for a refusal about this one request', async () => {
    await probeRelayer('https://r.test', {
      fetchImpl: (async () =>
        new Response(JSON.stringify({ accepting: true }), {
          status: 200,
        })) as unknown as typeof fetch,
    });
    await expect(
      postRelay('https://r.test', body, {
        fetchImpl: (async () =>
          new Response(JSON.stringify({ error: 'NONCE_MISMATCH', detail: '', meta: {} }), {
            status: 409,
          })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(ExplainedError);

    const after = await probeRelayer('https://r.test', {
      fetchImpl: (async () => {
        throw new Error('must not be asked again inside the cache window');
      }) as unknown as typeof fetch,
    });
    expect(after.accepting).toBe(true);
  });
});

describe('the gas a user is asked to sign for', () => {
  it('pads a direct estimate to cover the hub frame and the 63/64 check', () => {
    expect(relayGasLimit(100_000n)).toBe(210_000n);
  });

  it('clamps at the cap rather than signing a request the relayer would refuse', () => {
    expect(relayGasLimit(4_000_000n)).toBe(MAX_RELAY_GAS);
  });
});

describe('the hub address the app signs against', () => {
  it('is MarenRelayHub, which is the only forwarder the contracts trust', () => {
    // packages/sdk names it `marenForwarder`, and the standalone MarenForwarder is
    // deliberately not deployed: two trusted forwarders would be two ways to forge a
    // sender. The fixture's verifyingContract is that address.
    expect(fixture.domain.verifyingContract).toBe(HUB);
  });
});
