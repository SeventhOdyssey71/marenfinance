import Link from 'next/link';
import { XLogo, GitHubLogo } from './ui/icons';
import { Reveal } from './ui/reveal';

/**
 * Footer — a loud closing CTA on a lime sticker panel, then the link table.
 * The closing copy repeats the honest position: pre-audit, start small.
 */

type FooterLink = { label: string; href: string; external?: boolean };
type FooterColumn = { heading: string; links: readonly FooterLink[] };

const columns: readonly FooterColumn[] = [
  {
    heading: 'Product',
    links: [
      { label: 'What you can do', href: '#product' },
      { label: 'How it works', href: '#how' },
      { label: 'Launch app', href: '/app' },
    ],
  },
  {
    heading: 'Learn',
    links: [
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
  {
    label: 'Maren on GitHub',
    href: 'https://github.com/SeventhOdyssey71/marenfinance',
    Icon: GitHubLogo,
  },
] as const;

export function Footer() {
  return (
    <footer className="u-wrap pb-12 pt-32 sm:pt-48">
      {/* Closing CTA — clean dark panel */}
      <Reveal>
        <div className="rounded-[36px] bg-[color:var(--ink)] p-10 text-center sm:p-16">
          <h2
            className="u-display mx-auto max-w-[16ch] text-[clamp(30px,5vw,58px)]"
            style={{ color: '#fff' }}
          >
            Spend Bitcoin. Never sell it.
          </h2>
          <p className="mx-auto mt-4 max-w-[46ch] text-[15px] font-normal leading-[1.5] text-white/65 sm:text-[17px]">
            Deposit from 0.001 BTC, draw MUSD, and spend it without keeping a gas balance. Maren is
            pre-audit, so start small.
          </p>
          <div className="mt-8 flex justify-center">
            <a href="/app" className="footer-cta">
              Open the app
            </a>
          </div>
        </div>
      </Reveal>

      {/* Link table */}
      <div className="mt-14 grid grid-cols-1 gap-6 border-t border-[color:var(--border-hairline)] pt-10 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div>
          <span
            className="text-[22px] font-semibold tracking-[-0.02em] text-[color:var(--ink)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Maren
          </span>
          <p className="mt-3 max-w-[34ch] text-[14px] font-medium leading-[1.55] text-[color:var(--muted)]">
            Bitcoin-backed liquidity, gasless-by-design spending, and yield. Built on Mezo.
          </p>
          <ul className="mt-5 flex items-center gap-2.5">
            {socials.map(({ label, href, Icon }) => (
              <li key={label}>
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={label}
                  className="u-chip size-10 transition-colors duration-[120ms] ease-out hover:bg-[color:var(--lime)]"
                >
                  <Icon className="size-4" />
                </a>
              </li>
            ))}
          </ul>
        </div>

        {columns.map((col) => (
          <nav key={col.heading} aria-label={col.heading}>
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--placeholder)]">
              {col.heading}
            </div>
            <ul className="mt-3 flex flex-col gap-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.external ? (
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[14px] font-medium text-[color:var(--muted)] transition-colors duration-[120ms] ease-out hover:text-[color:var(--ink)]"
                    >
                      {l.label}
                    </a>
                  ) : (
                    <Link
                      href={l.href}
                      className="text-[14px] font-medium text-[color:var(--muted)] transition-colors duration-[120ms] ease-out hover:text-[color:var(--ink)]"
                    >
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      {/* Copyright */}
      <div className="mt-10 flex flex-col items-start justify-between gap-2 border-t border-[color:var(--border-hairline)] pt-6 sm:flex-row sm:items-center">
        <span className="text-[12.5px] font-medium leading-[1.5] text-[color:var(--muted)]">
          © {new Date().getFullYear()} Maren Finance. Pre-audit software. Deposit only what you can
          afford to lose.
        </span>
        <span
          className="inline-flex items-center gap-2.5 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[color:var(--ink)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          <span aria-hidden className="size-2 rounded-[3px] bg-[color:var(--lime)]" />
          Built on Mezo
          <span className="num font-medium text-[color:var(--muted)]">31612 · 31611</span>
        </span>
      </div>
    </footer>
  );
}
