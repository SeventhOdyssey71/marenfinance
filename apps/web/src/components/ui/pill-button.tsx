import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight } from './icons';

type Size = 'sm' | 'md' | 'lg';
type Variant = 'primary' | 'secondary' | 'ghost';
/**
 * How the trailing icon is drawn.
 *   filled  a solid violet disc, for the one primary action on a view
 *   ring    a violet outline disc, for the nav CTA
 *   bare    the glyph alone, no disc, for secondary actions
 */
type Badge = 'filled' | 'ring' | 'bare';

// 44px min height everywhere (BRAND.md section 4), but tighter horizontally than
// the first pass. The reference pills are compact; ours were chunky enough that two
// side by side read as a toolbar rather than a choice.
const sizing: Record<Size, string> = {
  sm: 'h-11 pl-5 pr-2 text-sm gap-2.5',
  md: 'h-11 pl-6 pr-2 text-sm gap-3',
  lg: 'h-12 pl-7 pr-2 text-[0.9375rem] gap-4',
};

// Bare-arrow variants carry no circle, so they need real padding on the right
// instead of room for a badge.
const bareSizing: Record<Size, string> = {
  sm: 'h-11 px-5 text-sm gap-2.5',
  md: 'h-11 px-6 text-sm gap-3',
  lg: 'h-12 px-7 text-[0.9375rem] gap-3.5',
};

const badgeSizing: Record<Size, string> = {
  sm: 'size-7',
  md: 'size-8',
  lg: 'size-9',
};

const variants: Record<Variant, string> = {
  primary:
    'bg-white text-[#08080A] hover:bg-white/90 active:bg-white/80 font-medium border border-transparent',
  secondary:
    'bg-white/[0.07] text-text border border-white/[0.09] backdrop-blur-md hover:bg-white/[0.11] hover:border-white/[0.14] font-medium',
  ghost: 'bg-transparent text-text-muted hover:text-text border border-transparent font-medium',
};

const badgeVariants: Record<Variant, string> = {
  primary: 'bg-violet-500 text-white',
  secondary: 'bg-white/[0.06] text-text-muted border border-[var(--border-hairline)]',
  ghost: 'bg-white/[0.06] text-text-muted',
};

/** A violet outline disc rather than a solid one. */
const RING_BADGE = 'border border-violet-500/70 text-violet-500';

export type PillButtonProps = {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  /** Defaults to `filled` for primary, `bare` for everything else. */
  badge?: Badge;
  external?: boolean;
  className?: string;
  'aria-label'?: string;
};

/**
 * The Maren pill. Primary is a white fill with a circular violet icon badge on
 * the right; secondary is a raised surface with a hairline border.
 */
export function PillButton({
  href,
  children,
  variant = 'primary',
  size = 'md',
  icon,
  badge,
  external = false,
  className = '',
  ...rest
}: PillButtonProps) {
  const shape: Badge = badge ?? (variant === 'primary' ? 'filled' : 'bare');
  const glyph = icon ?? <ArrowUpRight className="size-4" />;

  const inner = (
    <>
      <span className="whitespace-nowrap">{children}</span>
      {shape === 'bare' ? (
        <span
          aria-hidden
          className="shrink-0 transition-transform duration-[120ms] ease-out group-hover:translate-x-0.5"
        >
          {glyph}
        </span>
      ) : (
        <span
          aria-hidden
          className={`grid shrink-0 place-items-center rounded-[var(--radius-pill)] transition-transform duration-[120ms] ease-out group-hover:translate-x-0.5 ${badgeSizing[size]} ${shape === 'ring' ? RING_BADGE : badgeVariants[variant]}`}
        >
          {glyph}
        </span>
      )}
    </>
  );

  const box = shape === 'bare' ? bareSizing[size] : sizing[size];
  const classes = `group inline-flex items-center justify-between rounded-[var(--radius-pill)] transition-colors duration-[120ms] ease-out ${box} ${variants[variant]} ${className}`;

  if (external) {
    return (
      <a href={href} className={classes} target="_blank" rel="noreferrer noopener" {...rest}>
        {inner}
      </a>
    );
  }

  return (
    <Link href={href} className={classes} {...rest}>
      {inner}
    </Link>
  );
}

/** A flat pill with no icon badge — used for the nav "Launch App" at sm sizes. */
export function TextPill({
  href,
  children,
  className = '',
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`bg-surface-raised text-text inline-flex h-11 items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] px-5 text-sm font-medium transition-colors duration-[120ms] ease-out hover:border-[var(--border-strong)] ${className}`}
    >
      {children}
    </Link>
  );
}
