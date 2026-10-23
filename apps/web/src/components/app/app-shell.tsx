'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  ActivityIcon,
  ArrowUpRight,
  FinanceIcon,
  HomeIcon,
  Plus,
  ProfileIcon,
} from '@/components/ui/icons';
import { Wordmark } from '@/components/ui/wordmark';
import { ChainStatus, VaultProvenance } from '@/components/app/chain-status';
import { ConnectButton, NetworkGuard } from '@/components/app/wallet';

/**
 * The app shell.
 *
 * Desktop (lg and up): a grey rail with the wordmark, one "New payment" action, the four
 * destinations and the resources, then a top bar carrying where you are on the left and
 * which network and wallet on the right. The content is one centred column, because a
 * money app reads top to bottom, not across a dashboard.
 *
 * Below lg it is the native app: a top bar with the wordmark and the connect control, and
 * a flat tab bar along the bottom edge.
 *
 * The four destinations match iOS: Home, Finance, Activity, Profile. The shell owns
 * chrome only; every screen keeps its own states, reads and flows.
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

/** Where you are, for the top bar. Every route under /app has a name. */
const CRUMBS: ReadonlyArray<[string, string]> = [
  ['/app/finance', 'Finance'],
  ['/app/vault', 'Finance / Vault'],
  ['/app/earn', 'Finance / Earn'],
  ['/app/activity', 'Activity'],
  ['/app/profile', 'Profile'],
  ['/app/pay', 'Pay'],
  ['/app/x402', 'Pay / x402'],
];

function crumbFor(pathname: string): string {
  for (const [prefix, name] of CRUMBS) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return name;
  }
  return 'Home';
}

function HomeLink({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Maren Finance home"
      className={`-m-1.5 inline-flex w-fit p-1.5 ${className}`}
    >
      <Wordmark className="h-[22px] text-[22px]" />
    </Link>
  );
}

function RailLink({
  href,
  active,
  children,
  external = false,
}: {
  href: string;
  active?: boolean;
  children: ReactNode;
  external?: boolean;
}) {
  const cls = `flex h-12 items-center gap-3 px-3.5 text-[0.9375rem] transition-[color,background-color] duration-150 ease-out ${
    active ? 'bg-[#e9e9ed] text-text' : 'text-text-muted hover:bg-[#ececf0] hover:text-text'
  }`;
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={cls}>
      {children}
    </Link>
  );
}

/** Desktop rail. The mobile tab bar is a separate landmark that only exists below lg. */
function Rail({ pathname }: { pathname: string }) {
  return (
    <aside className="bg-rail fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-[var(--border-hairline)] lg:flex">
      <div className="px-6 pb-6 pt-7">
        <HomeLink />
      </div>

      <div className="px-3">
        <Link
          href="/app/pay"
          className="bg-surface flex h-12 items-center gap-3 border border-[var(--border-hairline)] px-3.5 text-[0.9375rem] transition-[border-color] duration-150 ease-out hover:border-[var(--border-strong)]"
        >
          <Plus className="size-[18px] text-violet-500" aria-hidden />
          New payment
        </Link>
      </div>

      <nav aria-label="App sections" className="mt-5 px-3">
        <ul className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <RailLink href={href} active={active}>
                  <Icon
                    className={`size-[20px] shrink-0 ${active ? 'text-text' : ''}`}
                    aria-hidden
                  />
                  {label}
                </RailLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-8 px-3">
        <p className="text-text-muted px-3.5 pb-2 text-[0.8125rem]">Resources</p>
        <ul className="flex flex-col gap-0.5">
          <li>
            <RailLink href="/docs" external>
              <span className="flex-1">Docs</span>
              <ArrowUpRight className="size-4 opacity-60" aria-hidden />
            </RailLink>
          </li>
        </ul>
      </div>

      <div className="text-text-muted mt-auto flex flex-col gap-3 px-6 pb-6 text-xs leading-relaxed">
        <p className="max-w-[60ch]">
          Testnet funds only. Maren’s contracts are pre-audit. Pooled collateral is segregated in
          accounting, not custody.
        </p>
        <VaultProvenance />
      </div>
    </aside>
  );
}

/** Mobile tab bar: a flat bar on the bottom edge, square, hairline on top. */
function TabBar({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="App sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border-hairline)] bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <ul className="mx-auto grid max-w-[520px] grid-cols-4">
        {NAV.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-1 text-[0.6875rem] transition-colors duration-150 ease-out ${
                  active ? 'text-text' : 'text-text-muted'
                }`}
              >
                <Icon className={`size-[22px] ${active ? 'text-violet-500' : ''}`} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function NetworkPill() {
  return (
    <span className="text-text-muted hidden items-center gap-2 text-[0.8125rem] sm:inline-flex">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-violet-500" />
      Mezo testnet
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/app';

  return (
    <div className="bg-canvas min-h-screen">
      <a
        href="#app-content"
        className="bg-ink sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      <Rail pathname={pathname} />

      <div className="flex min-h-screen flex-col lg:pl-[264px]">
        <header className="bg-canvas/90 sticky top-0 z-20 border-b border-[var(--border-hairline)] backdrop-blur-xl">
          <div className="flex h-16 w-full items-center justify-between gap-4 px-5 md:px-8 lg:px-12">
            <HomeLink className="lg:hidden" />
            <p className="text-text hidden text-[0.9375rem] lg:block">{crumbFor(pathname)}</p>
            <div className="flex items-center gap-5">
              <NetworkPill />
              <ConnectButton quiet />
            </div>
          </div>
        </header>

        <main
          id="app-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[880px] flex-1 px-5 pb-28 pt-2 outline-none md:px-8 lg:pb-20"
        >
          <div className="flex flex-col gap-4 empty:hidden">
            <NetworkGuard />
            <ChainStatus />
          </div>
          <div className="mt-2">{children}</div>

          <div className="text-text-muted mt-16 flex flex-col gap-3 border-t border-[var(--border-hairline)] pt-8 text-xs leading-relaxed lg:hidden">
            <p>
              Testnet funds only. Maren’s contracts are pre-audit. Pooled collateral is segregated
              in accounting, not custody.
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <VaultProvenance />
              <a href="/docs" className="hover:text-text transition-colors duration-150 ease-out">
                Docs
              </a>
            </div>
          </div>
        </main>
      </div>

      <TabBar pathname={pathname} />
    </div>
  );
}

export default AppShell;
