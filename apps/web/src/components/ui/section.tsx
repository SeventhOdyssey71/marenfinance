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
export function EyebrowPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2.5 rounded-[var(--radius-pill)] border border-[var(--border-hairline)] bg-white/[0.04] py-2 pl-2.5 pr-4 backdrop-blur-md">
      <span
        aria-hidden
        className="size-1.5 rounded-[var(--radius-pill)] bg-violet-400 shadow-[0_0_10px_2px_rgba(139,119,255,0.6)]"
      />
      <span className="t-label text-text-muted">{children}</span>
    </span>
  );
}
