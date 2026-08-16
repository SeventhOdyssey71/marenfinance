import type { ReactNode } from 'react';

export function Section({
  id,
  children,
  className = '',
  labelledBy,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      /* Section rhythm: 96px mobile, 128px desktop — BRAND.md §4 */
      className={`py-24 md:py-32 ${className}`}
    >
      {children}
    </section>
  );
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`t-label text-text-subtle ${className}`}>
      <span className="text-violet-400">/</span> {children}
    </p>
  );
}

/** The small "Built on Mezo" style capsule used above the hero headline. */
/**
 * The hero eyebrow. Glass, not violet, and sentence case.
 *
 * It previously carried a glowing violet dot and used `t-label`, which
 * uppercases and letter-spaces. That made a small chip the second-most saturated
 * element on the page and gave it the shouty look of a status badge, when it is
 * really just a quiet label. The dot in particular read as a live indicator —
 * BRAND.md reserves that treatment for things that carry an actual signal, and
 * "Built on Mezo" is a fact, not a state.
 *
 * Now a neutral frosted pill: a white wash at 6%, a hairline, real backdrop
 * blur, and sentence-case text at its natural width.
 */
export function EyebrowPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] bg-white/[0.06] px-5 py-2.5 backdrop-blur-md">
      <span className="text-text-muted text-sm font-medium leading-none">{children}</span>
    </span>
  );
}
