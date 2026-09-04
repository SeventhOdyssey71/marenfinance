'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * Nav — a clean, transparent bar: the Maren mark + wordmark on the left with the
 * section links beside it, a quiet "Sign in" and a dark pill CTA on the right. No
 * boxed pill, no sticker chrome. A subtle blur keeps it legible over content on
 * scroll. Collapses to a menu button + sheet under lg.
 */

type NavLink = { href: string; label: string };

const links: readonly NavLink[] = [
  { href: '#product', label: 'Product' },
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
    <header className="nav-bar sticky top-0 z-50">
      <div className="u-wrap">
        <div className="flex h-[68px] items-center justify-between gap-4">
          <div className="flex items-center gap-9">
            <Link href="/" aria-label="Maren Finance, home" className="nav-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/maren-mark.png" alt="" className="nav-logo-mark" />
              <span>Maren</span>
            </Link>

            <nav aria-label="Primary" className="nav-links hidden lg:flex">
              {links.map((l) => (
                <a key={l.href} href={l.href}>
                  {l.label}
                </a>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <a href="/app" className="nav-cta">
              Open app
            </a>

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? 'Close menu' : 'Open menu'}
              className="nav-menu-btn u-chip size-11 shrink-0 lg:hidden"
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
        <div id="mobile-nav" hidden={!open} className="u-card mx-auto mt-2 p-3 lg:hidden">
          <ul className="flex flex-col">
            {links.map((l) => (
              <li
                key={l.href}
                className="border-b border-[color:var(--border-hairline)] last:border-b-0"
              >
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex h-12 items-center px-2 text-[16px] font-medium text-[color:var(--ink)]"
                >
                  {l.label}
                </a>
              </li>
            ))}
            <li className="pt-3">
              <a href="/app" className="nav-cta flex w-full justify-center">
                Open app
              </a>
            </li>
          </ul>
        </div>
      </div>
    </header>
  );
}
