import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight } from './icons';

type Size = 'sm' | 'md' | 'lg';
type Variant = 'primary' | 'secondary' | 'ghost';

const sizing: Record<Size, string> = {
  // 44px min height everywhere — BRAND.md §4
  sm: 'h-11 pl-5 pr-2 text-sm gap-3',
  md: 'h-12 pl-6 pr-2 text-[0.9375rem] gap-4',
  lg: 'h-14 pl-7 pr-2.5 text-base gap-5',
};

const badgeSizing: Record<Size, string> = {
  sm: 'size-8',
  md: 'size-9',
  lg: 'size-10',
};

const variants: Record<Variant, string> = {
  primary:
    'bg-white text-[#08080A] hover:bg-white/90 active:bg-white/80 font-medium border border-transparent',
  secondary:
    'bg-surface-raised text-text border border-[var(--border-hairline)] hover:border-[var(--border-strong)] hover:bg-[#1D1D22] font-medium',
  ghost: 'bg-transparent text-text-muted hover:text-text border border-transparent font-medium',
};

const badgeVariants: Record<Variant, string> = {
  primary: 'bg-violet-500 text-white',
  secondary: 'bg-white/[0.06] text-text-muted border border-[var(--border-hairline)]',
  ghost: 'bg-white/[0.06] text-text-muted',
};

export type PillButtonProps = {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
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
  external = false,
  className = '',
  ...rest
}: PillButtonProps) {
  const inner = (
    <>
      <span className="whitespace-nowrap">{children}</span>
      <span
        aria-hidden
        className={`grid shrink-0 place-items-center rounded-[var(--radius-pill)] transition-transform duration-[120ms] ease-out group-hover:translate-x-0.5 ${badgeSizing[size]} ${badgeVariants[variant]}`}
      >
        {icon ?? <ArrowUpRight className="size-4" />}
      </span>
    </>
  );

  const classes = `group inline-flex items-center justify-between rounded-[var(--radius-pill)] transition-colors duration-[120ms] ease-out ${sizing[size]} ${variants[variant]} ${className}`;

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
