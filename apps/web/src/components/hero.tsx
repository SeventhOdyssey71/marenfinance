import { PillButton } from './ui/pill-button';
import { EyebrowPill } from './ui/section';
import { ArrowUpRight } from './ui/icons';
import { HeroScene } from './three/hero-scene';

/**
 * Three facts, each one readable off the contracts today.
 *
 * The third used to be "25 — Free actions, once relayed", which is a promise about a
 * relayer that is deployed nowhere. The rest of this codebase spent a whole pass deleting
 * claims of that shape; leaving one above the fold, where it is the first number anybody
 * sees, was the loudest remaining instance. The borrow rate is fixed, on-chain and true.
 */
const heroFacts = [
  { value: '0.001 BTC', label: 'Minimum deposit' },
  { value: '140%', label: 'Maren liquidation CR' },
  { value: '1.00%', label: 'Fixed borrow APR' },
] as const;

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="hero-title">
      <HeroScene />

      {/* Legibility floor: the shader never sits under copy below 4.5:1.
          The copy is centred, so the scrim is centre-weighted rather than
          side-weighted — a dark ellipse behind the text that falls away at the
          edges, letting the silk read at full strength down both margins the way
          the reference does. A left-to-right ramp would have been wrong here: it
          darkens one edge the text no longer occupies and washes the other. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(130%_62%_at_50%_44%,rgba(8,8,10,0.95)_0%,rgba(8,8,10,0.92)_46%,rgba(8,8,10,0.72)_74%,rgba(8,8,10,0.35)_92%,rgba(8,8,10,0.12)_100%)] md:bg-[radial-gradient(72%_58%_at_50%_44%,rgba(8,8,10,0.92)_0%,rgba(8,8,10,0.86)_42%,rgba(8,8,10,0.52)_70%,rgba(8,8,10,0.12)_88%,rgba(8,8,10,0)_100%)]"
      />
      {/* Seats the section into the page: fully opaque at the very bottom so the
          shader does not collide with the section that follows. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(8,8,10,0.55)_0%,rgba(8,8,10,0)_28%,rgba(8,8,10,0)_68%,rgba(8,8,10,0.72)_90%,#08080A_100%)]"
      />

      <div className="container-maren relative">
        {/* Capped so the hero stays a hero on a 27" display instead of turning
            into a page of its own. */}
        {/* Centred, and vertically centred in the viewport. The copy block is
            capped at 46rem so the headline breaks where it is written to break
            rather than running the full container width. */}
        <div className="flex min-h-[min(92svh,940px)] flex-col items-center justify-center pb-24 pt-[136px] text-center md:min-h-[min(92svh,1040px)] md:pb-28 md:pt-40">
          <EyebrowPill>Built on Mezo</EyebrowPill>

          <h1
            id="hero-title"
            className="t-display text-text mx-auto mt-7 max-w-[46rem] text-balance"
          >
            Spend Bitcoin.
            <br />
            <span className="text-text-muted">Never sell it.</span>
          </h1>

          <p className="text-text-muted mx-auto mt-6 max-w-[42rem] text-[1.0625rem] leading-relaxed">
            Deposit from <span className="num text-text">0.001 BTC</span>, draw MUSD against it, and
            pay anyone without selling a satoshi.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <PillButton href="/app">Launch App</PillButton>
            {/* Same up-right arrow as Launch App. The two pills sit side by side and a
                down arrow next to an up-right one read as two different kinds of action
                when both are simply "go and read this". */}
            <PillButton
              href="#problem"
              variant="secondary"
              icon={<ArrowUpRight className="size-4" />}
            >
              Read the thesis
            </PillButton>
          </div>

          {/* Hard numbers, stated exactly. Nothing here is an estimate. Kept, but
              demoted to a quiet centred strip — the reference hero carries no
              stat block at all, and these earn their place on facts rather than
              on visual weight. */}
          <dl className="mt-16 flex flex-col items-center justify-center gap-x-12 gap-y-6 sm:flex-row md:mt-20">
            {heroFacts.map((f) => (
              <div key={f.label} className="text-center">
                <dd className="num text-text text-lg font-medium tracking-tight">{f.value}</dd>
                <dt className="t-label text-text-subtle mt-1.5">{f.label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
