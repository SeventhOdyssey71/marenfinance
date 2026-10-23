import Link from 'next/link';
import { PillButton } from '@/components/ui/pill-button';
import { Wordmark } from '@/components/ui/wordmark';

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-[var(--border-hairline)]">
        <div className="container-maren flex h-16 items-center">
          <Link
            href="/"
            aria-label="Maren Finance, home"
            className="-ml-1 inline-flex h-11 items-center px-1"
          >
            <Wordmark className="h-[20px] text-[19px]" />
          </Link>
        </div>
      </header>

      <main className="container-maren flex flex-1 flex-col items-center justify-center pb-24 pt-12 text-center">
        <p className="t-bracket">[ Error 404 ]</p>
        <h1 className="t-h1 mt-4 max-w-[18ch]">This page does not exist.</h1>
        <p className="text-text-muted mt-4 max-w-[40ch] text-pretty text-[1.0625rem] leading-[1.5]">
          The link may be out of date, or the address may be mistyped.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <PillButton href="/" size="lg">
            Go home
          </PillButton>
          <PillButton href="/app" size="lg" variant="secondary">
            Open app
          </PillButton>
        </div>
      </main>
    </div>
  );
}
