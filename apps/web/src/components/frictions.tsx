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
    body: 'Maren runs one large, conservatively managed trove and gives each depositor a proportional claim inside it, with a per-user collateral and debt ledger. You get the primitive at 0.001 BTC instead of 0.079.',
    points: [
      'Per-user collateral, debt and ICR, computed off the same oracle',
      'Internal liquidation at 140% against the protocol’s 110%',
      'Exit any time: repay your share, withdraw your collateral',
      'Above the protocol minimum you are steered to a direct trove instead — no pooling risk',
    ],
    visual: <CollateralFloor />,
  },
  {
    index: '02',
    friction: 'Every action costs BTC gas',
    answer: 'Gasless by default',
    body: 'Asking someone to hold the asset they refused to sell just to pay for gas is the wrong shape. Maren pays it. You sign; a relayer submits and settles the BTC.',
    points: [
      'ERC-2771 forwarder with EIP-712 signed requests',
      'MUSD’s EIP-2612 permit means approve and pay in one signature',
      'Allowlisted to Maren contracts and known selectors only',
      'Per-address and per-IP rate limits with a daily sponsorship budget',
    ],
    visual: <GaslessFlow />,
  },
  {
    index: '03',
    friction: 'There is nowhere to spend it',
    answer: 'Payments that feel like messaging',
    body: 'MUSD exists. A consumer-grade surface for it does not. Maren adds handles, links, requests and splits — the shapes people already use to move money.',
    points: [
      'Send to an @handle resolved on-chain by MarenRegistry',
      'Claimable links: the recipient needs no prior relationship and no BTC',
      'Requests and one-signature splits to many recipients',
      'Every payment emits an indexable event with an on-chain memo',
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

        <ol className="mt-16 md:mt-24">
          {items.map((item, i) => (
            <li
              key={item.index}
              className={`grid grid-cols-1 items-start gap-8 py-12 md:grid-cols-12 md:gap-12 md:py-16 ${
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
                  <span
                    aria-hidden
                    className="h-px flex-1 bg-[var(--border-hairline)]"
                  />
                  <span className="t-label text-text-subtle">{item.friction}</span>
                </div>

                <h3 className="t-h2 mt-7 text-balance">{item.answer}</h3>

                <p className="mt-5 text-base leading-relaxed text-text-muted">
                  {item.body}
                </p>

                <ul className="mt-7 space-y-3.5">
                  {item.points.map((p) => (
                    <li key={p} className="flex gap-3.5 text-sm text-text-muted">
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
