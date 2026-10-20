import { redirect } from 'next/navigation';
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
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl">This payment link is incomplete</h1>
      <p>
        Ask the sender for the original link, or enter the recipient in Maren. Nothing has been
        submitted.
      </p>
      <a href="/app/pay" className="underline">
        Open payments
      </a>
    </main>
  );
}
