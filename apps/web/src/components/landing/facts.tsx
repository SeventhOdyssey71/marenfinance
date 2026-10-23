import { RELAYER_CONFIGURED } from '@/lib/chain/relay';
import { Reveal } from '../ui/reveal';
import { LandingSection, SectionHead } from './section-head';

/**
 * Where things stand: four plain facts in one divided plate. The gas line follows the
 * same build-time switch as the FAQ, so this page never claims sponsorship that this
 * deployment does not have. Neither branch promises the relayer is taking work right
 * now; the app answers that per action, before anyone signs.
 */

const FACTS: readonly { title: string; body: string }[] = [
  {
    title: 'Non-custodial',
    body: 'Your keys stay in your own wallet, never on Maren’s servers.',
  },
  RELAYER_CONFIGURED
    ? {
        title: 'Sponsored gas',
        body: 'Maren’s relayer pays the gas on borrows, repays and payments, and simulates every call before it pays. Deposits, approvals and payment links need a little BTC.',
      }
    : {
        title: 'Gas shown before you sign',
        body: 'Sponsored gas is not configured for this web client, so you pay it in BTC. Every transaction shows who pays before you sign.',
      },
  {
    title: 'Five contracts source-verified',
    body: 'Anyone can read the contract source on Blockscout.',
  },
  {
    title: 'Pre-audit, testnet only',
    body: 'No audit yet. Maren runs on Mezo testnet, with testnet funds only.',
  },
];

export function Facts() {
  return (
    <LandingSection labelledBy="facts-title">
      <Reveal>
        <SectionHead id="facts-title" label="Status" title="Where things stand." />
        <dl className="card mx-auto mt-14 grid max-w-[880px] sm:grid-cols-2">
          {FACTS.map((f, i) => (
            <div
              key={f.title}
              className={`border-[var(--border-hairline)] p-6 md:p-8 ${i > 0 ? 'border-t' : ''} ${i === 1 ? 'sm:border-l sm:border-t-0' : ''} ${i === 3 ? 'sm:border-l' : ''}`}
            >
              <dt className="t-h3">{f.title}</dt>
              <dd className="text-text-muted mt-2 text-pretty text-base leading-[1.55]">
                {f.body}
              </dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </LandingSection>
  );
}
