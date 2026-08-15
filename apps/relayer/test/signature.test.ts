import { describe, expect, it } from 'vitest';
import { encodeFunctionData, getAddress, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildTestRelayer,
  FakeChain,
  MAREN_PAY,
  MAREN_PAY_2,
  payCalldata,
  signedRequest,
  tamper,
  USER,
  type ErrorBody,
} from './helpers.js';
import { RELAYABLE_FUNCTIONS } from '../src/registry.js';

/**
 * R1 — bind the funding source to the caller.
 * R2 — every economically meaningful parameter is inside the signed struct.
 *
 * Talise C1 let a relayer be induced to fund an attacker's deposit; Talise C7
 * left the relayer fee outside the signed payload so it could be swapped after
 * signing. Both reduce to the same test: change ANY field that moves value, and
 * the request must stop being valid.
 */

const PAY = RELAYABLE_FUNCTIONS.marenPay.find((f) => f.abi.name === 'pay')!;
const ATTACKER = getAddress('0xbadbadbadbadbadbadbadbadbadbadbadbadbad0');

describe('signature verification', () => {
  it('accepts a well-formed, correctly signed request', async () => {
    const relayer = await buildTestRelayer();
    const response = await relayer.post('/relay', await signedRequest());
    expect(response.status).toBe(202);
    const body = (await response.json()) as { payer: string; success: boolean; state: string };
    expect(getAddress(body.payer)).toBe(USER.address);
    // R15: a hash is not a success, and the response says so in as many words.
    expect(body.success).toBe(false);
    expect(body.state).toBe('submitted');
  });

  it.each([
    ['recipient', () => payCalldata(ATTACKER)],
    ['amount', () => payCalldata(undefined, parseEther('1000000'))],
    [
      'relayFee',
      () =>
        encodeFunctionData({
          abi: [PAY.abi],
          args: [getAddress('0x5555555555555555555555555555555555555555'), parseEther('10'), 'lunch', parseEther('99')],
        }),
    ],
  ])('rejects a request whose signed calldata was tampered with (%s)', async (_label, build) => {
    const relayer = await buildTestRelayer();
    const original = await signedRequest();
    const response = await relayer.post('/relay', tamper(original, { data: build() }));

    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error).toBe('SIGNER_MISMATCH');
    expect(relayer.chainFake.sent).toHaveLength(0);
    // Rejected before we spent an RPC call on simulation, let alone gas.
    expect(relayer.chainFake.simulations).toBe(0);
  });

  /**
   * REWRITTEN after review: the previous version of this test asserted only
   * `status !== 202` plus a tautology, so deleting the signer check entirely
   * still passed it — the subcases fell through to NONCE_MISMATCH or
   * SELECTOR_NOT_ALLOWED and looked like a pass. A test that survives the
   * deletion of the control it names is worse than no test.
   *
   * Each case below must now fail for the SPECIFIC reason that the recovered
   * signer no longer matches, which is only true if signature verification runs.
   * Note `to` is retargeted at a SECOND allowlisted MarenPay deployment so the
   * request still clears the target and selector allowlists and reaches the
   * signature check — otherwise the allowlist would mask it.
   */
  it.each([
    ['to', { to: MAREN_PAY_2 }],
    ['gas', { gas: '400000' }],
    ['deadline', { deadline: String(Math.floor(Date.now() / 1000) + 1200) }],
    ['nonce', { nonce: '0' }],
  ])('rejects a request whose %s was changed after signing', async (_field, changes) => {
    const relayer = await buildTestRelayer();
    // Signed at nonce 1, and the fake forwarder reports 1, so a nonce tamper is
    // a real change to the digest rather than a stale-nonce rejection.
    relayer.chainFake.nonces_.set(USER.address.toLowerCase(), 1n);
    const original = await signedRequest({ nonce: 1n, value: 0n, gas: 200_000n });
    const response = await relayer.post('/relay', tamper(original, changes as never));

    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error).toBe('SIGNER_MISMATCH');
    expect(relayer.chainFake.sent).toHaveLength(0);
    expect(relayer.chainFake.simulations).toBe(0);
  });

  it('the tamper cases above really do clear the allowlist first', async () => {
    // Guards the guard: if MAREN_PAY_2 ever stopped being allowlisted, the `to`
    // case would start passing for the wrong reason again.
    const relayer = await buildTestRelayer();
    relayer.chainFake.nonces_.set(USER.address.toLowerCase(), 1n);
    const untampered = await signedRequest({ nonce: 1n, to: MAREN_PAY_2 });
    expect((await relayer.post('/relay', untampered)).status).toBe(202);
  });

  it('rejects a signature from a different key for the same payload', async () => {
    const relayer = await buildTestRelayer();
    const other = privateKeyToAccount(
      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    );
    const mine = await signedRequest();
    const theirs = await signedRequest({ account: other });
    const response = await relayer.post('/relay', tamper(mine, { signature: theirs['signature']! }));

    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error).toBe('SIGNER_MISMATCH');
  });

  it('rejects a signature made for a different forwarder (domain separation)', async () => {
    const relayer = await buildTestRelayer();
    const body = await signedRequest({
      forwarder: getAddress('0x8888888888888888888888888888888888888888'),
    });
    const response = await relayer.post('/relay', body);
    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error).toBe('SIGNER_MISMATCH');
  });

  it('rejects a signature made for a different chain id (replay across networks)', async () => {
    const relayer = await buildTestRelayer();
    const response = await relayer.post('/relay', await signedRequest({ chainId: 31612 }));
    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error).toBe('SIGNER_MISMATCH');
  });

  it('rejects a replay: the signed nonce must equal the current forwarder nonce', async () => {
    const relayer = await buildTestRelayer();
    relayer.chainFake.nonces_.set(USER.address.toLowerCase(), 4n);
    const response = await relayer.post('/relay', await signedRequest({ nonce: 0n }));
    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorBody).error).toBe('NONCE_MISMATCH');
  });

  it('rejects an expired request', async () => {
    const relayer = await buildTestRelayer();
    const response = await relayer.post(
      '/relay',
      await signedRequest({ deadline: BigInt(Math.floor(Date.now() / 1000) - 5) }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error).toBe('REQUEST_EXPIRED');
  });

  it('rejects a deadline far enough out to stay replayable indefinitely', async () => {
    const relayer = await buildTestRelayer();
    const response = await relayer.post(
      '/relay',
      await signedRequest({ deadline: BigInt(Math.floor(Date.now() / 1000) + 86_400 * 365) }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).error).toBe('DEADLINE_TOO_FAR');
  });

  describe('R1: the payer may not be named by the caller', () => {
    it.each(['sponsor', 'payer', 'funder', 'feePayer', 'relayer', 'fundingSource'])(
      'rejects a body carrying a %s field',
      async (field) => {
        const relayer = await buildTestRelayer();
        const body = { ...(await signedRequest()), [field]: ATTACKER };
        const response = await relayer.post('/relay', body);

        expect(response.status).toBe(400);
        const error = (await response.json()) as ErrorBody;
        expect(error.error).toBe('MALFORMED_REQUEST');
        expect(error.detail).toMatch(/funding source/);
      },
    );

    it('rejects any unrecognised field, so a future field cannot be smuggled past', async () => {
      const relayer = await buildTestRelayer();
      const response = await relayer.post('/relay', {
        ...(await signedRequest()),
        gasSponsorOverride: '1',
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).error).toBe('MALFORMED_REQUEST');
    });

    it('accounts against the RECOVERED signer, not the claimed `from`', async () => {
      const relayer = await buildTestRelayer();
      // Claim to be someone else while signing with our own key.
      const body = tamper(await signedRequest(), { from: ATTACKER });
      const response = await relayer.post('/relay', body);
      expect(response.status).toBe(401);
      expect(((await response.json()) as ErrorBody).error).toBe('SIGNER_MISMATCH');

      // And the impersonated address's quota is untouched.
      const quota = (await (await relayer.get(`/quota/${ATTACKER}`)).json()) as {
        lifetimeActions: number;
      };
      expect(quota.lifetimeActions).toBe(0);
    });
  });

  describe('R3: the relayer never moves value', () => {
    it('refuses a request carrying native BTC value', async () => {
      const relayer = await buildTestRelayer();
      const response = await relayer.post(
        '/relay',
        await signedRequest({ value: parseEther('0.5') }),
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as ErrorBody).error).toBe('VALUE_NOT_PERMITTED');
      expect(relayer.chainFake.sent).toHaveLength(0);
    });
  });

  it('rejects a contract-account request the forwarder itself will not verify', async () => {
    const chain = new FakeChain();
    chain.contractAccounts.add(USER.address.toLowerCase());
    chain.forwarderVerifyResult = false;
    const relayer = await buildTestRelayer(undefined, chain);

    const response = await relayer.post('/relay', await signedRequest({ to: MAREN_PAY }));
    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).error).toBe('INVALID_SIGNATURE');
  });

  it('accepts a contract account when the forwarder verifies it (EIP-7702 path stays open)', async () => {
    const chain = new FakeChain();
    chain.contractAccounts.add(USER.address.toLowerCase());
    chain.forwarderVerifyResult = true;
    const relayer = await buildTestRelayer(undefined, chain);

    const response = await relayer.post('/relay', await signedRequest());
    expect(response.status).toBe(202);
  });
});
