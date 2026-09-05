import { NextResponse, type NextRequest } from 'next/server';
import { resolveNetwork } from '@maren/sdk';
import type { Address } from 'viem';

import {
  buildDemoRequirements,
  buildPaymentRequired,
  decodeBase64Json,
  encodeBase64Json,
  facilitatorPost,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  requirementsMatch,
  X402_DEMO_NETWORK,
  type X402PaymentPayload,
  type X402SettleResponse,
  type X402VerifyResponse,
} from '@/lib/x402/protocol';

/**
 * The merchant half of the x402 demo: one paid resource, priced at 0.01 MUSD on Mezo
 * testnet, settled through facilitator.vativ.io.
 *
 * The flow is the x402 v2 exact scheme, spoken directly:
 *
 *   1. GET with no PAYMENT-SIGNATURE header: 402, with the payment requirements base64
 *      encoded in the PAYMENT-REQUIRED header AND as the JSON body, so both a protocol
 *      client and a person with curl can read the offer.
 *   2. GET with a PAYMENT-SIGNATURE header: the payload's accepted terms are checked
 *      against OUR terms, then POSTed to the facilitator's /verify; if valid, /settle.
 *      Only a settle answer with `success: true` and a transaction hash unlocks the
 *      resource, and that hash is returned to the buyer verbatim.
 *
 * HONEST GATING. There is no default merchant address. Without NEXT_PUBLIC_X402_MERCHANT
 * this route answers 503 `not_configured` and the demo page says so — the same posture as
 * the relayer wiring, where an unset env var produces an honest absence rather than a
 * demo that silently pays a hardcoded stranger. Mezo mainnet is refused outright: this
 * demo never moves real funds.
 *
 * The route talks to the facilitator at request time, so it can never be static.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Settlement waits for on-chain confirmation inside the facilitator; give it room.
export const maxDuration = 60;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * The merchant's receiving address, or null — there is no default. `X402_MERCHANT` is a
 * plain server var read at request time, so it can be set or rotated without a rebuild;
 * `NEXT_PUBLIC_X402_MERCHANT` also works but is inlined at build time like every
 * NEXT_PUBLIC_ var. A malformed value counts as unset: a typo'd address must gate the
 * demo, never silently receive it.
 */
function merchantAddress(): Address | null {
  const raw = (process.env.X402_MERCHANT ?? process.env.NEXT_PUBLIC_X402_MERCHANT)?.trim() ?? '';
  return ADDRESS_RE.test(raw) ? (raw as Address) : null;
}

function json(status: number, body: unknown, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers });
}

export async function GET(request: NextRequest) {
  // The demo exists on testnet only. A mainnet deployment gets a refusal, not a paywall.
  if (resolveNetwork(process.env.NEXT_PUBLIC_MEZO_NETWORK) !== X402_DEMO_NETWORK) {
    return json(503, {
      ok: false,
      error: 'testnet_only',
      message: 'The x402 demo runs on Mezo testnet only.',
    });
  }

  const payTo = merchantAddress();
  if (!payTo) {
    return json(503, {
      ok: false,
      error: 'not_configured',
      message:
        'No merchant address is configured. Set X402_MERCHANT (or NEXT_PUBLIC_X402_MERCHANT) to the testnet address that should receive demo payments.',
    });
  }

  const resourceUrl = new URL(request.url).origin + '/api/x402/note';
  const requirements = buildDemoRequirements(payTo);

  const paymentRequired = (error?: string) => {
    const body = buildPaymentRequired(payTo, resourceUrl, error);
    return json(402, body, { [HEADER_PAYMENT_REQUIRED]: encodeBase64Json(body) });
  };

  const header = request.headers.get(HEADER_PAYMENT_SIGNATURE);
  if (!header) return paymentRequired();

  let payload: X402PaymentPayload;
  try {
    payload = decodeBase64Json<X402PaymentPayload>(header);
  } catch {
    return paymentRequired('malformed_payment_signature_header');
  }
  if (payload?.x402Version !== 2 || !payload.accepted || !payload.payload) {
    return paymentRequired('malformed_payment_payload');
  }

  // The facilitator is asked to verify OUR terms. A payload whose accepted block names a
  // different price, asset or recipient is refused before any network call.
  if (!requirementsMatch(payload.accepted, requirements)) {
    return paymentRequired('requirements_mismatch');
  }

  let verify: X402VerifyResponse;
  try {
    verify = await facilitatorPost<X402VerifyResponse>('verify', payload, requirements, 20_000);
  } catch {
    return json(502, {
      ok: false,
      error: 'facilitator_unreachable',
      message: 'The x402 facilitator did not answer the verification call.',
    });
  }
  if (!verify.isValid) {
    return paymentRequired(verify.invalidReason ?? 'payment_verification_failed');
  }

  let settle: X402SettleResponse;
  try {
    settle = await facilitatorPost<X402SettleResponse>('settle', payload, requirements, 45_000);
  } catch {
    return json(502, {
      ok: false,
      error: 'facilitator_unreachable',
      message: 'The x402 facilitator did not answer the settlement call.',
    });
  }
  if (!settle.success || !settle.transaction) {
    return paymentRequired(settle.errorReason ?? 'settlement_failed');
  }

  // Paid. The resource itself is deliberately tiny; the demo's product is the receipt.
  return json(
    200,
    {
      ok: true,
      note: {
        message: 'Paid. This response was unlocked by a 0.01 MUSD micropayment on Mezo testnet.',
        protocol: 'x402',
        servedAt: new Date().toISOString(),
      },
      // The settlement is repeated in the body for readability, but it is the same object
      // the PAYMENT-RESPONSE header carries: the facilitator's answer, nothing invented.
      settlement: {
        transaction: settle.transaction,
        network: settle.network ?? requirements.network,
        payer: settle.payer ?? null,
      },
    },
    { [HEADER_PAYMENT_RESPONSE]: encodeBase64Json(settle) },
  );
}
