import { describe, expect, it } from 'vitest';
import { encodeFunctionData, getAddress, parseEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { ExplainedError } from './errors';
import { marenPayAbi } from './abis';
import {
  buildForwardRequest,
  FORWARD_REQUEST_TYPES,
  forwarderDomain,
  postRelay,
  probeRelayer,
  relayGasLimit,
  relayRequestBody,
  resetRelayerHealth,
  shouldRelay,
} from './relay';

/**
 * THE INTEGRATION PROOF: this client code, against a real relayer process.
 *
 * Everything else in `relay.test.ts` is the client talking to a stub. This talks to
 * `apps/relayer` actually running and listening, reached over HTTP, with a real EIP-712
 * signature from a real key and a real forwarder nonce read from Mezo matsnet. It exists
 * because the failure this whole wiring is exposed to is not a logic error that a unit
 * test would catch. It is a digest mismatch: a signature that is perfectly well formed
 * over the wrong bytes, which fails for the first time inside a relayer, in production,
 * after the gas has been committed.
 *
 * WHAT GETTING PAST STAGE 4 PROVES. The relay pipeline in `src/service.ts` is ordered:
 * posture, shape, admission, identity, policy, simulation, reservation, submission. A
 * response that names a failure at or after POLICY is a response that got through:
 *
 *   - shape     — the eight fields, all decimal strings, `.strict()` satisfied
 *   - admission — value zero, gas under the cap, target and selector on the allowlist,
 *                 and the calldata decodable against the registry's ABI
 *   - identity  — `recoverTypedDataAddress` over the relayer's own domain and types
 *                 returned this signer, and the signed nonce equalled
 *                 `MarenRelayHub.nonces(from)` on-chain
 *
 * Identity is the one that matters. It cannot pass unless the digest the web app built
 * is byte-identical to the digest the relayer rebuilt, which is the drift this pair of
 * packages is most exposed to.
 *
 * WHAT IT DOES NOT PROVE. Nothing lands on-chain. The throwaway hot key holds no BTC, so
 * the relayer refuses at its balance gate before simulation, and the signing account
 * holds no MUSD, so the payment would revert in simulation even if it did not. Both are
 * refusals AFTER identity, and both are exactly what this asserts: a typed error the
 * client maps to copy, with nothing broadcast.
 *
 * SKIPPED unless `RELAYER_PROOF_URL` names a running relayer, so an ordinary `pnpm test`
 * does not depend on a process or on Mezo being reachable. To run it:
 *
 *   CI=true RELAYER_NETWORK=testnet \
 *     RELAYER_FORWARDER_ADDRESS=0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C \
 *     RELAYER_MAX_DAILY_SPONSORED_BTC=0.001 \
 *     RELAYER_PRIVATE_KEY=<a throwaway dev key> PORT=8899 \
 *     pnpm --filter @maren/relayer dev
 *
 *   RELAYER_PROOF_URL=http://localhost:8899 \
 *     pnpm --filter @maren/web exec vitest run src/lib/chain/relay.live.test.ts
 *
 * The relayer's own log is the other half of the evidence. A passing run writes
 * `relay.admitted` with `signerKind: "eoa"`, the RECOVERED payer, and
 * `fn: "marenPay.pay"` — it recovered this account from this signature and matched the
 * nonce it read from the chain.
 */

const PROOF_URL = process.env['RELAYER_PROOF_URL'] ?? '';
const live = describe.skipIf(PROOF_URL === '');

/** anvil account #1. A published test key that has never held anything. */
const USER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const account = privateKeyToAccount(USER_KEY);

const CHAIN_ID = 31611;
const HUB: Address = getAddress('0x22cC1Adfb0C91D9359746dE3F7E8cB7F2B8eA98C');
const MAREN_PAY: Address = getAddress('0xe475Ff919D54E055809f516E3bed8a5c7a101836');

/** Whatever the relayer says the current forwarder nonce is. Read from its own error. */
async function currentNonce(url: string): Promise<bigint> {
  const probe = await sendPay(url, 0n);
  if (probe.kind === 'nonce-mismatch') return probe.expected;
  return 0n;
}

type Outcome =
  | { kind: 'accepted'; hash: string }
  | { kind: 'nonce-mismatch'; expected: bigint }
  | { kind: 'refused'; code: string | null; title: string; detail: string };

async function sendPay(url: string, nonce: bigint): Promise<Outcome> {
  const data = encodeFunctionData({
    abi: marenPayAbi,
    functionName: 'pay',
    args: [getAddress('0x5555555555555555555555555555555555555555'), parseEther('1'), 'proof'],
  });

  const message = buildForwardRequest({
    from: account.address,
    to: MAREN_PAY,
    data,
    gas: relayGasLimit(120_000n),
    nonce,
    nowSeconds: Math.floor(Date.now() / 1000),
  });

  const signature = await account.signTypedData({
    domain: forwarderDomain(CHAIN_ID, HUB),
    types: FORWARD_REQUEST_TYPES,
    primaryType: 'ForwardRequest',
    message,
  });

  try {
    const accepted = await postRelay(url, relayRequestBody(message, signature), {
      timeoutMs: 30_000,
    });
    return { kind: 'accepted', hash: accepted.hash };
  } catch (error) {
    if (!(error instanceof ExplainedError)) throw error;
    // NONCE_MISMATCH carries the chain's answer in `meta.expected`, which the client maps
    // away. Re-read it from the wire so the second attempt can use the real nonce.
    const raw = await fetch(`${url}/relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(relayRequestBody(message, signature)),
    });
    const body = (await raw.json()) as { error?: string; meta?: { expected?: string } };
    if (body.error === 'NONCE_MISMATCH' && body.meta?.expected !== undefined) {
      return { kind: 'nonce-mismatch', expected: BigInt(body.meta.expected) };
    }
    return {
      kind: 'refused',
      code: error.reason.name,
      title: error.reason.title,
      detail: error.reason.detail,
    };
  }
}

live('the web client against a running relayer', () => {
  it('probes /healthz and gets a real answer', async () => {
    resetRelayerHealth();
    const health = await probeRelayer(PROOF_URL, { force: true, timeoutMs: 10_000 });
    expect(health.reachable).toBe(true);
    // Whether it is ACCEPTING depends on whether the hot key is funded, which it is not
    // in this proof. Either way the routing decision is derived from it, not asserted
    // against a stub.
    expect(typeof health.accepting).toBe('boolean');
    expect(shouldRelay({ url: PROOF_URL, health, relayable: true })).toBe(health.accepting);
  });

  it('gets a signed ForwardRequest past shape, admission and identity', async () => {
    resetRelayerHealth();
    const nonce = await currentNonce(PROOF_URL);
    resetRelayerHealth();
    const outcome = await sendPay(PROOF_URL, nonce);

    // A hash would mean the relayer really broadcast for us, which needs a funded hot
    // key. Accept it if the key happens to be funded; the interesting case is the other
    // one.
    if (outcome.kind === 'accepted') {
      expect(outcome.hash).toMatch(/^0x[0-9a-f]{64}$/);
      return;
    }

    expect(outcome.kind).toBe('refused');
    if (outcome.kind !== 'refused') return;

    // The codes that live AT OR AFTER stage 5. Getting one of them means the signature
    // recovered to this account and the signed nonce matched the chain: the digest the
    // web app built and the digest the relayer rebuilt are the same bytes.
    expect([
      'SPONSORSHIP_UNAVAILABLE',
      'SPONSORSHIP_FEE_REQUIRED',
      'FEE_BELOW_REQUIRED',
      'ADDRESS_RATE_LIMIT',
      'IP_RATE_LIMIT',
      'GLOBAL_DAILY_BUDGET_EXHAUSTED',
      'SIMULATION_REVERTED',
      'RELAYER_UNDERFUNDED',
      'SUBMISSION_FAILED',
    ]).toContain(outcome.code);

    // And the refusal arrives as finished copy, not as a code the sheet would print raw.
    expect(outcome.title.length).toBeGreaterThan(0);
    expect(outcome.detail).toMatch(/[Nn]othing was submitted/);
  }, 60_000);

  it('is refused at admission for a target the hub does not allowlist', async () => {
    resetRelayerHealth();
    const message = buildForwardRequest({
      from: account.address,
      to: getAddress('0x9999999999999999999999999999999999999999'),
      data: '0xdeadbeef',
      gas: 200_000n,
      nonce: 0n,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    const signature = await account.signTypedData({
      domain: forwarderDomain(CHAIN_ID, HUB),
      types: FORWARD_REQUEST_TYPES,
      primaryType: 'ForwardRequest',
      message,
    });

    const error = await postRelay(PROOF_URL, relayRequestBody(message, signature), {
      timeoutMs: 20_000,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ExplainedError);
    expect((error as ExplainedError).reason.name).toBe('TARGET_NOT_ALLOWED');
    expect((error as ExplainedError).reason.detail).toMatch(/[Nn]othing was submitted/);
  }, 30_000);

  it('is refused at shape for a body carrying a funding source', async () => {
    // R1, from the client's side of the wire: the relayer names the offending field and
    // this client turns that into copy rather than printing the relayer's own prose.
    const response = await fetch(`${PROOF_URL}/relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: account.address,
        to: MAREN_PAY,
        value: '0',
        gas: '200000',
        nonce: '0',
        deadline: String(Math.floor(Date.now() / 1000) + 600),
        data: '0xdeadbeef',
        signature: `0x${'00'.repeat(65)}`,
        payer: account.address,
      }),
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('MALFORMED_REQUEST');
  }, 30_000);
});
