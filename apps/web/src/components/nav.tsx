'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Wordmark } from './ui/wordmark';
import { ArrowUpRight } from './ui/icons';

type NavLink = { href: string; label: string; external?: boolean };

const links: readonly NavLink[] = [
  { href: '#product', label: 'Product' },
  { href: '#how-it-works', label: 'How it works' },
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

  // Lock the page behind the mobile sheet.
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
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-[240ms] ease-out ${
        scrolled || open
          ? 'bg-[#08080A]/72 border-b border-[var(--border-hairline)] backdrop-blur-xl'
          : 'border-b border-transparent'
      }`}
    >
      <nav aria-label="Primary" className="container-maren">
        <div className="flex h-[72px] items-center justify-between gap-6">
          <Link
            href="/"
            className="-m-2 shrink-0 rounded-[var(--radius-pill)] p-2"
            aria-label="Maren Finance home"
          >
            <Wordmark className="h-[18px] w-auto" />
          </Link>

          <ul className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  {...(l.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                  className="text-text-muted hover:text-text inline-flex h-9 items-center rounded-[var(--radius-pill)] px-3.5 text-sm transition-colors duration-[120ms] ease-out"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <Link
              href="/app"
              className="group hidden h-11 items-center gap-2.5 rounded-[var(--radius-pill)] bg-white pl-5 pr-2 text-sm font-medium text-violet-600 transition-colors duration-[120ms] ease-out hover:bg-white/90 sm:inline-flex"
            >
              Launch App
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-violet-500/70 text-violet-600 transition-transform duration-[120ms] ease-out group-hover:translate-x-0.5"
              >
                <ArrowUpRight className="size-4" />
              </span>
            </Link>

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? 'Close menu' : 'Open menu'}
              className="bg-surface-raised text-text grid size-11 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] md:hidden"
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
      </nav>

      <div
        id="mobile-nav"
        hidden={!open}
        className="border-t border-[var(--border-hairline)] bg-[#08080A]/95 backdrop-blur-xl md:hidden"
      >
        <ul className="container-maren flex flex-col py-4">
          {links.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                {...(l.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                onClick={() => setOpen(false)}
                className="text-text-muted flex h-12 items-center text-[1.0625rem]"
              >
                {l.label}
              </a>
            </li>
          ))}
          <li className="pt-3">
            <Link
              href="/app"
              onClick={() => setOpen(false)}
              className="flex h-12 w-full items-center justify-between rounded-[var(--radius-pill)] bg-white pl-6 pr-2 font-medium text-violet-600"
            >
              Launch App
              <span
                aria-hidden
                className="grid size-8 place-items-center rounded-[var(--radius-pill)] border border-violet-500/70 text-violet-600"
              >
                <ArrowUpRight className="size-4" />
              </span>
            </Link>
          </li>
        </ul>
      </div>
    </header>
  );
}
