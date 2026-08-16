import { Section, Eyebrow } from './ui/section';
import { Reveal } from './ui/reveal';

const steps = [
  {
    k: '01',
    title: 'Connect',
    body: 'Any EVM wallet, injected or WalletConnect. Mezo is a standard EVM chain, so there is no special SDK and nothing to install.',
    meta: 'No BTC balance needed',
  },
  {
    k: '02',
    title: 'Deposit BTC, draw MUSD',
    body: 'From 0.001 BTC into the pooled vault, or a direct trove if you are above the protocol minimum. Maren shows your ratio, your capacity and your distance to liquidation before you sign.',
    meta: 'From 0.001 BTC',
  },
  {
    k: '03',
    title: 'Spend it, gaslessly',
    body: 'Pay a handle, send a link, request, or split. Sign once; the relayer settles the BTC gas. Idle MUSD can sit in Earn instead of sitting still.',
    meta: 'First 25 actions free',
  },
] as const;

export function HowItWorks() {
  return (
    <Section id="how-it-works" labelledBy="how-title" className="hairline-t">
      <div className="container-maren">
        <Reveal className="max-w-3xl">
          <Eyebrow>How it works</Eyebrow>
          <h2 id="how-title" className="t-h1 mt-6 text-balance">
            Three steps, <span className="text-text-muted">one signature each.</span>
          </h2>
        </Reveal>

        <ol className="mt-14 grid grid-cols-1 gap-4 md:mt-16 md:grid-cols-3 md:gap-5">
          {steps.map((s, i) => (
            <Reveal as="li" key={s.k} delay={i * 90} className="h-full">
              <article className="card group relative flex h-full flex-col p-6 transition-colors duration-[240ms] ease-out hover:border-[var(--border-strong)] md:p-8">
                <span className="num text-sm text-violet-400">{s.k}</span>
                <h3 className="t-h3 text-text mt-8">{s.title}</h3>
                <p className="text-text-muted mt-4 flex-1 text-sm leading-relaxed">{s.body}</p>
                <p className="t-label text-text-subtle mt-8">{s.meta}</p>
              </article>
            </Reveal>
          ))}
        </ol>
      </div>
    </Section>
  );
}
