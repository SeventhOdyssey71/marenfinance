import { Reveal } from './ui/reveal';
import { Tag } from './ugly-ui';

/**
 * How it works — three big numbered sticker cards: deposit, draw, spend. Honest
 * throughout: the first-deposit-costs-gas caveat is stated on step 01 and the
 * 140/110 buffer on step 02. (The gasless caveat lives in the FAQ.)
 */

const STEPS: readonly { n: string; title: string; body: string; fill: string }[] = [
  {
    n: '01',
    title: 'Deposit BTC',
    body: 'Connect any EVM wallet and deposit from 0.001 BTC. Your first deposit sends Bitcoin, so it costs gas — and always will.',
    fill: 'var(--lime)',
  },
  {
    n: '02',
    title: 'Draw MUSD',
    body: 'Borrow MUSD against it. You see your ratio, capacity and distance to liquidation before you sign. Maren liquidates at 140%, thirty points above Mezo’s 110%.',
    fill: 'var(--cyan)',
  },
  {
    n: '03',
    title: 'Spend it',
    body: 'Pay a handle, send a link, request or split. Idle MUSD can sit in Earn instead of sitting still.',
    fill: 'var(--pink)',
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="u-wrap scroll-mt-28 pt-24 sm:pt-28">
      <Reveal className="flex flex-col items-center text-center">
        <Tag>How it works</Tag>
        <h2 className="u-display mt-6 max-w-[16ch] text-[clamp(38px,6.5vw,84px)]">
          Deposit. Draw. Spend.
        </h2>
        <p className="mt-5 max-w-[52ch] text-[16px] font-medium leading-[1.5] text-[color:var(--muted)] sm:text-[18px]">
          Three steps, one signature each. Borrow against Bitcoin without selling it, then move the
          dollars you draw the way you already move money.
        </p>
      </Reveal>

      <Reveal className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
        {STEPS.map((s) => (
          <article
            key={s.n}
            className="u-card flex flex-col p-6"
          >
            <span
              className="u-display grid size-16 place-items-center rounded-[12px] text-[30px] leading-none text-[color:var(--ink)]"
              style={{ background: s.fill }}
            >
              {s.n}
            </span>
            <h3 className="mt-6 text-[22px] font-extrabold tracking-[-0.02em] text-[color:var(--ink)]">
              {s.title}
            </h3>
            <p className="mt-3 text-[15px] font-medium leading-[1.5] text-[color:var(--muted)]">
              {s.body}
            </p>
          </article>
        ))}
      </Reveal>
    </section>
  );
}
