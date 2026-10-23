'use client';

import { Info, PageHeader } from '@/components/app/primitives';
import { X402Demo } from '@/components/app/x402-demo';

/**
 * The x402 demo screen. Deliberately small and clearly labelled: this is a working
 * protocol demonstration on test funds, reached from a quiet link on Pay rather than a
 * bottom-nav destination, so it never reads as a core money flow.
 *
 * A narrow centred column, like Pay: the demo is a purchase flow, and its tables read as
 * label and value at this width rather than as two words at opposite ends of the screen.
 */
export default function X402Page() {
  return (
    <div className="mx-auto w-full max-w-[600px]">
      <PageHeader
        eyebrow="[ x402 · testnet demo ]"
        title="Pay per request"
        description={
          <>
            x402 is Mezo&rsquo;s gasless MUSD payment rail: a server answers an HTTP request with
            402 Payment Required and a price, you authorize that exact amount with an EIP-712
            signature, and a facilitator settles it on chain and pays the gas.
          </>
        }
      />

      <X402Demo />

      <div className="mt-6">
        <Info summary="What this demo is, exactly">
          Both halves run in this app on Mezo testnet: a paid API route served by Maren (the
          merchant) and this page (the buyer). The 402 terms, the verification, the settlement and
          the transaction hash are all real protocol traffic through facilitator.vativ.io; only the
          money is testnet MUSD. Nothing on this screen claims success without the
          facilitator&rsquo;s settlement answer, and on-chain confirmation is only claimed after
          this client reads the receipt itself.
        </Info>
      </div>
    </div>
  );
}
