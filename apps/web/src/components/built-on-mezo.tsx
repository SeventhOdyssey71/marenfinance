import { Reveal } from './ui/reveal';
import { Counter, Kicker, Ticks } from './landing/ui';
import { ShieldIcon, BoltIcon, InfoIcon, LinkIcon, ArrowUpRight } from './ui/icons';
import { RELAYER_CONFIGURED } from '@/lib/chain/relay';

/**
 * Trust — built on Mezo, and honest about the risk. Four "safe by design" cells
 * over a facts strip read straight off the chain. The gasless cell and the gas
 * fact both flip on RELAYER_CONFIGURED (from NEXT_PUBLIC_RELAYER_URL at build
 * time), so this page never claims a relayer that is not deployed.
 */

const PILLARS: readonly { title: string; body: string; Icon: typeof ShieldIcon }[] = [
  {
    title: 'Non-custodial',
    body: 'Payments move MUSD wallet to wallet under your own permit. Maren never takes possession of what you send.',
    Icon: ShieldIcon,
  },
  {
    title: 'Gasless by design',
    body: RELAYER_CONFIGURED
      ? 'This deployment has a relayer; whether it is taking work is answered per action, on the screen, before you sign.'
      : 'Built so you never hold a gas balance. No relayer is running yet, so today your wallet submits — and every screen says so.',
    Icon: BoltIcon,
  },
  {
    title: 'Pre-audit — start small',
    body: 'A third-party audit of MarenVault and MarenForwarder is scheduled before mainnet. Until then, treat Maren as unaudited.',
    Icon: InfoIcon,
  },
  {
    title: 'Native to the chain',
    body: 'Maren does not fork MUSD, wrap BTC, or add a second asset. It sits on what Mezo ships and widens the door.',
    Icon: LinkIcon,
  },
];

const FACTS: readonly [string, string, string][] = [
  [
    'Stablecoin',
    'MUSD',
    'Mezo’s own dollar, borrowed against Bitcoin. Maren does not fork it or wrap it.',
  ],
  [
    'Gas token',
    'Native BTC',
    RELAYER_CONFIGURED
      ? 'Mezo charges gas in Bitcoin. This deployment has a relayer; each screen says whether it is taking work before you sign.'
      : 'Mezo charges gas in Bitcoin. Maren is built so you will not have to hold a gas balance, though today you still do.',
  ],
  [
    'Networks',
    '31612 / 31611',
    'Mezo mainnet and matsnet. Any EVM wallet works; nothing here needs a bespoke SDK.',
  ],
];

export function BuiltOnMezo() {
  return (
    <section
      id="mezo"
      className="l-frame relative scroll-mt-24 border-t border-[color:var(--l-line)] px-5 pt-20 sm:px-8"
    >
      <Ticks />

      <Reveal className="flex flex-col items-center text-center">
        <Kicker>Safe by design</Kicker>
        <h2 className="mt-7 max-w-[18ch] text-[clamp(26px,3.4vw,42px)] font-bold leading-[1.08] tracking-[-0.025em] text-[var(--l-ink)]">
          Built on Mezo. Honest about the risk.
        </h2>
        <p className="mt-5 max-w-[54ch] text-[16px] leading-[1.55] text-[var(--l-muted)]">
          Maren sits on top of what Mezo already ships and widens the door. Every contract address
          and chain fact it publishes is read from the chain, never transcribed by hand.
        </p>
      </Reveal>

      {/* Four pillars */}
      <Reveal className="relative mt-16 grid grid-cols-1 border-y border-[color:var(--l-line)] sm:grid-cols-2 lg:grid-cols-4">
        <Ticks />
        {[25, 50, 75].map((p) => (
          <span key={`t${p}`} aria-hidden className="l-tick hidden lg:block" style={{ left: `${p}%`, top: 0, transform: 'translate(-50%,-50%)' }} />
        ))}
        {[25, 50, 75].map((p) => (
          <span key={`b${p}`} aria-hidden className="l-tick hidden lg:block" style={{ left: `${p}%`, bottom: 0, transform: 'translate(-50%,50%)' }} />
        ))}
        {PILLARS.map((p, i) => (
          <div
            key={p.title}
            className={`p-7 ${i % 2 === 1 ? 'sm:border-l sm:border-[color:var(--l-line)]' : ''} ${
              i >= 2 ? 'border-t border-[color:var(--l-line)] lg:border-t-0' : 'border-t border-[color:var(--l-line)] sm:border-t-0'
            } lg:border-l lg:border-[color:var(--l-line)] lg:first:border-l-0`}
          >
            <span className="grid size-11 place-items-center border border-[color:var(--l-line)] bg-[var(--l-white)] text-[var(--l-accent-ink)]">
              <p.Icon className="size-5" />
            </span>
            <h3 className="mt-5 text-[17px] font-semibold tracking-[-0.01em] text-[var(--l-ink)]">{p.title}</h3>
            <p className="mt-2.5 text-[13.5px] leading-[1.5] text-[var(--l-muted)]">{p.body}</p>
          </div>
        ))}
      </Reveal>

      {/* Facts strip */}
      <Reveal className="mt-10">
        <dl className="grid grid-cols-1 divide-y divide-[color:var(--l-line)] overflow-hidden rounded-[12px] border border-[color:var(--l-line)] bg-[var(--l-white)]">
          {FACTS.map(([label, value, body]) => (
            <div key={label} className="grid grid-cols-1 gap-2 p-6 sm:grid-cols-[11rem_1fr] sm:gap-6 md:p-7">
              <dt>
                <span className="l-mono block text-[10.5px] uppercase tracking-[0.12em] text-[var(--l-dim)]">{label}</span>
                <span className="num mt-2 block text-[15px] text-[var(--l-ink)]">{value}</span>
              </dt>
              <dd className="text-[14px] leading-[1.55] text-[var(--l-muted)]">{body}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-7 flex flex-wrap gap-3">
          <a
            href="https://explorer.mezo.org"
            target="_blank"
            rel="noreferrer noopener"
            className="l-mono group inline-flex h-11 items-center gap-2.5 border border-[color:var(--l-line)] bg-[var(--l-white)] px-5 text-[12px] uppercase tracking-[0.06em] text-[var(--l-ink)] transition-colors duration-[120ms] ease-out hover:border-[color:var(--border-strong)]"
          >
            Mezo Explorer
            <ArrowUpRight className="size-3.5 text-[var(--l-dim)] transition-transform duration-[120ms] ease-out group-hover:-translate-y-px group-hover:translate-x-px" />
          </a>
          <a
            href="https://mezo.org"
            target="_blank"
            rel="noreferrer noopener"
            className="l-mono group inline-flex h-11 items-center gap-2.5 px-5 text-[12px] uppercase tracking-[0.06em] text-[var(--l-muted)] transition-colors duration-[120ms] ease-out hover:text-[var(--l-ink)]"
          >
            mezo.org
            <ArrowUpRight className="size-3.5 text-[var(--l-dim)] transition-transform duration-[120ms] ease-out group-hover:-translate-y-px group-hover:translate-x-px" />
          </a>
        </div>
      </Reveal>

      <div className="l-hatch mt-14 h-16" />
      <div className="pb-8">
        <Counter n="04" label="Built on Mezo" />
      </div>
    </section>
  );
}
