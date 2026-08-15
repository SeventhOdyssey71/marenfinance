import { Section, Eyebrow } from './ui/section';
import { Reveal } from './ui/reveal';

const stats = [
  {
    value: '1,800',
    unit: 'MUSD',
    label: 'Minimum net debt to open a position',
    body: 'A Mezo trove requires 1,800 MUSD of net debt — 2,000 MUSD in total, including the 200 MUSD gas compensation. At a responsible 250% collateral ratio that is roughly 0.079 BTC, about $5,000, committed before you can borrow a single dollar.',
    tone: 'neutral',
  },
  {
    value: '26',
    unit: 'troves',
    label: 'Open on Mezo mainnet',
    body: 'That is the entire borrowing market. Not a demand problem — a doorway problem. The people who would use this are holding less than the minimum asks for.',
    tone: 'neutral',
  },
  {
    value: '0.001',
    unit: 'BTC',
    label: "Maren's floor",
    body: 'Roughly 80× lower than the protocol minimum. Small holders enter a pooled, conservatively managed position instead of being turned away at the door.',
    tone: 'accent',
  },
] as const;

export function Problem() {
  return (
    <Section id="problem" labelledBy="problem-title">
      <div className="container-maren">
        <Reveal className="max-w-3xl">
          <Eyebrow>The problem</Eyebrow>
          <h2 id="problem-title" className="t-h1 mt-6 text-balance">
            The primitive works.
            <br className="hidden sm:block" />{' '}
            <span className="text-text-muted">The on-ramp is too narrow.</span>
          </h2>
          <p className="prose-measure mt-6 text-base leading-relaxed text-text-muted md:text-[1.0625rem]">
            Mezo already lets a Bitcoin holder borrow MUSD against BTC without selling.
            That part is built and it works. What keeps it from becoming a daily habit is
            the size of the entrance.
          </p>
        </Reveal>

        <ul className="mt-14 grid grid-cols-1 gap-4 md:mt-16 md:grid-cols-3 md:gap-5">
          {stats.map((s, i) => (
            <Reveal as="li" key={s.label} delay={i * 90}>
              <article
                className={`card relative h-full overflow-hidden p-6 md:p-8 ${
                  s.tone === 'accent' ? 'border-violet-500/25' : ''
                }`}
              >
                {s.tone === 'accent' && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full bg-violet-500/12 blur-3xl"
                  />
                )}
                <p className="t-label text-text-subtle">{s.label}</p>
                <p className="mt-6 flex items-baseline gap-2">
                  <span
                    className={`t-numeric-xl ${
                      s.tone === 'accent' ? 'text-violet-400' : 'text-text'
                    }`}
                  >
                    {s.value}
                  </span>
                  <span className="num text-sm text-text-subtle">{s.unit}</span>
                </p>
                <p className="mt-5 text-sm leading-relaxed text-text-muted">{s.body}</p>
              </article>
            </Reveal>
          ))}
        </ul>

        <Reveal delay={120}>
          <p className="prose-measure mt-8 text-sm leading-relaxed text-text-subtle">
            Trove count and the 1,800 MUSD minimum are protocol facts, read from Mezo
            mainnet on 15 August 2026. BTC-denominated equivalents assume a reference
            price of{' '}
            <span className="num text-text-muted">$63,000</span> per BTC and move with
            the market.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
