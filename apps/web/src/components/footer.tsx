import Link from 'next/link';
import { Wordmark } from './ui/wordmark';
import { XLogo, GitHubLogo } from './ui/icons';
import { BracketButton, Ticks } from './landing/ui';
import { Reveal } from './ui/reveal';

type FooterLink = { label: string; href: string; external?: boolean };
type FooterColumn = { heading: string; links: readonly FooterLink[] };

const columns: readonly FooterColumn[] = [
  {
    heading: 'Product',
    links: [
      { label: 'The numbers', href: '#facts' },
      { label: 'Product', href: '#product' },
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Launch app', href: '/app' },
    ],
  },
  {
    heading: 'Learn',
    links: [
      { label: 'Built on Mezo', href: '#mezo' },
      { label: 'FAQ', href: '#faq' },
      { label: 'Docs', href: '/docs' },
    ],
  },
  {
    heading: 'Network',
    links: [
      { label: 'Mezo Explorer', href: 'https://explorer.mezo.org', external: true },
      { label: 'mezo.org', href: 'https://mezo.org', external: true },
      { label: 'Mezo docs', href: 'https://info.mezo.org', external: true },
    ],
  },
];

const socials = [
  { label: 'Maren on X', href: 'https://x.com/marenfinance', Icon: XLogo },
  { label: 'Maren on GitHub', href: 'https://github.com/SeventhOdyssey71/marenfinance', Icon: GitHubLogo },
] as const;

export function Footer() {
  return (
    <footer className="l-frame relative border-t border-[color:var(--l-line)]">
      <Ticks />

      {/* Closing CTA */}
      <Reveal className="px-5 py-20 text-center sm:px-8">
        <h2 className="mx-auto max-w-[16ch] text-[clamp(28px,4.2vw,50px)] font-bold leading-[1.04] tracking-[-0.03em] text-[var(--l-ink)]">
          Spend Bitcoin. <span className="text-[var(--l-muted)]">Never sell it.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-[48ch] text-[16px] leading-[1.55] text-[var(--l-muted)]">
          Deposit from 0.001 BTC, draw MUSD, and spend it without keeping a gas balance. Maren is
          pre-audit, so start small.
        </p>
        <div className="mt-8 flex justify-center">
          <BracketButton href="/app">Launch app</BracketButton>
        </div>
      </Reveal>

      {/* Accent bar + hatch */}
      <div className="h-2 w-full bg-[var(--l-accent)]" />
      <div className="l-hatch h-12" />

      {/* Footer table */}
      <div className="grid grid-cols-1 gap-px border-y border-[color:var(--l-line)] bg-[color:var(--l-line)] md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="bg-[var(--l-canvas)] p-7">
          <Wordmark className="h-[18px] w-auto text-[var(--l-ink)]" />
          <p className="l-mono mt-4 max-w-[36ch] text-[12px] leading-[1.65] text-[var(--l-muted)]">
            Bitcoin-backed liquidity, gasless-by-design spending, and yield. Built on Mezo.
          </p>
          <ul className="mt-6 flex items-center gap-2">
            {socials.map(({ label, href, Icon }) => (
              <li key={label}>
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={label}
                  className="grid size-9 place-items-center border border-[color:var(--l-line)] bg-[var(--l-white)] text-[var(--l-ink)] transition-colors duration-[120ms] ease-out hover:bg-[var(--l-accent)] hover:text-white"
                >
                  <Icon className="size-4" />
                </a>
              </li>
            ))}
          </ul>
        </div>

        {columns.map((col) => (
          <nav key={col.heading} aria-label={col.heading} className="flex flex-col bg-[var(--l-canvas)]">
            <div className="l-mono border-b border-[color:var(--l-line)] bg-[var(--l-panel)] px-6 py-3.5 text-[11px] uppercase tracking-[0.14em] text-[var(--l-ink)]">
              {col.heading}
            </div>
            {col.links.map((l) =>
              l.external ? (
                <a
                  key={l.label}
                  href={l.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="border-b border-[color:var(--l-line)] px-6 py-3.5 text-[14px] text-[var(--l-muted)] transition-colors duration-[120ms] ease-out last:border-b-0 hover:bg-[var(--l-panel)] hover:text-[var(--l-ink)]"
                >
                  {l.label}
                </a>
              ) : (
                <Link
                  key={l.label}
                  href={l.href}
                  className="border-b border-[color:var(--l-line)] px-6 py-3.5 text-[14px] text-[var(--l-muted)] transition-colors duration-[120ms] ease-out last:border-b-0 hover:bg-[var(--l-panel)] hover:text-[var(--l-ink)]"
                >
                  {l.label}
                </Link>
              ),
            )}
          </nav>
        ))}
      </div>

      {/* Copyright */}
      <div className="l-mono flex flex-col items-start justify-between gap-2 px-5 py-6 sm:flex-row sm:items-center sm:px-8">
        <span className="text-[11.5px] leading-[1.5] text-[var(--l-dim)]">
          © {new Date().getFullYear()} Maren Finance. Pre-audit software. Deposit only what you can
          afford to lose.
        </span>
        <span className="inline-flex items-center gap-2.5 text-[11.5px] uppercase tracking-[0.12em] text-[var(--l-accent-ink)]">
          <span aria-hidden className="size-1.5 rounded-full bg-[var(--l-accent)]" />
          Built on Mezo
          <span className="num text-[var(--l-dim)]">31612 · 31611</span>
        </span>
      </div>
    </footer>
  );
}
