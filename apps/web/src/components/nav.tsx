'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Wordmark } from './ui/wordmark';

type NavLink = { href: string; label: string; external?: boolean };

const links: readonly NavLink[] = [
  { href: '#product', label: 'Product' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#mezo', label: 'Built on Mezo' },
  { href: '/docs', label: 'Docs' },
  { href: '#faq', label: 'FAQ' },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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
    <header
      className="sticky top-0 z-50 border-b transition-colors duration-[240ms] ease-out"
      style={{
        borderColor: 'var(--l-line)',
        background: scrolled || open ? 'color-mix(in srgb, var(--l-canvas) 86%, transparent)' : 'transparent',
        backdropFilter: scrolled || open ? 'blur(10px)' : undefined,
        WebkitBackdropFilter: scrolled || open ? 'blur(10px)' : undefined,
      }}
    >
      <div className="l-frame flex items-center justify-between px-5 py-3.5 sm:px-8">
        <Link
          href="/"
          className="-m-2 shrink-0 rounded-[var(--radius-pill)] p-2 text-[var(--l-ink)]"
          aria-label="Maren Finance, home"
        >
          <Wordmark className="h-[18px] w-auto" />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              {...(l.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
              className="text-[14px] font-medium text-[var(--l-muted)] transition-colors duration-[120ms] ease-out hover:text-[var(--l-ink)]"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          <Link
            href="/app"
            className="l-btn l-btn-solid hidden !h-9 !px-4 sm:inline-flex"
          >
            <span aria-hidden className="l-bracket" />
            <span aria-hidden className="l-bracket-2" />
            Launch app
          </Link>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="grid size-11 shrink-0 place-items-center border border-[color:var(--l-line)] bg-[var(--l-white)] text-[var(--l-ink)] md:hidden"
          >
            <svg
              viewBox="0 0 20 20"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
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

      <div
        id="mobile-nav"
        hidden={!open}
        className="border-t border-[color:var(--l-line)] bg-[var(--l-canvas)] md:hidden"
      >
        <ul className="l-frame flex flex-col px-5 py-4 sm:px-8">
          {links.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                {...(l.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                onClick={() => setOpen(false)}
                className="flex h-12 items-center text-[1.0625rem] text-[var(--l-muted)]"
              >
                {l.label}
              </a>
            </li>
          ))}
          <li className="pt-3">
            <Link
              href="/app"
              onClick={() => setOpen(false)}
              className="l-btn l-btn-solid w-full"
            >
              <span aria-hidden className="l-bracket" />
              <span aria-hidden className="l-bracket-2" />
              Launch app
            </Link>
          </li>
        </ul>
      </div>
    </header>
  );
}
