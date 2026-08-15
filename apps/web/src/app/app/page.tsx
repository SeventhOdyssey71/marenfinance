import type { Metadata } from 'next';
import Link from 'next/link';
import { Wordmark } from '@/components/ui/wordmark';
import { ArrowRight } from '@/components/ui/icons';

export const metadata: Metadata = {
  title: 'Launching soon',
  description:
    'The Maren app is being built. Vault, Pay, Earn and Portfolio arrive after the matsnet deployment and third-party audit.',
  robots: { index: false, follow: true },
};

export default function AppPlaceholderPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-24 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh] bg-[radial-gradient(60%_70%_at_50%_0%,rgba(91,61,245,0.18)_0%,transparent_70%)]"
      />

      <Link href="/" aria-label="Maren Finance — home" className="rounded-[var(--radius-pill)]">
        <Wordmark className="h-5 w-auto" />
      </Link>

      <p className="t-label text-text-subtle mt-16">Maren App</p>

      <h1 className="t-h1 mt-5 text-balance">Launching soon</h1>

      <p className="prose-measure text-text-muted mt-6 text-base leading-relaxed">
        Vault, Pay, Earn and Portfolio ship after the full matsnet deployment and a third-party
        audit of the two contracts that carry risk. We would rather be late than be sorry with
        someone else&rsquo;s Bitcoin.
      </p>

      <Link
        href="/"
        className="bg-surface-raised text-text group mt-11 inline-flex h-12 items-center gap-3 rounded-[var(--radius-pill)] border border-[var(--border-hairline)] px-6 text-[0.9375rem] font-medium transition-colors duration-[120ms] ease-out hover:border-[var(--border-strong)]"
      >
        <ArrowRight
          className="text-text-subtle size-4 rotate-180 transition-transform duration-[120ms] ease-out group-hover:-translate-x-0.5"
          aria-hidden
        />
        Back to maren.finance
      </Link>
    </main>
  );
}
