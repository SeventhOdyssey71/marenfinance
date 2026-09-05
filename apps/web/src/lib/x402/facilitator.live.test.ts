import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import {
  buildDemoRequirements,
  buildPermit2Authorization,
  FACILITATOR_URL,
  permit2WitnessTypedData,
  X402_DEMO_CAIP2,
  type X402PaymentPayload,
  type X402VerifyResponse,
} from './protocol';

/**
 * THE INTEGRATION PROOF, x402 edition — this client code against the real facilitator.
 *
 * Opt-in (`X402_LIVE=1 pnpm exec vitest run src/lib/x402/facilitator.live.test.ts`)
 * because it makes real network calls. It never settles and never moves funds: the payer
 * is a throwaway key generated per run, holding nothing.
 *
 * What passing proves:
 *
 *   - /supported still lists the exact scheme on eip155:31611 with MUSD's `Mezo USD`
 *     EIP-712 domain and the eip2612GasSponsoring extension — the facts the protocol
 *     module hardcodes.
 *   - /verify accepts our hand-rolled PaymentPayload as WELL-FORMED: a structurally
 *     wrong payload dies in schema or signature parsing with a malformed-payload class
 *     of error, whereas ours must get far enough for the facilitator to inspect the
 *     account and refuse it for what it truly is: an empty wallet. `isValid: false`
 *     with a funds/allowance reason is therefore the PASSING outcome here.
 */
const LIVE = process.env.X402_LIVE === '1';
const live = describe.skipIf(!LIVE);

const MERCHANT = '0x54196397D6f01b48739dB3957257cB33cD341885' as const;

live('facilitator.vativ.io, read-only', () => {
  it('advertises exact/eip155:31611 with the Mezo USD domain', async () => {
    const res = await fetch(`${FACILITATOR_URL}/supported`, {
      signal: AbortSignal.timeout(15_000),
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      kinds: {
        scheme: string;
        network: string;
        extra?: { assets?: { symbol: string; eip712?: { name: string; version: string } }[] };
      }[];
      extensions?: string[];
    };
    const testnet = body.kinds.find((k) => k.scheme === 'exact' && k.network === X402_DEMO_CAIP2);
    expect(testnet).toBeDefined();
    const musd = testnet?.extra?.assets?.find((a) => a.symbol === 'MUSD');
    expect(musd?.eip712).toEqual({ name: 'Mezo USD', version: '1' });
    expect(body.extensions).toContain('eip2612GasSponsoring');
  }, 20_000);

  it('reads our hand-rolled payload as well-formed and refuses the empty wallet', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const requirements = buildDemoRequirements(MERCHANT);
    const auth = buildPermit2Authorization({ from: account.address, requirements });
    const signature = await account.signTypedData(permit2WitnessTypedData(auth));
    const payload: X402PaymentPayload = {
      x402Version: 2,
      accepted: requirements,
      payload: { signature, permit2Authorization: auth },
    };

    const res = await fetch(`${FACILITATOR_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: payload,
        paymentRequirements: requirements,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json()) as X402VerifyResponse;

    // A fresh key holds no MUSD, so a facilitator that fully parsed and checked the
    // payload MUST say invalid. What it must NOT say is that the payload was malformed.
    expect(body.isValid).toBe(false);
    expect(body.invalidReason ?? '').not.toMatch(/malformed|schema|unsupported/i);
    // The refusal should be about the account's funds or allowance, named explicitly.
    expect(body.invalidReason ?? '').toMatch(/balance|allowance|funds|insufficient/i);
  }, 30_000);
});
