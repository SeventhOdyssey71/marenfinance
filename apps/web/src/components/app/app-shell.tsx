'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ActivityIcon, FinanceIcon, HomeIcon, ProfileIcon } from '@/components/ui/icons';
import { ChainStatus, VaultProvenance } from '@/components/app/chain-status';
import { IntroOnboarding } from '@/components/app/intro-onboarding';
import { ConnectButton, NetworkGuard } from '@/components/app/wallet';

/**
 * The first-run flag, same semantics as the iOS `hasOnboarded` boolean: written once when
 * the intro is finished or skipped, and its presence means "do not show the intro again".
 */
const ONBOARDED_KEY = 'maren.hasOnboarded';

/**
 * The app shell — the native app, running in a browser.
 *
 * The dApp is a phone experience on every screen size: one centered narrow column, a
 * quiet top bar (wordmark + connect control) and a floating glass bottom-nav pill with
 * the four fixed destinations the native app carries — Home, Finance, Activity, Profile.
 * The money flows (Send, Receive, Borrow, Deposit) are launched from Home, never a
 * top-level peer, exactly as they are on iOS. There is no desktop sidebar and no wide
 * dashboard: the same layout at 360px and at 1440px, so the product reads as the phone
 * app it is a port of.
 *
 * The shell owns chrome only. Every screen keeps its own connected / disconnected states,
 * its own contract reads, and its own flows — this frames them.
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

/** The wordmark — SF Pro Rounded, the app's friendly display face, sentence case. */
function Wordmark() {
  return (
    <Link
      href="/"
      aria-label="Maren Finance home"
      className="-m-2 inline-flex w-fit rounded-[var(--radius-pill)] p-2"
    >
      <span
        className="text-[22px] leading-none tracking-[-0.02em] text-[color:var(--color-text)]"
        style={{
          fontFamily: 'var(--font-sf-rounded), ui-rounded, system-ui, sans-serif',
          fontWeight: 600,
        }}
      >
        Maren
      </span>
    </Link>
  );
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

  /**
   * The first-run intro, gated on localStorage so it shows once and then never again. It
   * mounts only AFTER the effect runs, so a returning visitor (the common case) never sees
   * the violet splash flash over the app; a brand-new visitor sees a beat of the app chrome
   * before the opaque overlay covers it, which is the acceptable side of that trade. This
   * is deliberately before the connect gate: the intro's final CTA hands off to the normal
   * signed-out screen, which owns SignIn.
   */
  const [showIntro, setShowIntro] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(ONBOARDED_KEY) !== '1') setShowIntro(true);
    } catch {
      // Private-mode or blocked storage: no persistence, so treat as already onboarded
      // rather than trapping the person on an intro that can never be dismissed.
    }
  }, []);

  function finishIntro() {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
    } catch {
      // Storage unavailable — the flag will not persist, but the intro still closes for
      // this session, which is the honest best-effort.
    }
    setShowIntro(false);
  }

  return (
    <div className="min-h-screen">
      {/* The phone column — one centered narrow frame at every width. */}
      <div className="mx-auto flex min-h-screen w-full max-w-[30rem] flex-col px-5">
        {/* Top bar — transparent, scrolls with the page. */}
        <header className="flex items-center justify-between pb-2 pt-5">
          <Wordmark />
          <ConnectButton />
        </header>

        <main id="app-content" className="flex-1 pb-28 pt-3">
          <div className="flex flex-col gap-4">
            <NetworkGuard />
            <ChainStatus />
          </div>
          <div className="mt-5">{children}</div>

          <div className="hairline-t mt-12 pt-8">
            <Disclosure />
          </div>
        </main>
      </div>

      {/* Bottom nav — a floating glass pill, on every screen size. */}
      <nav
        aria-label="App sections"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <ul className="bg-surface-raised/90 flex items-center gap-1 rounded-[var(--radius-pill)] p-1.5 shadow-[0_1px_2px_rgba(16,16,19,0.05),0_12px_32px_-12px_rgba(16,16,19,0.28)] backdrop-blur-xl">
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

      {/* First-run intro, above the bottom nav (z-40). Opaque, so it fully covers the app
          it is handing off to. */}
      {showIntro ? <IntroOnboarding onComplete={finishIntro} /> : null}
    </div>
  );
}

export default AppShell;
