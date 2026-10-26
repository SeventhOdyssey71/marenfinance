import Link from 'next/link';
import { IOS_APP_CTA, TESTFLIGHT_URL } from '@/lib/links';
import { TextPill } from './ui/pill-button';
import { Wordmark } from './ui/wordmark';

/**
 * The landing nav: wordmark, three links, one quiet iOS pill. The pill is grey
 * on purpose: the hero's violet iOS action is the one violet thing in the first view.
 * Under md the links drop out rather than collapsing into a menu; the page is short,
 * and the hero carries the same two destinations.
 */

const links: readonly { href: string; label: string }[] = [
  { href: '#how', label: 'How it works' },
  { href: '#faq', label: 'FAQ' },
  { href: '/docs', label: 'Docs' },
];

export function Nav() {
  return (
    <header className="bg-bg/85 sticky top-0 z-50 border-b border-[var(--border-hairline)] backdrop-blur-md">
      <div className="container-maren flex h-16 items-center justify-between gap-6">
        <Link
          href="/"
          aria-label="Maren Finance, home"
          className="-ml-1 inline-flex h-11 items-center px-1"
        >
          <Wordmark className="h-[20px] text-[19px]" />
        </Link>

        <div className="flex items-center gap-6">
          <nav aria-label="Primary" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-text-muted hover:text-text inline-flex h-11 items-center px-3 text-[0.9375rem] transition-[color] duration-150"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <TextPill href={TESTFLIGHT_URL} external>
            {IOS_APP_CTA}
          </TextPill>
        </div>
      </div>
    </header>
  );
}
