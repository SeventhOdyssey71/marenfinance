'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Sidebar, type SidebarGroup } from './sidebar';
import { ThemeToggle } from './theme-toggle';
import { IconGithub, IconSearch, IconMenu, IconClose } from './icons';

export function DocsShell({
  nav,
  githubHref,
  children,
}: {
  nav: SidebarGroup[];
  githubHref: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // Lock the page scroll behind the mobile drawer, and close it on Escape.
  useEffect(() => {
    document.documentElement.style.overflow = open ? 'hidden' : '';
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
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
          type="button"
          className="doc-menu-btn"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
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

        <div className="doc-search" role="button" tabIndex={0} aria-label="Search the docs">
          <IconSearch />
          <span>Search or ask</span>
          <span className="doc-search-k">⌘K</span>
        </div>

        <div className="doc-topbar-spacer" />

        <a className="doc-toplink" href={githubHref} target="_blank" rel="noreferrer noopener">
          <IconGithub />
          <span className="doc-toplink-label">GitHub</span>
        </a>
        <ThemeToggle />
      </header>

      <aside className="doc-side">
        <Sidebar nav={nav} />
      </aside>

      <main className="doc-main">{children}</main>

      {open ? (
        <div className="doc-drawer">
          <div className="doc-drawer-scrim" onClick={() => setOpen(false)} aria-hidden />
          <div className="doc-drawer-panel">
            <Sidebar nav={nav} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
