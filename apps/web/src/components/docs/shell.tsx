'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Sidebar, type SidebarGroup } from './sidebar';
import { ThemeToggle } from './theme-toggle';
import { IconMenu, IconClose } from './icons';

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link href="/docs" className="doc-brand" aria-label="Maren docs home" onClick={onNavigate}>
      {/* The real brand mark, the same asset the app nav uses. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="doc-mark" src="/brand/maren-mark.png" alt="" aria-hidden />
      <span>Maren</span>
      <span className="doc-brand-sub">Docs</span>
    </Link>
  );
}

function TopLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <Link className="doc-toplink" href="/docs/get-started/quickstart" onClick={onNavigate}>
        Start testing
      </Link>
      <Link className="doc-toplink" href="/app" onClick={onNavigate}>
        Open app
      </Link>
    </>
  );
}

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

  // Lock the page scroll behind the mobile drawer, trap focus in it, close on Escape.
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
          className="doc-iconbtn doc-menu-btn"
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="docs-drawer"
          onClick={() => setOpen(true)}
        >
          <IconMenu />
        </button>

        <Brand />

        <div className="doc-topbar-spacer" />

        <div className="doc-topbar-links">
          <TopLinks />
        </div>
        <span className="doc-topbar-sep" aria-hidden />
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
            <div className="doc-drawer-head">
              <button
                type="button"
                className="doc-iconbtn doc-drawer-close"
                aria-label="Close navigation"
                onClick={() => {
                  setOpen(false);
                  menu.current?.focus();
                }}
              >
                <IconClose />
              </button>
              <Brand onNavigate={() => setOpen(false)} />
            </div>
            <div className="doc-drawer-body">
              <Sidebar nav={nav} onNavigate={() => setOpen(false)} />
            </div>
            <div className="doc-drawer-foot">
              <TopLinks onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
