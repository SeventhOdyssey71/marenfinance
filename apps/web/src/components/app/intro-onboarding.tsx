'use client';

import { useEffect, useRef, useState } from 'react';

import { BoltIcon, Check, ShieldIcon, VaultIcon } from '@/components/ui/icons';
import { VALUE_PROPS, type ValueProp } from '@/lib/copy/value-props';

/**
 * The first-run web intro — the browser counterpart to iOS `IntroOnboardingView`.
 *
 * A brief splash on the Maren violet gradient, then the four value props (single-sourced
 * from `value-props.ts`, identical wording to iOS), ending on a non-custodial "you hold
 * the keys" screen whose CTA hands off to the real connect gate. Its only job is to be
 * shown once and then get out of the way: `AppShell` persists the `hasOnboarded` flag and
 * both "Get started" and "Skip" call `onComplete`.
 *
 * Like the iOS screen this commits to ONE deliberate look — a violet to near-black
 * gradient with white content — rather than following the app's light theme. The brand
 * hexes are inlined here for that reason: this is a single committed splash, not a themed
 * surface, and it must match the iOS gradient stop for stop.
 *
 * All motion is gated on `prefers-reduced-motion`. The scoped stylesheet below only
 * animates inside `@media (prefers-reduced-motion: no-preference)`, and the splash timer
 * is shortened when the person has asked to reduce motion.
 */

/** The per-prop illustration icon, picked without a typed lookup so each stays type-checked. */
function iconFor(key: ValueProp['key'], className: string) {
  switch (key) {
    case 'spend':
      return <VaultIcon className={className} />;
    case 'gasless':
      return <BoltIcon className={className} />;
    case 'honest':
      return <Check className={className} />;
    case 'keys':
      return <ShieldIcon className={className} />;
  }
}

export function IntroOnboarding({ onComplete }: { onComplete: () => void }) {
  const [showSplash, setShowSplash] = useState(true);
  const [page, setPage] = useState(0);
  const ctaRef = useRef<HTMLButtonElement>(null);

  const pages = VALUE_PROPS;
  const isLast = page === pages.length - 1;
  // VALUE_PROPS is a non-empty constant and `page` is bounded by `advance`, so this is
  // always present; the pager branch below is gated on it, which also narrows the type
  // away from `undefined` (noUncheckedIndexedAccess).
  const current = pages[page];

  // A brief splash, then reveal the story. Reduce Motion shortens it; the fade itself is
  // handled by the scoped stylesheet, which does nothing when motion is reduced.
  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setShowSplash(false), reduce ? 500 : 1400);
    return () => window.clearTimeout(timer);
  }, []);

  // Move keyboard focus onto the primary control once the story is showing, so Enter and
  // Space work without a hunt and the dialog has somewhere to land focus.
  useEffect(() => {
    if (!showSplash) ctaRef.current?.focus();
  }, [showSplash, page]);

  function advance() {
    if (isLast) onComplete();
    else setPage((p) => p + 1);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Maren"
      className="fixed inset-0 z-[60] flex flex-col overflow-hidden text-white"
      style={{
        background:
          'linear-gradient(to bottom, #6E4BFF 0%, #5B3DF5 42%, #2A1E52 78%, #141019 100%)',
      }}
    >
      <IntroStyles />

      {/* Decorative wash so it never swallows a tap meant for a control. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 60% at 50% 0%, rgba(255,255,255,0.12), transparent 60%)',
        }}
      />

      {showSplash ? (
        <div className="intro-splash relative flex flex-1 flex-col items-center justify-center gap-5">
          <MarkTile />
          <span
            className="text-[30px] leading-none"
            style={{
              fontFamily: 'var(--font-sf-rounded), ui-rounded, system-ui, sans-serif',
              fontWeight: 600,
            }}
          >
            Maren
          </span>
        </div>
      ) : current ? (
        <div className="intro-fade relative flex flex-1 flex-col">
          {/* Top bar — Skip, hidden on the final screen where there is nothing left to skip. */}
          <div className="flex h-14 items-center justify-end px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
            {!isLast ? (
              <button
                type="button"
                onClick={onComplete}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full px-3 text-[15px] font-medium text-white/70 transition-colors duration-150 ease-out hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 motion-safe:hover:text-white"
              >
                Skip
              </button>
            ) : null}
          </div>

          {/* One story screen, re-keyed so it re-runs its entrance on every page change. */}
          <div
            key={page}
            className="intro-page flex flex-1 flex-col items-center justify-center px-6 text-center"
          >
            <IconHalo prop={current} />
            <h1
              className="mt-8 max-w-[18ch] text-balance text-[clamp(28px,7vw,34px)] font-semibold leading-[1.1] tracking-[-0.01em]"
              style={{ fontFamily: 'var(--font-sf-rounded), ui-rounded, system-ui, sans-serif' }}
            >
              {current.headline}
            </h1>
            <p className="mt-4 max-w-[34ch] text-pretty text-[16px] leading-relaxed text-white/75">
              {current.subhead}
            </p>
            {isLast ? (
              <p className="num mt-6 text-xs uppercase tracking-[0.14em] text-white/45">
                testnet · pre-audit
              </p>
            ) : null}
          </div>

          {/* Page dots. */}
          <div className="flex items-center justify-center gap-2 pb-6" aria-hidden>
            {pages.map((p, i) => (
              <span
                key={p.key}
                className="intro-dot h-[7px] rounded-full bg-white transition-[width,opacity] duration-300 ease-out"
                style={{ width: i === page ? 22 : 7, opacity: i === page ? 0.95 : 0.3 }}
              />
            ))}
          </div>

          {/* The one high-contrast focal control: a white pill with violet text. The app's
              primary button is a violet fill, which would vanish on this gradient. */}
          <div className="px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              ref={ctaRef}
              type="button"
              onClick={advance}
              className="inline-flex h-14 w-full items-center justify-center rounded-full bg-white text-[17px] font-medium text-[#5b3df5] transition-transform duration-200 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-safe:active:scale-[0.97]"
            >
              {isLast ? 'Get started' : 'Continue'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The Maren mark on a white tile — high contrast on the gradient, mirroring iOS MarkTile. */
function MarkTile() {
  return (
    <span
      aria-hidden
      className="grid size-24 place-items-center rounded-[26px] bg-white text-[52px] leading-none text-[#5b3df5]"
      style={{
        fontFamily: 'var(--font-sf-rounded), ui-rounded, system-ui, sans-serif',
        fontWeight: 700,
      }}
    >
      M
    </span>
  );
}

/** The per-prop illustration: the app icon inside a soft white halo. */
function IconHalo({ prop }: { prop: ValueProp }) {
  return (
    <span
      aria-hidden
      className="grid size-[132px] place-items-center rounded-full border border-white/20 bg-white/10"
    >
      {iconFor(prop.key, 'size-14 text-white')}
    </span>
  );
}

/**
 * Scoped entrance animations, all inside the reduced-motion guard so they simply do not
 * run for anyone who has asked to reduce motion. `key={page}` on the page re-triggers the
 * fade on each advance.
 */
function IntroStyles() {
  return (
    <style>{`
      @media (prefers-reduced-motion: no-preference) {
        .intro-splash { animation: introSplash 500ms ease-out both; }
        .intro-fade { animation: introFade 400ms ease-out both; }
        .intro-page { animation: introFade 400ms ease-out both; }
      }
      @keyframes introSplash {
        from { opacity: 0; transform: scale(1.04); }
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes introFade {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: none; }
      }
    `}</style>
  );
}
