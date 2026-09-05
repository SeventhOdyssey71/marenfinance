'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient, useReadContract, useSignTypedData } from 'wagmi';
import { formatMusd, musdTokenAbi, PERMIT2_ADDRESS, shortAddress } from '@maren/sdk';
import type { Address, Hash, Hex } from 'viem';

import { ConnectPrompt } from '@/components/app/connect-prompt';
import { Musd } from '@/components/app/money';
import {
  ActionButton,
  Info,
  Loading,
  Note,
  Panel,
  PanelBody,
  StatRow,
} from '@/components/app/primitives';
import { explorerTxUrl } from '@/components/app/tx';
import { ArrowUpRight, BoltIcon } from '@/components/ui/icons';
import {
  buildPermit2Authorization,
  decodeBase64Json,
  eip2612PermitTypedData,
  EIP2612_EXTENSION_KEY,
  encodeBase64Json,
  FACILITATOR_URL,
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  permit2WitnessTypedData,
  X402_DEMO_ASSET,
  X402_DEMO_CHAIN_ID,
  type Eip2612PermitInfo,
  type X402PaymentPayload,
  type X402PaymentRequired,
  type X402PaymentRequirements,
  type X402SettleResponse,
} from '@/lib/x402/protocol';
import { NETWORK, useDataSource } from '@/lib/data/source';

const RESOURCE_PATH = '/api/x402/note';

/**
 * The buyer half of the x402 demo.
 *
 * Honest-data discipline, stated as behaviour:
 *
 *   - The offer on screen is read from the merchant route's live 402 answer, never
 *     hardcoded. If the route says it is not configured, that is what renders.
 *   - "Settled" appears only after the facilitator returns `success: true` with a
 *     transaction hash, and that hash is linked to the explorer untouched.
 *   - "Confirmed on chain" appears only after this client's OWN RPC read of the receipt
 *     comes back successful. Until then the settlement is labelled as the facilitator's
 *     report, because that is exactly what it is.
 *   - The signature count is told in advance: one when a Permit2 allowance already
 *     exists, two on a first purchase (the extra one is the gas-sponsored EIP-2612
 *     permit). Nothing pretends the first run is one tap.
 */

// ── Offer: the merchant's live 402 ───────────────────────────────────────────

type Offer =
  | { state: 'offer'; paymentRequired: X402PaymentRequired }
  | { state: 'not_configured' }
  | { state: 'testnet_only' };

async function fetchOffer(): Promise<Offer> {
  const res = await fetch(RESOURCE_PATH, { headers: { Accept: 'application/json' } });
  if (res.status === 402) {
    const body = (await res.json()) as X402PaymentRequired;
    if (body?.x402Version === 2 && body.accepts?.length) {
      return { state: 'offer', paymentRequired: body };
    }
    throw new Error('The merchant answered 402 in a shape this demo does not recognise.');
  }
  if (res.status === 503) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === 'not_configured') return { state: 'not_configured' };
    if (body?.error === 'testnet_only') return { state: 'testnet_only' };
  }
  throw new Error(`The merchant route answered ${res.status} instead of 402.`);
}

/** Gate keeper: network, offer fetch and configuration states, then the purchase UI. */
export function X402Demo() {
  const offerQ = useQuery({
    queryKey: ['x402', 'offer'],
    queryFn: fetchOffer,
    staleTime: 60_000,
    retry: 1,
  });

  // The demo never runs against mainnet. This mirrors the route's own refusal.
  if (NETWORK !== 'testnet') {
    return (
      <Note role="status">
        The x402 demo runs on Mezo testnet only. This deployment targets Mezo {NETWORK}, so the demo
        is switched off rather than pointed at real funds.
      </Note>
    );
  }

  if (offerQ.isPending) {
    return <Loading>Reading the merchant&rsquo;s payment terms&hellip;</Loading>;
  }

  if (offerQ.error) {
    return (
      <Note tone="warning" role="alert">
        The merchant route did not answer with an x402 offer.{' '}
        <span className="num text-xs">{(offerQ.error as Error).message}</span>
      </Note>
    );
  }

  const offer = offerQ.data;
  if (offer.state === 'testnet_only') {
    return <Note role="status">The x402 demo runs on Mezo testnet only.</Note>;
  }
  if (offer.state === 'not_configured') {
    return (
      <Note role="status">
        The demo merchant is not configured. Set{' '}
        <span className="num text-xs">NEXT_PUBLIC_X402_MERCHANT</span> to the testnet address that
        should receive demo payments, then reload. Nothing is served until a real receiving address
        exists.
      </Note>
    );
  }

  const requirements = offer.paymentRequired.accepts[0];
  if (!requirements) {
    return (
      <Note tone="warning" role="alert">
        The merchant&rsquo;s 402 carried no payment options.
      </Note>
    );
  }

  return <X402Purchase paymentRequired={offer.paymentRequired} requirements={requirements} />;
}

// ── Purchase state machine ───────────────────────────────────────────────────

type Purchase =
  | { step: 'idle' }
  | { step: 'signing' }
  | { step: 'paying' }
  | { step: 'confirming'; settlement: X402SettleResponse; note: string }
  | {
      step: 'done';
      settlement: X402SettleResponse;
      note: string;
      /** Result of our own receipt read: confirmed, or honestly not yet observed. */
      receipt: 'confirmed' | 'unobserved';
    }
  | { step: 'failed'; message: string };

/** The facilitator's error codes, translated where a person will meet them. */
function settlementErrorCopy(reason: string): string {
  if (reason.includes('insufficient_balance')) {
    return 'Your wallet does not hold enough testnet MUSD for this purchase.';
  }
  if (reason.includes('allowance_required')) {
    return 'Permit2 has no allowance on your MUSD and the permit signature was not accepted.';
  }
  if (reason.includes('invalid_signature') || reason.includes('InvalidSignature')) {
    return 'The facilitator rejected the signature.';
  }
  if (reason === 'requirements_mismatch') {
    return 'The signed terms did not match the merchant offer. Reload and try again.';
  }
  if (reason === 'facilitator_unreachable') {
    return 'The facilitator did not answer. Nothing was charged; try again.';
  }
  return `The payment did not settle: ${reason}`;
}

function X402Purchase({
  paymentRequired,
  requirements,
}: {
  paymentRequired: X402PaymentRequired;
  requirements: X402PaymentRequirements;
}) {
  const source = useDataSource();
  const publicClient = usePublicClient({ chainId: X402_DEMO_CHAIN_ID });
  const { signTypedDataAsync } = useSignTypedData();
  const [purchase, setPurchase] = useState<Purchase>({ step: 'idle' });

  const price = BigInt(requirements.amount);

  // Both reads gate copy, not funds: the route and facilitator re-check everything.
  const balanceQ = useReadContract({
    address: X402_DEMO_ASSET,
    abi: musdTokenAbi,
    functionName: 'balanceOf',
    args: source.account ? [source.account] : undefined,
    chainId: X402_DEMO_CHAIN_ID,
    query: { enabled: source.ready && Boolean(source.account) },
  });
  const allowanceQ = useReadContract({
    address: X402_DEMO_ASSET,
    abi: musdTokenAbi,
    functionName: 'allowance',
    args: source.account ? [source.account, PERMIT2_ADDRESS] : undefined,
    chainId: X402_DEMO_CHAIN_ID,
    query: { enabled: source.ready && Boolean(source.account) },
  });

  const balance = balanceQ.data ?? null;
  const allowance = allowanceQ.data ?? null;
  const needsPermit = allowance === null ? null : allowance < price;
  const insufficient = balance !== null && balance < price;

  async function buy() {
    if (!source.account || !publicClient) return;
    const buyer = source.account;
    try {
      setPurchase({ step: 'signing' });

      // 1. The payment authorization: Permit2 witness transfer, one EIP-712 signature.
      const auth = buildPermit2Authorization({ from: buyer, requirements });
      const signature = (await signTypedDataAsync(permit2WitnessTypedData(auth))) as Hex;

      // 2. First purchase only: a gas-sponsored EIP-2612 permit so Permit2 gains an
      //    allowance without the buyer ever sending an approval transaction. The token
      //    nonce is read fresh at signing time, and the allowance is re-read rather than
      //    trusted from the hook, so a stale UI read cannot skip a needed permit.
      let extensions: X402PaymentPayload['extensions'];
      const liveAllowance = await publicClient.readContract({
        address: X402_DEMO_ASSET,
        abi: musdTokenAbi,
        functionName: 'allowance',
        args: [buyer, PERMIT2_ADDRESS],
      });
      if (liveAllowance < price) {
        const tokenNonce = await publicClient.readContract({
          address: X402_DEMO_ASSET,
          abi: musdTokenAbi,
          functionName: 'nonces',
          args: [buyer],
        });
        const permitSignature = (await signTypedDataAsync(
          eip2612PermitTypedData({
            owner: buyer,
            value: price,
            nonce: tokenNonce,
            deadline: BigInt(auth.deadline),
          }),
        )) as Hex;
        const info: Eip2612PermitInfo = {
          from: buyer,
          asset: X402_DEMO_ASSET,
          spender: PERMIT2_ADDRESS,
          amount: price.toString(),
          nonce: tokenNonce.toString(),
          deadline: auth.deadline,
          signature: permitSignature,
          version: '1',
        };
        extensions = { [EIP2612_EXTENSION_KEY]: { info } };
      }

      // 3. Retry the request with the payment attached. The merchant verifies and
      //    settles through the facilitator before anything unlocks.
      setPurchase({ step: 'paying' });
      const payload: X402PaymentPayload = {
        x402Version: 2,
        resource: paymentRequired.resource,
        accepted: requirements,
        payload: { signature, permit2Authorization: auth },
        ...(extensions ? { extensions } : {}),
      };
      const res = await fetch(RESOURCE_PATH, {
        headers: {
          Accept: 'application/json',
          [HEADER_PAYMENT_SIGNATURE]: encodeBase64Json(payload),
        },
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
        note?: { message?: string };
      } | null;

      if (res.status !== 200) {
        const reason = body?.error ?? `HTTP ${res.status}`;
        setPurchase({ step: 'failed', message: settlementErrorCopy(reason) });
        return;
      }

      // 4. Settled, per the facilitator. The hash comes from the PAYMENT-RESPONSE header,
      //    which is the facilitator's settle answer relayed verbatim by the merchant.
      const responseHeader = res.headers.get(HEADER_PAYMENT_RESPONSE);
      const settlement = responseHeader
        ? decodeBase64Json<X402SettleResponse>(responseHeader)
        : null;
      if (!settlement?.success || !settlement.transaction) {
        setPurchase({
          step: 'failed',
          message:
            'The merchant answered 200 without a settlement receipt, which should not happen.',
        });
        return;
      }
      const note = body?.note?.message ?? 'Paid.';
      setPurchase({ step: 'confirming', settlement, note });

      // 5. Our own read of the receipt. Only a successful receipt from our RPC upgrades
      //    the wording to "confirmed on chain"; a timeout leaves the honest middle state.
      try {
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: settlement.transaction as Hash,
          timeout: 45_000,
        });
        setPurchase({
          step: 'done',
          settlement,
          note,
          receipt: receipt.status === 'success' ? 'confirmed' : 'unobserved',
        });
      } catch {
        setPurchase({ step: 'done', settlement, note, receipt: 'unobserved' });
      }
      void balanceQ.refetch();
      void allowanceQ.refetch();
    } catch (error) {
      const message =
        error instanceof Error && /rejected|denied/i.test(error.message)
          ? 'Signature request declined in the wallet. Nothing was paid.'
          : 'The purchase did not complete. Nothing unlocks without a settlement.';
      setPurchase({ step: 'failed', message });
    }
  }

  const busy = purchase.step === 'signing' || purchase.step === 'paying';
  const settled = purchase.step === 'confirming' || purchase.step === 'done';

  return (
    <div className="flex flex-col gap-4">
      <Panel title="The offer" labelledBy="x402-offer">
        <PanelBody>
          <StatRow label="Resource" value={<span className="text-sm">Settlement note</span>} />
          <StatRow label="Price" value={<Musd wei={price} size="sm" />} />
          <StatRow
            label="Merchant"
            value={
              <span className="num text-text-muted text-xs" title={requirements.payTo}>
                {shortAddress(requirements.payTo)}
              </span>
            }
          />
          <StatRow
            label="Network"
            value={<span className="num text-text-muted text-xs">{requirements.network}</span>}
          />
          <StatRow
            label="Facilitator"
            hint="verifies and settles, pays the gas"
            value={
              <span className="num text-text-muted text-xs">
                {FACILITATOR_URL.replace('https://', '')}
              </span>
            }
            last
          />
        </PanelBody>
        <div className="px-5 pb-4">
          <Info summary="Where these figures come from">
            Everything above is read from the merchant route&rsquo;s live 402 answer, the same
            answer any x402 client would get. The price is {formatMusd(price)} MUSD because MUSD has
            18 decimals, so a one-cent HTTP price is exact rather than rounded.
          </Info>
        </div>
      </Panel>

      {!source.connected ? (
        <ConnectPrompt icon={<BoltIcon className="size-6" />} title="Connect to try x402">
          Buy the demo resource with an EIP-712 signature. No BTC needed; the facilitator pays the
          network fee.
        </ConnectPrompt>
      ) : !source.ready ? (
        <Note role="status">Switch your wallet to Mezo testnet to try the demo.</Note>
      ) : (
        <Panel title="Your side" labelledBy="x402-buyer">
          <PanelBody>
            <StatRow
              label="Your MUSD"
              value={
                balance === null ? (
                  <span className="text-text-subtle text-xs">reading&hellip;</span>
                ) : (
                  <Musd wei={balance} size="sm" tone={insufficient ? 'muted' : 'default'} />
                )
              }
            />
            <StatRow
              label="Signatures needed"
              hint={needsPermit ? 'first purchase authorizes Permit2 once' : undefined}
              value={
                <span className="num text-sm">
                  {needsPermit === null ? '…' : needsPermit ? '2' : '1'}
                </span>
              }
              last
            />
          </PanelBody>
          <div className="flex flex-col gap-3 px-5 pb-5 pt-2">
            {insufficient ? (
              <Note tone="warning" role="status">
                You need testnet MUSD to pay. It is minted, not dripped: get testnet BTC from the
                Mezo faucet, then borrow MUSD at{' '}
                <a
                  href="https://mezo.org/feature/borrow"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-text underline decoration-[var(--border-strong)] underline-offset-2"
                >
                  mezo.org/feature/borrow
                </a>
                .
              </Note>
            ) : null}
            <ActionButton
              onClick={() => void buy()}
              disabled={busy || settled || insufficient || balance === null}
            >
              {purchase.step === 'signing'
                ? 'Waiting for your signature…'
                : purchase.step === 'paying'
                  ? 'Settling through the facilitator…'
                  : `Buy the note for ${formatMusd(price)} MUSD`}
            </ActionButton>
            <p className="text-text-subtle text-xs leading-relaxed">
              Signing authorizes exactly {formatMusd(price)} MUSD to the merchant, expiring in ten
              minutes. You pay no gas; the facilitator submits the transaction.
            </p>
          </div>
        </Panel>
      )}

      {purchase.step === 'failed' ? (
        <Note tone="warning" role="alert">
          {purchase.message}
        </Note>
      ) : null}

      {purchase.step === 'confirming' || purchase.step === 'done' ? (
        <SettlementCard purchase={purchase} />
      ) : null}
    </div>
  );
}

/** The receipt: facilitator's answer first, our own chain read layered on top. */
function SettlementCard({
  purchase,
}: {
  purchase: Extract<Purchase, { step: 'confirming' | 'done' }>;
}) {
  const { settlement, note } = purchase;
  const hash = settlement.transaction as Hash;
  return (
    <Panel title="Settlement" labelledBy="x402-settlement">
      <PanelBody>
        <StatRow
          label="Status"
          value={
            purchase.step === 'confirming' ? (
              <span className="text-text-muted text-sm">
                Settled per facilitator, reading receipt&hellip;
              </span>
            ) : purchase.receipt === 'confirmed' ? (
              <span className="text-sm">Confirmed on chain</span>
            ) : (
              <span className="text-text-muted text-sm">Reported by facilitator</span>
            )
          }
        />
        {settlement.payer ? (
          <StatRow
            label="Payer"
            value={
              <span className="num text-text-muted text-xs" title={settlement.payer}>
                {shortAddress(settlement.payer as Address)}
              </span>
            }
          />
        ) : null}
        <StatRow
          label="Transaction"
          value={
            <a
              href={explorerTxUrl(hash)}
              target="_blank"
              rel="noreferrer noopener"
              title={hash}
              className="num text-text-muted hover:text-text inline-flex items-center gap-1.5 text-xs transition-colors duration-[120ms] ease-out"
            >
              {hash.slice(0, 10)}&hellip;{hash.slice(-6)}
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          }
          last
        />
      </PanelBody>
      <div className="px-5 pb-4">
        <Note role="status">{note}</Note>
        {purchase.step === 'done' && purchase.receipt === 'unobserved' ? (
          <p className="text-text-subtle mt-3 text-xs leading-relaxed">
            Our own RPC has not returned a successful receipt for this hash yet, so this screen does
            not claim on-chain confirmation. The explorer link is the check.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
