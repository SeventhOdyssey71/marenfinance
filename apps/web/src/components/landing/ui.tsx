import type { ReactNode } from 'react';

/**
 * Blueprint primitives for the Maren landing — corner ticks, the mono eyebrow
 * badge, the section counter, and the bracket-cornered button. All paint lives
 * in `src/app/landing.css`, scoped under `.landing`.
 */

type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** `+` crosshair centred on a grid corner. Parent must be positioned. */
export function Tick({ corner }: { corner: Corner }) {
  return <span aria-hidden className={`l-tick l-tick-${corner}`} />;
}

/** All four corner ticks at once. */
export function Ticks() {
  return (
    <>
      <Tick corner="tl" />
      <Tick corner="tr" />
      <Tick corner="bl" />
      <Tick corner="br" />
    </>
  );
}

/** Mono eyebrow badge — ▪ LABEL — the tag above every section title. */
export function Kicker({ children }: { children: ReactNode }) {
  return (
    <span className="l-mono inline-flex items-center gap-2 border border-[color:var(--l-line)] bg-[var(--l-white)] px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-[var(--l-ink)]">
      <span aria-hidden className="inline-block size-2 bg-[var(--l-accent)]" />
      {children}
    </span>
  );
}

/** Section counter — [ 02 of 05 ] · Product */
export function Counter({ n, label, total = '05' }: { n: string; label: string; total?: string }) {
  return (
    <div className="l-mono text-[12px] uppercase tracking-[0.12em] text-[var(--l-dim)]">
      [ <span className="text-[var(--l-ink)]">{n}</span> of {total} ] · {label}
    </div>
  );
}

/** Bracket-cornered mono button. */
export function BracketButton({
  href,
  children,
  variant = 'solid',
  external,
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  variant?: 'solid' | 'ghost';
  external?: boolean;
  ariaLabel?: string;
}) {
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={`l-btn ${variant === 'solid' ? 'l-btn-solid' : 'l-btn-ghost'}`}
    >
      <span aria-hidden className="l-bracket" />
      <span aria-hidden className="l-bracket-2" />
      {children}
    </a>
  );
}

/** Diagonal-hatch spacer band. */
export function Hatch({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`l-hatch ${className}`} />;
}
