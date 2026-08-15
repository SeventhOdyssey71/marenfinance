import { Section, Eyebrow } from './ui/section';
import { Reveal } from './ui/reveal';
import { VaultIcon, PortfolioIcon, BoltIcon } from './ui/icons';

const stats = [
  {
    value: '1,800',
    unit: 'MUSD',
    label: 'Minimum net debt to open a position',
    body: 'Roughly 0.079 BTC — about $5,000 — committed before you can borrow a single dollar.',
    Icon: VaultIcon,
    tone: 'neutral',
  },
  {
    value: '26',
    unit: 'troves',
    label: 'Open on Mezo mainnet',
    body: 'The entire borrowing market. Not a demand problem — a doorway problem.',
    Icon: PortfolioIcon,
    tone: 'neutral',
  },
  {
    value: '0.001',
    unit: 'BTC',
    label: "Maren's floor",
    body: 'Roughly 80× lower. Small holders enter a pooled position instead of being turned away.',
    Icon: BoltIcon,
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

        {/* Uniform cards, one accent. An earlier version tinted the third card's
            border and floated a violet blur behind it, which made a three-card row
            read as two designs. The single violet numeral is accent enough — it is
            also the only number on the row that is ours. */}
        <ul className="mt-14 grid grid-cols-1 gap-4 md:mt-16 md:grid-cols-3 md:gap-5">
          {stats.map((s, i) => (
            <Reveal as="li" key={s.label} delay={i * 90}>
              <article className="card relative flex h-full flex-col p-6 md:p-7">
                <span
                  aria-hidden
                  className="inline-flex size-11 items-center justify-center rounded-full border border-[var(--border-hairline)] text-text-muted"
                >
                  <s.Icon className="size-[18px]" />
                </span>

                <p className="mt-7 flex items-baseline gap-2">
                  <span
                    className={`t-numeric-xl ${
                      s.tone === 'accent' ? 'text-violet-400' : 'text-text'
                    }`}
                  >
                    {s.value}
                  </span>
                  <span className="num text-sm text-text-subtle">{s.unit}</span>
                </p>
                <p className="mt-2 text-[0.9375rem] text-text">{s.label}</p>
                <p className="mt-3 text-sm leading-relaxed text-text-subtle">{s.body}</p>
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
