'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ActivityIcon, FinanceIcon, HomeIcon, ProfileIcon } from '@/components/ui/icons';
import { Wordmark } from '@/components/ui/wordmark';
import { ChainStatus, VaultProvenance } from '@/components/app/chain-status';
import { ConnectButton, NetworkGuard } from '@/components/app/wallet';

/**
 * The app shell.
 *
 * Desktop (lg and up) is a web app, not a phone screenshot: a quiet sidebar holds the
 * wordmark, the four destinations and the disclosure, and the content gets a real
 * working width on the canvas. Below lg it is the native app: a top bar with the
 * wordmark and the connect control, and a floating tab bar at the thumb.
 *
 * The four destinations match iOS: Home, Finance, Activity, Profile. Money flows
 * (Send, Receive, Borrow, Deposit) launch from the screens, never from the nav.
 *
 * The shell owns chrome only. Every screen keeps its own connected and disconnected
 * states, its own contract reads and its own flows.
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

/** Home matches exactly; everything else matches its subtree (Vault and Earn light Finance). */
function isActive(pathname: string, href: string): boolean {
  if (href === '/app') return pathname === '/app';
  if (href === '/app/finance')
    return ['/app/finance', '/app/vault', '/app/earn'].some(
      (p) => pathname === p || pathname.startsWith(p + '/'),
    );
  return pathname === href || pathname.startsWith(href + '/');
}

function HomeLink({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Maren Finance home"
      className={`-m-1.5 inline-flex w-fit rounded-[10px] p-1.5 ${className}`}
    >
      <Wordmark className="h-[20px] text-[19px]" />
    </Link>
  );
}

/** Desktop rail. One list; the mobile tab bar below is a separate landmark only at < lg. */
function SideNav({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="App sections" className="mt-8">
      <ul className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-10 items-center gap-3 rounded-[10px] px-3 text-[0.9375rem] transition-[color,background-color] duration-150 ease-out ${
                  active
                    ? 'bg-surface text-text font-medium shadow-[0_0_0_1px_var(--border-hairline),var(--shadow-card)]'
                    : 'text-text-muted hover:text-text hover:bg-text/[0.04]'
                }`}
              >
                <Icon
                  className={`size-[18px] shrink-0 ${active ? 'text-violet-500' : ''}`}
                  aria-hidden
                />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Mobile tab bar: floating, glass, thumb-reachable. Hidden at lg, where the rail takes over. */
function TabBar({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="App sections"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(0.875rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <ul className="flex items-center gap-0.5 rounded-[var(--radius-pill)] border border-[var(--border-hairline)] bg-white/85 p-1 shadow-[var(--shadow-pop)] backdrop-blur-xl">
        {NAV.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[48px] min-w-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-[var(--radius-pill)] px-3 py-1.5 text-[0.6875rem] transition-colors duration-150 ease-out ${
                  active ? 'bg-surface-inset text-text font-medium' : 'text-text-muted'
                }`}
              >
                <Icon className={`size-[20px] ${active ? 'text-violet-500' : ''}`} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The pre-audit disclosure and provenance, the two facts a user most needs. */
function Disclosure({ className = '' }: { className?: string }) {
  return (
    <div className={`text-text-muted flex flex-col gap-3 text-xs leading-relaxed ${className}`}>
      <p className="flex items-center gap-2">
        <span aria-hidden className="bg-success size-1.5 shrink-0 rounded-full" />
        <span>Mezo testnet</span>
      </p>
      <p className="max-w-[60ch]">
        Testnet funds only. Maren’s contracts are pre-audit. Pooled collateral is segregated in
        accounting, not custody.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <VaultProvenance />
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-text transition-colors duration-150 ease-out"
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
    <div className="bg-canvas min-h-screen">
      <a
        href="#app-content"
        className="bg-ink sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-pill)] focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-[var(--border-hairline)] px-5 pb-6 pt-6 lg:flex">
        <HomeLink />
        <SideNav pathname={pathname} />
        <div className="mt-auto">
          <Disclosure />
        </div>
      </aside>

      <div className="flex min-h-screen flex-col lg:pl-[248px]">
        {/* Top bar: wordmark on mobile, connect control everywhere */}
        <header className="bg-canvas/85 sticky top-0 z-20 backdrop-blur-xl">
          <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between gap-4 px-5 md:px-8">
            <HomeLink className="lg:hidden" />
            <span className="hidden lg:block" />
            <ConnectButton />
          </div>
        </header>

        <main
          id="app-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1120px] flex-1 px-5 pb-32 pt-2 outline-none md:px-8 lg:pb-16"
        >
          <div className="flex flex-col gap-4 empty:hidden">
            <NetworkGuard />
            <ChainStatus />
          </div>
          <div className="mt-2">{children}</div>

          <div className="hairline-t mt-14 pt-8 lg:hidden">
            <Disclosure />
          </div>
        </main>
      </div>

      <TabBar pathname={pathname} />
    </div>
  );
}

export default AppShell;
