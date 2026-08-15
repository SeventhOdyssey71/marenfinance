import { PillButton } from './ui/pill-button';
import { EyebrowPill } from './ui/section';
import { ArrowDown } from './ui/icons';
import { HeroMesh } from './shaders/hero-mesh';

const heroFacts = [
  { value: '0.001 BTC', label: 'Minimum deposit' },
  { value: '140%', label: 'Maren liquidation CR' },
  { value: '25', label: 'Free actions, no gas' },
] as const;

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="hero-title">
      <HeroMesh />

      {/* Legibility floor: the mesh never sits under body copy at a contrast
          that drops below 4.5:1. Two scrims guarantee it — a vertical one that
          carries the whole viewport on mobile, and a horizontal one from md up
          that darkens the text column while leaving the violet bleed visible in
          the empty right half. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(8,8,10,0.84)_0%,rgba(8,8,10,0.76)_32%,rgba(8,8,10,0.82)_62%,rgba(8,8,10,0.94)_88%,#08080A_100%)] md:bg-[linear-gradient(180deg,rgba(8,8,10,0.44)_0%,rgba(8,8,10,0.22)_34%,rgba(8,8,10,0.38)_70%,rgba(8,8,10,0.86)_90%,#08080A_100%)]"
      />
      {/* From md up the copy sits in the left column, so the horizontal scrim can
          hold the text side dark and then clear completely — letting the shader
          run at full strength across the right half, which is where the reference
          gets its presence. On mobile there is no left/right split, so the
          vertical scrim above carries the whole legibility budget alone. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 hidden md:block md:bg-[linear-gradient(90deg,rgba(8,8,10,0.93)_0%,rgba(8,8,10,0.90)_42%,rgba(8,8,10,0.58)_63%,rgba(8,8,10,0.12)_80%,rgba(8,8,10,0)_100%)]"
      />

      <div className="container-maren relative">
        {/* Capped so the hero stays a hero on a 27" display instead of turning
            into a page of its own. */}
        <div className="flex min-h-[min(92svh,1000px)] flex-col justify-center pb-24 pt-[136px] md:min-h-[min(94svh,1120px)] md:pb-32 md:pt-40">
          <div className="max-w-[62rem]">
            <EyebrowPill>Built on Mezo</EyebrowPill>

            <h1 id="hero-title" className="t-display text-text mt-8 text-balance md:mt-10">
              Spend Bitcoin.
              <br />
              <span className="text-text-muted">Never sell it.</span>
            </h1>

            <p className="prose-measure text-text-muted mt-7 text-[1.0625rem] leading-relaxed md:mt-8 md:text-lg">
              Maren turns Bitcoin into spendable liquidity on Mezo. Deposit from{' '}
              <span className="num text-text">0.001 BTC</span>, draw MUSD against it, and pay anyone
              — without holding a gas balance, and without selling a satoshi.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center md:mt-12">
              <PillButton href="/app" size="lg">
                Launch App
              </PillButton>
              <PillButton
                href="#problem"
                variant="secondary"
                size="lg"
                icon={<ArrowDown className="size-4" />}
              >
                Read the thesis
              </PillButton>
            </div>
          </div>

          {/* Hard numbers, stated exactly. Nothing here is an estimate. */}
          <dl className="mt-20 grid max-w-3xl grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--border-hairline)] sm:grid-cols-3 md:mt-24">
            {heroFacts.map((f) => (
              <div key={f.label} className="bg-[#0A0A0D]/80 px-6 py-5 backdrop-blur-sm">
                <dt className="t-label text-text-subtle">{f.label}</dt>
                <dd className="num text-text mt-2 text-2xl font-medium tracking-tight">
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
