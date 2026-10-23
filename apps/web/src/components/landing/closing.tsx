import { PillButton } from '../ui/pill-button';
import { Reveal } from '../ui/reveal';

/** The closing plate: one line, one sentence, one action. */
export function Closing() {
  return (
    <section aria-labelledby="closing-title" className="container-maren">
      <div className="border-t border-[var(--border-hairline)] py-20 md:py-32">
        <Reveal className="card mx-auto max-w-[880px] px-6 py-16 text-center md:py-20">
          <p className="t-bracket">[ Testnet ]</p>
          <h2 id="closing-title" className="t-h1 mx-auto mt-4 max-w-[18ch]">
            Try the full loop on testnet.
          </h2>
          <p className="text-text-muted mx-auto mt-4 max-w-[40ch] text-balance text-base leading-[1.55]">
            Deposit, borrow and pay with testnet funds, right in your browser.
          </p>
          <div className="mt-8 flex justify-center">
            <PillButton href="/app" size="lg">
              Open app
            </PillButton>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
