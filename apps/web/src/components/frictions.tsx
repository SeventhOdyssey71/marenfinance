import type { ReactNode } from 'react';
import { Section, Eyebrow } from './ui/section';
import { Reveal } from './ui/reveal';
import { CollateralFloor } from './visuals/collateral-floor';
import { GaslessFlow } from './visuals/gasless-flow';
import { PayThread } from './visuals/pay-thread';

type Item = {
  index: string;
  friction: string;
  answer: string;
  body: string;
  points: readonly string[];
  visual: ReactNode;
};

const items: readonly Item[] = [
  {
    index: '01',
    friction: 'The minimum is too big',
    answer: 'Pooled Bitcoin credit',
    body: 'Deposit from 0.001 BTC instead of 0.079 and borrow against it. Your share of the pooled trove is ledgered to you.',
    points: [
      'You see your own collateral, debt and ratio, not the pool’s',
      'Maren liquidates at 140%, thirty points above the protocol’s 110%',
      'Repay and withdraw at any time. Exits stay open when entries close',
      'Hold more than the protocol minimum and you get a trove of your own, with no pooling risk',
    ],
    visual: <CollateralFloor />,
  },
  {
    index: '02',
    friction: 'Every action costs BTC gas',
    answer: 'Built to be paid for you',
    body: 'Asking someone to hold the asset they refused to sell, just to pay for gas, is the wrong shape. Maren is built so it does not have to be held.',
    points: [
      'Approve and pay in one signature, not two',
      'You sign; nothing you sign can be replayed or redirected',
      'A relayer can only ever touch Maren’s own contracts, and never your funds',
      'Not running yet: today your own wallet submits, and every screen says so',
    ],
    visual: <GaslessFlow />,
  },
  {
    index: '03',
    friction: 'There is nowhere to spend it',
    answer: 'Payments that feel like messaging',
    body: 'MUSD exists. A consumer-grade surface for it does not. Maren adds handles, links, requests and splits — the shapes people already use to move money.',
    points: [
      'Send to an @handle. The address it resolves to is shown before you sign',
      'Send a link. The person claiming it needs no prior relationship and no BTC',
      'Request an amount, or split one payment across many recipients',
      'Attach a memo. It is written on-chain and publicly readable, forever',
    ],
    visual: <PayThread />,
  },
];

export function Frictions() {
  return (
    <Section id="frictions" labelledBy="frictions-title" className="relative">
      <div className="container-maren">
        <Reveal className="max-w-3xl">
          <Eyebrow>Three frictions, three answers</Eyebrow>
          <h2 id="frictions-title" className="t-h1 mt-6 text-balance">
            None of this requires Mezo
            <br className="hidden sm:block" />{' '}
            <span className="text-text-muted">to change anything.</span>
          </h2>
        </Reveal>

        <ol className="mt-12 md:mt-16">
          {items.map((item, i) => (
            <li
              key={item.index}
              className={`grid grid-cols-1 items-start gap-8 py-12 md:grid-cols-12 md:gap-12 md:py-14 ${
                i > 0 ? 'hairline-t' : ''
              }`}
            >
              {/* Copy — order flips on desktop so the visuals alternate sides */}
              <Reveal
                className={`md:col-span-6 lg:col-span-5 ${
                  i % 2 === 1 ? 'md:order-2 lg:col-start-8' : ''
                }`}
              >
                <div className="flex items-center gap-4">
                  <span className="num text-sm text-violet-400">{item.index}</span>
                  <span aria-hidden className="h-px flex-1 bg-[var(--border-hairline)]" />
                  <span className="t-label text-text-subtle">{item.friction}</span>
                </div>

                <h3 className="t-h2 mt-7 text-balance">{item.answer}</h3>

                <p className="text-text-muted mt-5 text-base leading-relaxed">{item.body}</p>

                <ul className="mt-7 space-y-3.5">
                  {item.points.map((p) => (
                    <li key={p} className="text-text-muted flex gap-3.5 text-sm">
                      <span
                        aria-hidden
                        className="mt-[0.5625rem] size-1 shrink-0 rounded-full bg-violet-400"
                      />
                      <span className="leading-relaxed">{p}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>

              <Reveal
                delay={80}
                className={`md:col-span-6 lg:col-span-6 ${
                  i % 2 === 1 ? 'md:order-1 lg:col-start-1' : 'lg:col-start-7'
                }`}
              >
                {item.visual}
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
