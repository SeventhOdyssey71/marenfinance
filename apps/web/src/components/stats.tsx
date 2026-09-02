import { Reveal } from './ui/reveal';
import { Counter, Kicker, Ticks } from './landing/ui';

/**
 * Honest facts only. Every figure here is a protocol constant readable off the
 * contracts or Mezo's own docs — the deposit floor Maren sets, Maren's internal
 * liquidation ratio, Mezo's fixed borrow rate and Mezo's protocol ratio. No
 * user counts, no volume, no traction: Maren has essentially none and does not
 * pretend to.
 */
const STATS: readonly [string, string, string][] = [
  ['0.001 BTC', 'Minimum deposit', "Maren's pooled floor — roughly 80× below the protocol's own entry."],
  ['140%', 'Maren liquidation CR', "Thirty points above the protocol's 110% cliff, as a buffer."],
  ['1.00%', 'Fixed borrow APR', 'Set on-chain by Mezo. A fixed rate, not a teaser.'],
  ['110%', 'Mezo protocol CR', "The chain's own liquidation threshold. Maren does not change it."],
];

export function Stats() {
  return (
    <section
      id="facts"
      className="l-frame relative scroll-mt-24 border-t border-[color:var(--l-line)] px-5 pt-20 sm:px-8"
    >
      <Ticks />

      <Reveal className="flex flex-col items-center text-center">
        <Kicker>The numbers, stated exactly</Kicker>
        <h2 className="mt-7 max-w-[18ch] text-[clamp(26px,3.4vw,42px)] font-bold leading-[1.08] tracking-[-0.025em] text-[var(--l-ink)]">
          Real collateral. Real ratios. Nothing invented.
        </h2>
        <p className="mt-5 max-w-[54ch] text-[16px] leading-[1.55] text-[var(--l-muted)]">
          Maren widens the door to Mezo&rsquo;s Bitcoin-backed dollar. Every number below is a
          protocol fact, not a marketing figure — and the app reads them live from the chain.
        </p>
      </Reveal>

      <Reveal className="relative mt-16 grid grid-cols-2 border-y border-[color:var(--l-line)] md:grid-cols-4">
        <Ticks />
        {[25, 50, 75].map((p) => (
          <span
            key={`t${p}`}
            aria-hidden
            className="l-tick hidden md:block"
            style={{ left: `${p}%`, top: 0, transform: 'translate(-50%,-50%)' }}
          />
        ))}
        {[25, 50, 75].map((p) => (
          <span
            key={`b${p}`}
            aria-hidden
            className="l-tick hidden md:block"
            style={{ left: `${p}%`, bottom: 0, transform: 'translate(-50%,50%)' }}
          />
        ))}
        <span aria-hidden className="l-tick md:hidden" style={{ left: '50%', top: 0, transform: 'translate(-50%,-50%)' }} />
        <span aria-hidden className="l-tick md:hidden" style={{ left: '50%', bottom: 0, transform: 'translate(-50%,50%)' }} />

        {STATS.map(([value, label, desc], i) => (
          <div
            key={label}
            className={`px-5 py-8 sm:px-7 ${i % 2 === 1 ? 'border-l border-[color:var(--l-line)]' : ''} ${
              i >= 2 ? 'border-t border-[color:var(--l-line)] md:border-t-0' : ''
            } md:border-l md:border-[color:var(--l-line)] md:first:border-l-0`}
          >
            <div className="num text-[clamp(26px,3.4vw,40px)] font-medium leading-none tracking-[-0.02em] text-[var(--l-ink)]">
              {value}
            </div>
            <div className="l-mono mt-5 text-[11px] uppercase tracking-[0.12em] text-[var(--l-accent-ink)]">
              {label}
            </div>
            <p className="mt-2.5 text-[13.5px] leading-[1.5] text-[var(--l-muted)]">{desc}</p>
          </div>
        ))}
      </Reveal>

      <div className="l-hatch h-16" />
      <div className="pb-8">
        <Counter n="01" label="The numbers" />
      </div>
    </section>
  );
}
