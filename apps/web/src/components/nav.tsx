'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StickerButton } from './ugly-ui';

/**
 * Floating nav pill — white, 1px black, 16px radius, centred at the top of the
 * page rather than a full-width bar. Wordmark left, section links centre, a
 * ghost "Launch app" sticker button right. The whole pill lifts a touch off
 * the top edge and stays put on scroll.
 */

type NavLink = { href: string; label: string };

const links: readonly NavLink[] = [
  { href: '#product', label: 'Product' },
  { href: '#how', label: 'How it works' },
  { href: '#facts', label: 'The facts' },
  { href: '/docs', label: 'Docs' },
  { href: '#faq', label: 'FAQ' },
];

export function Nav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.documentElement.style.overflow = open ? 'hidden' : '';
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 pt-4 sm:pt-5">
      <div className="u-wrap">
        <div className="u-card mx-auto flex max-w-[1000px] items-center justify-between gap-4 py-2.5 pl-4 pr-2.5 sm:pl-5">
          <Link
            href="/"
            aria-label="Maren Finance, home"
            className="shrink-0 text-[19px] font-extrabold uppercase tracking-[-0.03em] text-[color:var(--ink)]"
          >
            Maren
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-6 lg:flex">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="text-[14px] font-semibold text-[color:var(--muted)] transition-colors duration-[120ms] ease-out hover:text-[color:var(--ink)]"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2.5">
            <StickerButton
              href="/app"
              variant="glow"
              className="hidden !min-h-[38px] !px-4 sm:inline-flex"
            >
              Launch app
            </StickerButton>

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? 'Close menu' : 'Open menu'}
              className="u-chip size-11 shrink-0 lg:hidden"
            >
              <svg
                viewBox="0 0 20 20"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                aria-hidden
              >
                {open ? (
                  <>
                    <path d="M5 5l10 10" />
                    <path d="M15 5 5 15" />
                  </>
                ) : (
                  <>
                    <path d="M3 7h14" />
                    <path d="M3 13h14" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile sheet */}
        <div
          id="mobile-nav"
          hidden={!open}
          className="u-card mx-auto mt-3 max-w-[1000px] p-3 lg:hidden"
        >
          <ul className="flex flex-col">
            {links.map((l) => (
              <li key={l.href} className="border-b border-[color:var(--border-hairline)] last:border-b-0">
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex h-12 items-center px-2 text-[16px] font-semibold text-[color:var(--ink)]"
                >
                  {l.label}
                </a>
              </li>
            ))}
            <li className="pt-3">
              <StickerButton
                href="/app"
                variant="glow"
                className="w-full"
              >
                Launch app
              </StickerButton>
            </li>
          </ul>
        </div>
      </div>
    </header>
  );
}
