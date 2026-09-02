'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  ActivityIcon,
  FinanceIcon,
  HomeIcon,
  ProfileIcon,
} from '@/components/ui/icons';
import { ChainStatus, VaultProvenance } from '@/components/app/chain-status';
import { ConnectButton, NetworkGuard } from '@/components/app/wallet';

/**
 * The app shell — a left sidebar on desktop, a bottom nav on mobile.
 *
 * This replaces the single top bar the dApp shipped with, and adopts the shape a
 * wallet is navigated from: four fixed destinations always in reach, and the money
 * flows (Send, Split, Request, Link, Receive) launched from Home rather than sitting
 * as a top-level peer. The four are Home, Finance, Activity, Profile.
 *
 *   lg+   →  a 240px fixed left sidebar: wordmark, the four primary items, then an
 *            account footer with the connect control and the pre-audit disclosure.
 *   <lg   →  a transparent top bar (wordmark + connect control), the content, and a
 *            floating glass bottom-nav pill carrying the same four items.
 *
 * The shell owns chrome only. Every screen keeps its own connected / disconnected
 * states, its own data reads, and its own flows — this moves them under one frame.
 */

type NavItem = {
  href: string;
  label: string;
  Icon: typeof HomeIcon;
};

const NAV: readonly NavItem[] = [
  { href: '/app', label: 'Home', Icon: HomeIcon },
  { href: '/app/finance', label: 'Finance', Icon: FinanceIcon },
  { href: '/app/activity', label: 'Activity', Icon: ActivityIcon },
  { href: '/app/profile', label: 'Profile', Icon: ProfileIcon },
] as const;

/**
 * Home matches exactly; everything else matches its subtree, so `/app/finance` stays
 * lit while a Vault or Earn sub-section is open. `/app` cannot use `startsWith` or it
 * would light for every route in the app.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === '/app') return pathname === '/app';
  return pathname === href || pathname.startsWith(href + '/');
}

/** The pre-audit disclosure and provenance — the two facts a user most needs. */
function Disclosure({ className = '' }: { className?: string }) {
  return (
    <div className={`text-text-subtle flex flex-col gap-3 text-xs leading-relaxed ${className}`}>
      <p className="max-w-[60ch]">
        Pre-audit: MarenVault and MarenPay hold user funds and have not been audited. Pooled
        collateral is segregated in accounting, not custody.
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <VaultProvenance />
        <a
          href="https://github.com/SeventhOdyssey71/marenfinance/tree/main/docs"
          target="_blank"
          rel="noreferrer noopener"
          className="text-text-muted hover:text-text transition-colors duration-[120ms] ease-out"
        >
          Docs
        </a>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/app';

  return (
    <div className="min-h-screen">
      {/* ── Desktop sidebar (lg+) ── */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col bg-bg px-4 py-6 lg:flex">
        <Link
          href="/"
          aria-label="Maren Finance home"
          className="-m-2 mb-8 inline-flex w-fit rounded-[var(--radius-pill)] p-2"
        >
          <span
            className="text-[22px] uppercase leading-none tracking-[-0.03em] text-[color:var(--color-text)]"
            style={{ fontFamily: 'var(--font-anton), Arial Narrow, sans-serif' }}
          >
            Maren
          </span>
        </Link>

        <nav aria-label="App sections" className="flex flex-col gap-1">
          {NAV.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`group flex items-center gap-3 rounded-[var(--radius-input)] px-3 py-2.5 text-sm transition-colors duration-[120ms] ease-out ${
                  active
                    ? 'bg-surface-inset text-text font-medium'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                <Icon
                  className={`size-[18px] shrink-0 ${active ? 'text-violet-500' : ''}`}
                />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Account and disclosure sit at the foot of the rail. */}
        <div className="mt-auto flex flex-col gap-5 pt-6">
          <ConnectButton />
          <Disclosure />
        </div>
      </aside>

      {/* ── Mobile top bar (<lg) ── transparent, scrolls with the page. */}
      <header className="flex items-center justify-between px-5 pb-2 pt-5 lg:hidden">
        <Link
          href="/"
          aria-label="Maren Finance home"
          className="-m-2 inline-flex rounded-[var(--radius-pill)] p-2"
        >
          <span
            className="text-[22px] uppercase leading-none tracking-[-0.03em] text-[color:var(--color-text)]"
            style={{ fontFamily: 'var(--font-anton), Arial Narrow, sans-serif' }}
          >
            Maren
          </span>
        </Link>
        <ConnectButton />
      </header>

      {/* ── Content column ── offset past the fixed sidebar on desktop. */}
      <div className="lg:pl-60">
        <main id="app-content" className="container-maren pb-28 pt-4 lg:pb-16 lg:pt-10">
          <div className="flex flex-col gap-6">
            <NetworkGuard />
            <ChainStatus />
          </div>
          <div className="mt-6 lg:mt-8">{children}</div>

          {/* The disclosure follows the content on mobile; the sidebar carries it on
              desktop, so it is hidden there to avoid saying the same thing twice. */}
          <div className="hairline-t mt-12 pt-8 lg:hidden">
            <Disclosure />
          </div>
        </main>
      </div>

      {/* ── Mobile bottom nav (<lg) ── a floating glass pill. */}
      <nav
        aria-label="App sections"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 lg:hidden"
      >
        <ul className="flex items-center gap-1 rounded-[var(--radius-pill)] bg-surface-raised/90 p-1.5 shadow-[0_1px_2px_rgba(16,16,19,0.05),0_12px_32px_-12px_rgba(16,16,19,0.28)] backdrop-blur-xl">
          {NAV.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-label={label}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-w-[4.25rem] flex-col items-center gap-1 rounded-[var(--radius-pill)] px-3 py-2 text-[0.6875rem] transition-colors duration-[120ms] ease-out ${
                    active ? 'bg-surface-inset text-text font-medium' : 'text-text-muted'
                  }`}
                >
                  <Icon className={`size-[20px] ${active ? 'text-violet-500' : ''}`} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export default AppShell;
