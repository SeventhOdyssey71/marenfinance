'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Sidebar, type SidebarGroup } from './sidebar';
import { TESTFLIGHT_URL } from '@/lib/links';
import { ThemeToggle } from './theme-toggle';
import { IconMenu, IconClose } from './icons';

export function DocsShell({ nav, children }: { nav: SidebarGroup[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 781px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  // Lock the page scroll behind the mobile drawer, and close it on Escape.
  useEffect(() => {
    document.documentElement.style.overflow = open ? 'hidden' : '';
    if (!open) return;
    drawer.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        menu.current?.focus();
      }
      if (e.key === 'Tab') {
        const items = drawer.current?.querySelectorAll<HTMLElement>('a[href], button');
        const first = items?.[0];
        const last = items?.[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="doc-shell">
      <header className="doc-topbar">
        <button
          ref={menu}
          type="button"
          className="doc-menu-btn"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          aria-controls="docs-drawer"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <IconClose /> : <IconMenu />}
        </button>

        <Link href="/docs" className="doc-brand" aria-label="Maren docs home">
          {/* The real brand mark, the same asset the app nav uses. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="doc-mark" src="/brand/maren-mark.png" alt="" aria-hidden />
          <span>Maren</span>
        </Link>

        <Link className="doc-toplink" href="/docs/get-started/quickstart">
          Start testing
        </Link>

        <div className="doc-topbar-spacer" />

        <a className="doc-toplink" href={TESTFLIGHT_URL} target="_blank" rel="noreferrer noopener">
          <span>iOS beta</span>
        </a>
        <ThemeToggle />
      </header>

      <aside className="doc-side">
        <Sidebar nav={nav} />
      </aside>

      <main className="doc-main" inert={open}>
        {children}
      </main>

      {open ? (
        <div className="doc-drawer">
          <div className="doc-drawer-scrim" onClick={() => setOpen(false)} aria-hidden />
          <div
            ref={drawer}
            id="docs-drawer"
            className="doc-drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Documentation navigation"
          >
            <button
              type="button"
              className="doc-toplink"
              onClick={() => {
                setOpen(false);
                menu.current?.focus();
              }}
            >
              <IconClose /> Close navigation
            </button>
            <Sidebar nav={nav} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
