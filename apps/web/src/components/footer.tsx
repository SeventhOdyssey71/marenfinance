import Link from 'next/link';
import { IOS_APP_CTA, TESTFLIGHT_URL } from '@/lib/links';
import { ArrowUpRight } from './ui/icons';
import { Wordmark } from './ui/wordmark';

/**
 * Footer: the wordmark and one line about Maren, three short link columns, and the
 * standing disclosure. Links are 44px tall on touch and tighten to a list on desktop.
 */

type FooterLink = { label: string; href: string; external?: boolean };
type FooterColumn = { heading: string; links: readonly FooterLink[] };

const columns: readonly FooterColumn[] = [
  {
    heading: 'Product',
    links: [
      { label: 'How it works', href: '/#how' },
      { label: 'FAQ', href: '/#faq' },
      { label: IOS_APP_CTA, href: TESTFLIGHT_URL, external: true },
    ],
  },
  {
    heading: 'Learn',
    links: [
      { label: 'Docs', href: '/docs' },
      { label: 'Mezo docs', href: 'https://info.mezo.org', external: true },
    ],
  },
  {
    heading: 'Network',
    links: [
      { label: 'Testnet explorer', href: 'https://explorer.test.mezo.org', external: true },
      { label: 'mezo.org', href: 'https://mezo.org', external: true },
    ],
  },
];

const LINK =
  'text-text hover:text-text-muted inline-flex h-11 items-center gap-1 text-[0.9375rem] transition-[color] duration-150 md:h-8';

export function Footer() {
  return (
    <footer className="container-maren">
      <div className="grid gap-10 border-t border-[var(--border-hairline)] pt-12 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] md:gap-8">
        <div>
          <Link href="/" aria-label="Maren Finance, home" className="inline-flex h-11 items-center">
            <Wordmark className="h-[20px] text-[19px]" />
          </Link>
          <p className="text-text-muted mt-3 max-w-[32ch] text-pretty text-[0.9375rem] leading-[1.55]">
            Bitcoin-backed borrowing and payments on Mezo testnet, on the web and iPhone.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 md:contents">
          {columns.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h2 className="t-label">{col.heading}</h2>
              <ul className="mt-2 flex flex-col md:mt-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noreferrer noopener" className={LINK}>
                        {l.label}
                        <ArrowUpRight className="size-3.5 opacity-60" />
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <Link href={l.href} className={LINK}>
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      <div className="text-text-muted mt-12 flex flex-col gap-2 border-t border-[var(--border-hairline)] py-6 text-[0.8125rem] sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Maren Finance. Pre-audit software. Testnet funds only.</p>
        <p>
          Built on Mezo testnet, chain <span className="mono">31611</span>
        </p>
      </div>
    </footer>
  );
}
