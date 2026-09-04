import type { ReactNode } from 'react';

/**
 * UGLYCASH primitives for the Maren landing. All paint lives in
 * `src/app/landing.css`, scoped under `.landing`.
 */

/** Eyebrow tag — a small bordered sticker above a section title. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="u-tag">
      <span aria-hidden className="u-tag-dot" />
      {children}
    </span>
  );
}
