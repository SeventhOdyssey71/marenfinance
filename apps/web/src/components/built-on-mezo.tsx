import { Section, Eyebrow } from './ui/section';
import { Reveal } from './ui/reveal';
import { ArrowUpRight } from './ui/icons';

const facts = [
  {
    label: 'Stablecoin',
    value: 'MUSD',
    body: 'Mezo’s own dollar, borrowed against Bitcoin. Maren does not fork it or wrap it. Approving and paying is one signature, not two.',
  },
  {
    label: 'Gas token',
    value: 'Native BTC',
    body: 'Mezo charges gas in Bitcoin. Maren is built so you will not have to hold a gas balance to use it — though today you still do, because no relayer is running.',
  },
  {
    label: 'Networks',
    value: '31612 / 31611',
    body: 'Mezo mainnet and matsnet. Any EVM wallet works, and nothing here needs a bespoke SDK.',
  },
] as const;

export function BuiltOnMezo() {
  return (
    <Section id="mezo" labelledBy="mezo-title" className="hairline-t">
      <div className="container-maren">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-12">
          <Reveal className="lg:col-span-5">
            <Eyebrow>Built on Mezo</Eyebrow>
            <h2 id="mezo-title" className="t-h1 mt-6 text-balance">
              Native to the chain,
              <br className="hidden sm:block" />{' '}
              <span className="text-text-muted">not bolted onto it.</span>
            </h2>
            <p className="prose-measure text-text-muted mt-6 text-base leading-relaxed">
              Maren does not fork MUSD, wrap BTC, or introduce a second asset. It sits on top of
              what Mezo already ships and widens the door. Every contract address and chain fact we
              publish is read from the chain, never transcribed by hand.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <a
                href="https://explorer.mezo.org"
                target="_blank"
                rel="noreferrer noopener"
                className="bg-surface-raised text-text group inline-flex h-11 items-center gap-2.5 rounded-[var(--radius-pill)] border border-[var(--border-hairline)] px-5 text-sm font-medium transition-colors duration-[120ms] ease-out hover:border-[var(--border-strong)]"
              >
                Mezo Explorer
                <ArrowUpRight className="text-text-subtle size-3.5 transition-transform duration-[120ms] ease-out group-hover:-translate-y-px group-hover:translate-x-px" />
              </a>
              <a
                href="https://mezo.org"
                target="_blank"
                rel="noreferrer noopener"
                className="text-text-muted hover:text-text group inline-flex h-11 items-center gap-2.5 rounded-[var(--radius-pill)] border border-transparent px-5 text-sm font-medium transition-colors duration-[120ms] ease-out"
              >
                mezo.org
                <ArrowUpRight className="text-text-subtle size-3.5 transition-transform duration-[120ms] ease-out group-hover:-translate-y-px group-hover:translate-x-px" />
              </a>
            </div>
          </Reveal>

          <Reveal delay={80} className="lg:col-span-6 lg:col-start-7">
            <dl className="card divide-y divide-[var(--border-hairline)] overflow-hidden">
              {facts.map((f) => (
                <div
                  key={f.label}
                  className="grid grid-cols-1 gap-2 p-6 sm:grid-cols-[10rem_1fr] sm:gap-6 md:p-8"
                >
                  <dt>
                    <span className="t-label text-text-subtle block">{f.label}</span>
                    <span className="num text-text mt-2 block text-[0.9375rem]">{f.value}</span>
                  </dt>
                  <dd className="text-text-muted text-sm leading-relaxed">{f.body}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
