import { LandingSection, SectionHead } from './landing/section-head';
import { Reveal } from './ui/reveal';

/**
 * How it works: three steps as one divided strip, read left to right. One object with
 * hairline divisions rather than three cards, because the steps are a sequence, not a
 * set of equals. The deposit's gas cost is stated where it applies (step 1); the full
 * gas story is in the FAQ.
 */

const STEPS: readonly { title: string; body: string }[] = [
  {
    title: 'Deposit Bitcoin',
    body: 'Start from 0.001 BTC. The deposit itself needs a little BTC for gas.',
  },
  {
    title: 'Borrow MUSD',
    body: 'Draw dollars against your Bitcoin instead of selling it. The app shows how far Bitcoin can fall before your position could be liquidated.',
  },
  {
    title: 'Pay anyone',
    body: 'Send MUSD to an @handle or to any address. Payments move wallet to wallet.',
  },
];

export function HowItWorks() {
  return (
    <LandingSection id="how" labelledBy="how-title">
      <Reveal>
        <SectionHead id="how-title" label="How it works" title="Three steps from Bitcoin to a payment." />
        <ol role="list" className="card mx-auto mt-14 grid max-w-[880px] md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="border-[var(--border-hairline)] p-6 md:p-8 [&:not(:first-child)]:border-t md:[&:not(:first-child)]:border-l md:[&:not(:first-child)]:border-t-0"
            >
              <span aria-hidden className="t-bracket">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="t-h3 mt-5 md:mt-8">{s.title}</h3>
              <p className="text-text-muted mt-2 text-pretty text-base leading-[1.55]">{s.body}</p>
            </li>
          ))}
        </ol>
      </Reveal>
    </LandingSection>
  );
}
