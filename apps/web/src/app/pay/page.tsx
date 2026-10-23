import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PillButton } from '@/components/ui/pill-button';
import { Wordmark } from '@/components/ui/wordmark';
import { parsePaymentRequest } from '@/lib/payment-request';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Open payment', robots: { index: false, follow: false } };

/** Native share links also work in a browser, without a wallet-specific URL. */
export default async function PaymentLink({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const input = await searchParams;
  const query = new URLSearchParams();
  for (const key of ['to', 'amount']) {
    const value = input[key];
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
      query.append(key, item);
  }
  const parsed = parsePaymentRequest(query);
  if (parsed) redirect(`/app/pay?${new URLSearchParams(parsed)}`);

  // Only an incomplete link renders here; a complete one has already redirected into Pay.
  // It sits on the app's canvas with the wordmark above one card, the same arrival a
  // claim link gets, so a payer never lands somewhere that looks like a different product.
  return (
    <div id="pay-link-root" className="bg-canvas flex min-h-screen flex-col px-5 py-10">
      <style>{`body:has(#pay-link-root){background-color:var(--color-canvas)}`}</style>
      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center pb-[8vh]">
        <Link
          href="/"
          aria-label="Maren Finance home"
          className="mx-auto mb-8 inline-flex w-fit p-1.5"
        >
          <Wordmark className="h-[20px] text-[19px]" />
        </Link>

        <section aria-labelledby="pay-link-title" className="card p-5 md:p-7">
          <p className="t-bracket">[ Payment link ]</p>
          <h1
            id="pay-link-title"
            className="text-text mt-4 text-balance text-[1.5rem] font-medium leading-[1.15] tracking-[-0.026em]"
          >
            This payment link is incomplete
          </h1>
          <p className="text-text-muted mt-3 text-pretty text-[0.9375rem] leading-relaxed">
            Ask the sender for the original link, or enter the recipient in Maren. Nothing has been
            submitted.
          </p>
          <div className="mt-8 border-t border-[var(--border-hairline)] pt-6">
            <PillButton href="/app/pay" className="w-full">
              Open payments
            </PillButton>
          </div>
        </section>
      </main>
    </div>
  );
}
