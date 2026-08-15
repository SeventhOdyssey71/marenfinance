import { PillButton } from './ui/pill-button';
import { Reveal } from './ui/reveal';
import { ArrowUpRight } from './ui/icons';
import { CtaBackdrop } from './shaders/cta-backdrop';

export function CtaBand() {
  return (
    <section aria-labelledby="cta-title" className="pb-24 md:pb-32">
      <div className="container-maren">
        <Reveal>
          <div className="relative isolate overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-hairline)]">
            <CtaBackdrop />

            <div className="relative px-6 py-24 text-center sm:px-10 md:py-32">
              <h2
                id="cta-title"
                className="t-display mx-auto max-w-[18ch] text-balance text-text"
              >
                Ready to put your Bitcoin to work?
              </h2>

              <p className="prose-measure mx-auto mt-7 text-base leading-relaxed text-text-muted md:text-[1.0625rem]">
                Deposit from 0.001 BTC, draw MUSD, and spend it without ever holding gas.
                Maren is pre-audit — start small.
              </p>

              <div className="mt-11 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <PillButton href="/app" size="lg">
                  Launch App
                </PillButton>
                <PillButton
                  href="https://explorer.mezo.org"
                  variant="secondary"
                  size="lg"
                  external
                  icon={<ArrowUpRight className="size-4" />}
                >
                  View Mezo on-chain
                </PillButton>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
