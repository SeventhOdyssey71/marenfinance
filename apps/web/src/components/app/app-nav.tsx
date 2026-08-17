'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Wordmark } from '@/components/ui/wordmark';
import { ConnectButton } from './wallet';

/**
 * The app's primary navigation.
 *
 * Same 72px bar, same wordmark, same pill language as the marketing nav — the dApp and
 * the site are one product, and a user who clicks "Launch App" should not feel handed
 * off to something else.
 */

const routes = [
  { href: '/app', label: 'Portfolio' },
  { href: '/app/vault', label: 'Vault' },
  { href: '/app/pay', label: 'Pay' },
  { href: '/app/earn', label: 'Earn' },
  { href: '/app/activity', label: 'Activity' },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="bg-bg/80 sticky top-0 z-40 border-b border-[var(--border-hairline)] backdrop-blur-xl">
      <div className="container-maren">
        <div className="flex h-[72px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-6">
            <Link
              href="/"
              className="-m-2 shrink-0 rounded-[var(--radius-pill)] p-2"
              aria-label="Maren Finance home"
            >
              <Wordmark className="h-[18px] w-auto" />
            </Link>

            <nav aria-label="App sections" className="hidden md:block">
              <ul className="flex items-center gap-1">
                {routes.map((route) => {
                  const active =
                    route.href === '/app' ? pathname === '/app' : pathname.startsWith(route.href);
                  return (
                    <li key={route.href}>
                      <Link
                        href={route.href}
                        aria-current={active ? 'page' : undefined}
                        className={`inline-flex h-9 items-center rounded-[var(--radius-pill)] px-3.5 text-sm transition-colors duration-[120ms] ease-out ${
                          active ? 'bg-surface-raised text-text' : 'text-text-muted hover:text-text'
                        }`}
                      >
                        {route.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>

          <ConnectButton />
        </div>

        {/* Narrow viewports get the same routes as a scrollable rail rather than a
            hamburger: five destinations is few enough to show, and a dashboard hides
            behind a menu at exactly the moment a user wants to compare two screens. */}
        <nav aria-label="App sections" className="bleed-x md:hidden">
          <ul className="flex items-center gap-1 overflow-x-auto pb-3">
            {routes.map((route) => {
              const active =
                route.href === '/app' ? pathname === '/app' : pathname.startsWith(route.href);
              return (
                <li key={route.href}>
                  <Link
                    href={route.href}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex h-9 items-center whitespace-nowrap rounded-[var(--radius-pill)] px-3.5 text-sm transition-colors duration-[120ms] ease-out ${
                      active ? 'bg-surface-raised text-text' : 'text-text-muted'
                    }`}
                  >
                    {route.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
