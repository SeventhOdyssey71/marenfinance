'use client';

import { Info, Label } from '@/components/app/primitives';
import { X402Demo } from '@/components/app/x402-demo';

/**
 * The x402 demo screen. Deliberately small and clearly labelled: this is a working
 * protocol demonstration on test funds, reached from a quiet link on Pay rather than a
 * bottom-nav destination, so it never reads as a core money flow.
 */
export default function X402Page() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label>x402 · testnet demo</Label>
          <h1 className="t-h3 mt-1.5">Pay per request</h1>
        </div>
      </div>

      <p className="text-text-muted max-w-[62ch] text-sm leading-relaxed">
        x402 is Mezo&rsquo;s gasless MUSD payment rail: a server answers an HTTP request with 402
        Payment Required and a price, you authorize that exact amount with an EIP-712 signature, and
        a facilitator settles it on chain and pays the gas.
      </p>

      <X402Demo />

      <Info summary="What this demo is, exactly">
        Both halves run in this app on Mezo testnet: a paid API route served by Maren (the merchant)
        and this page (the buyer). The 402 terms, the verification, the settlement and the
        transaction hash are all real protocol traffic through facilitator.vativ.io; only the money
        is testnet MUSD. Nothing on this screen claims success without the facilitator&rsquo;s
        settlement answer, and on-chain confirmation is only claimed after this client reads the
        receipt itself.
      </Info>
    </div>
  );
}
