import Link from 'next/link';
import { TESTFLIGHT_URL } from '@/lib/links';
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
      { label: 'Open web app', href: '/app' },
      { label: 'Join the iOS beta', href: TESTFLIGHT_URL, external: true },
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
      { label: 'Testnet Explorer', href: 'https://explorer.test.mezo.org', external: true },
      { label: 'mezo.org', href: 'https://mezo.org', external: true },
      { label: 'Mezo docs', href: 'https://info.mezo.org', external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="u-wrap pb-12 pt-32 sm:pt-48">
      {/* Closing CTA — clean dark panel */}
      <Reveal>
        <div className="rounded-[36px] bg-[color:var(--ink)] p-10 text-center sm:p-16">
          <h2
            className="u-display mx-auto max-w-[16ch] text-[clamp(30px,5vw,58px)] text-white"
          >
            Spend Bitcoin. Never sell it.
          </h2>
          <p className="mx-auto mt-4 max-w-[46ch] text-[15px] font-normal leading-[1.5] text-white/65 sm:text-[17px]">
            Try deposits, borrowing and payments with testnet funds. Eligible transactions are
            sponsored while the relayer is available.
          </p>
          <div className="mt-8 flex justify-center">
            <a
              href={TESTFLIGHT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="footer-cta"
            >
              Join the iOS beta
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
            Bitcoin-backed borrowing and payments. Available on the web and iPhone, on Mezo testnet.
          </p>
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
          © {new Date().getFullYear()} Maren Finance. Pre-audit software. Testnet funds only.
        </span>
        <span
          className="inline-flex items-center gap-2.5 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[color:var(--ink)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          <span aria-hidden className="size-2 rounded-[3px] bg-[color:var(--lime)]" />
          Built on Mezo
          <span className="num font-medium text-[color:var(--muted)]">Testnet · 31611</span>
        </span>
      </div>
    </footer>
  );
}
