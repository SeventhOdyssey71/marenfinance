import { Reveal } from './ui/reveal';
import { Ticks } from './landing/ui';
import { ShieldIcon } from './ui/icons';

/**
 * The dark product moment — Talise's landing alternates light sections with the
 * occasional dark product panel, and this is Maren's. It carries the single
 * hardest truth on the page: pooled positions share one trove. No screenshot is
 * faked; the Portfolio panel is a CSS mock, flagged illustrative, and it shows
 * the honest "price feed stale" state as readily as a healthy one.
 *
 * TODO(design): replace <PortfolioMock /> with a real Portfolio screenshot when
 * one is captured.
 */

/** Illustrative Portfolio risk panel, on the dark band. */
function PortfolioMock() {
  return (
    <div
      className="w-full max-w-[420px] rounded-[14px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm"
      style={{ boxShadow: '0 40px 90px -40px rgba(0,0,0,0.6)' }}
    >
      <div className="flex items-center justify-between">
        <span className="l-mono text-[10.5px] uppercase tracking-[0.14em] text-white/45">Your position</span>
        <span
          className="l-mono rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[#c9baff]"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-violet-500) 28%, transparent)' }}
        >
          Illustrative
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-5">
        <div>
          <div className="l-mono text-[10px] uppercase tracking-[0.12em] text-white/40">Collateral ratio</div>
          <div className="num mt-1.5 text-[26px] font-medium leading-none text-white">262%</div>
        </div>
        <div>
          <div className="l-mono text-[10px] uppercase tracking-[0.12em] text-white/40">Distance to 140%</div>
          <div className="num mt-1.5 text-[26px] font-medium leading-none text-[#a48bff]">+122%</div>
        </div>
      </div>

      <div className="mt-6 h-1.5 rounded-full bg-white/10">
        <div className="h-full w-[72%] rounded-full bg-[color:var(--color-violet-500)]" />
      </div>
      <div className="l-mono mt-2 flex justify-between text-[10px] uppercase tracking-[0.1em] text-white/40">
        <span>140% floor</span>
        <span>healthy</span>
      </div>

      {/* The honest state, shown as first-class as the healthy one. */}
      <div className="mt-6 flex items-center gap-2.5 rounded-[10px] border border-[#fbbf24]/25 bg-[#fbbf24]/10 px-3.5 py-3">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[#fbbf24]" />
        <span className="text-[12.5px] leading-[1.4] text-[#f4d98b]">
          Price feed stale — actions pause until it recovers. Maren never shows a stale price as live.
        </span>
      </div>
    </div>
  );
}

export function ProductMoment() {
  return (
    <div className="l-frame relative overflow-hidden border-t border-[color:var(--l-line)]">
      <Ticks />
      <div
        className="relative px-5 py-20 sm:px-10 sm:py-24"
        style={{
          background:
            'radial-gradient(120% 120% at 15% 0%, #241653 0%, #16102e 45%, #0d0a1c 100%)',
        }}
      >
        <div className="mx-auto grid max-w-[1000px] grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <span className="l-mono inline-flex items-center gap-2 border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-white/80">
              <span aria-hidden className="grid size-4 place-items-center text-[#a48bff]">
                <ShieldIcon className="size-3.5" />
              </span>
              The honest exception
            </span>

            <h2 className="mt-7 max-w-[16ch] text-[clamp(26px,3.4vw,42px)] font-bold leading-[1.08] tracking-[-0.025em] text-white">
              Pooled positions share one trove
            </h2>

            <p className="mt-5 max-w-[50ch] text-[15.5px] leading-[1.6] text-white/70">
              We will not soften it. The pooled vault runs a single, conservatively managed trove and
              gives each depositor a proportional claim inside it. Your collateral is segregated in{' '}
              <em className="not-italic text-white">accounting</em>, not in custody — and a
              catastrophic, faster-than-keeper drawdown could socialise losses.
            </p>

            <ul className="mt-7 space-y-3">
              {[
                'The 140 / 110 buffer and the 0.001 BTC floor, checked every block by a keeper',
                'A protocol-owned insurance buffer funded from vault fees',
                'Above the protocol minimum, Maren steers you to a direct trove — no pooling risk',
                'Pre-audit software: mainnet launches with the vault capped. Start small.',
              ].map((t) => (
                <li key={t} className="flex items-start gap-3 text-[13.5px] leading-[1.5] text-white/70">
                  <span aria-hidden className="mt-[0.5rem] size-1 shrink-0 rounded-full bg-[#a48bff]" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={80} className="flex justify-center lg:justify-end">
            <PortfolioMock />
          </Reveal>
        </div>
      </div>
    </div>
  );
}
