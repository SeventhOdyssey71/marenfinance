import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * UGLYCASH primitives for the Maren landing — the sticker button and the
 * eyebrow tag. All paint lives in `src/app/landing.css`, scoped under
 * `.landing`. Borders are the structure; there are no shadows.
 */

type ButtonVariant = 'cta' | 'ghost' | 'dark';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  cta: 'u-btn-cta',
  ghost: 'u-btn-ghost',
  dark: 'u-btn-dark',
};

/** Sticker button — 1px black border, 16px radius, Inter 14/700 black. */
export function StickerButton({
  href,
  children,
  variant = 'cta',
  external,
  ariaLabel,
  className = '',
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  external?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const cls = `u-btn ${VARIANT_CLASS[variant]} ${className}`.trim();
  if (external || href.startsWith('http') || href.startsWith('#')) {
    return (
      <a
        href={href}
        aria-label={ariaLabel}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className={cls}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} aria-label={ariaLabel} className={cls}>
      {children}
    </Link>
  );
}

/** Eyebrow tag — a small bordered sticker above a section title. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="u-tag">
      <span aria-hidden className="u-tag-dot" />
      {children}
    </span>
  );
}
