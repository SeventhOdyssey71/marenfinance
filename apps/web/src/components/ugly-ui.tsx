import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * UGLYCASH primitives for the Maren landing — the pill button and the eyebrow
 * tag. All paint lives in `src/app/landing.css`, scoped under `.landing`.
 * Surfaces are soft and borderless; the primary "glow" pill carries a pink→
 * violet glassmorphic halo, quiet buttons a soft grey fill.
 */

type ButtonVariant = 'glow' | 'cta' | 'ghost' | 'dark';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  glow: 'u-btn-glow', // primary — soft pink/violet halo
  cta: 'u-btn-cta', // lime
  ghost: '', // base soft-grey pill
  dark: 'u-btn-dark',
};

/** A borderless pill. `glow` for the primary CTA, `ghost` for a quiet action. */
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
