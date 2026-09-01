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
    'bg-text text-bg hover:bg-text/90 active:bg-text/80 font-medium border border-transparent',
  secondary:
    'bg-text/[0.06] text-text border border-text/[0.10] backdrop-blur-md hover:bg-text/[0.10] hover:border-text/[0.15] font-medium',
  ghost: 'bg-transparent text-text-muted hover:text-text border border-transparent font-medium',
};

/**
 * Disabled paint, per variant.
 *
 * Held here rather than at the call site because a disabled control is now load-bearing in
 * this product: `lib/chain/preflight.ts` disables anything that cannot succeed, so the
 * disabled state is a state users will genuinely see, beside a sentence explaining it. It
 * has to read as "not available", not as "broken", and it has to stay legible — white at
 * 25% on `surface` is below AA, which is why primary keeps a 40% fill.
 */
const disabledVariants: Record<Variant, string> = {
  primary: 'disabled:bg-white/40 disabled:text-[#08080A]/70',
  secondary: 'disabled:text-text-subtle disabled:border-[var(--border-hairline)]',
  ghost: 'disabled:text-text-subtle',
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
  // Press-scale, matching PillAction: a link should feel as physical as a button.
  const classes = `group inline-flex items-center justify-between rounded-[var(--radius-pill)] transition-[color,background-color,border-color,transform] duration-[120ms] ease-out active:scale-[0.97] ${box} ${variants[variant]} ${className}`;

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

/**
 * The same pill, as a `<button>`.
 *
 * One definition of the Maren pill, shared by the marketing site's links and the dApp's
 * actions. It exists because the transaction sheet's confirm and close controls were a
 * plain grey blob — a `<button>` that had drifted away from the pill every other surface
 * uses, because the pill was only available as a `<Link>`. Anything that performs an
 * action rather than navigating renders this; `ActionButton` in `components/app/primitives`
 * is a thin alias kept for the call sites that already import it.
 *
 * The icon badge is opt-in here, unlike `PillButton`, where a navigating link always earns
 * its arrow. A confirm button with no badge is still the pill; a Cancel with a violet
 * badge would be shouting.
 */
export function PillAction({
  children,
  onClick,
  disabled = false,
  variant = 'primary',
  size = 'md',
  type = 'button',
  icon,
  className = '',
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: Variant;
  size?: Size;
  type?: 'button' | 'submit';
  icon?: ReactNode;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`group inline-flex items-center justify-between rounded-[var(--radius-pill)] transition-[color,background-color,border-color,transform] duration-[120ms] ease-out active:scale-[0.97] disabled:cursor-not-allowed ${sizing[size]} ${variants[variant]} ${disabledVariants[variant]} ${className}`}
      {...rest}
    >
      <span className="whitespace-nowrap">{children}</span>
      {/* The badge greys out with the button. A violet badge is the loudest thing on a
          Maren screen; leaving it at full strength on a disabled control points at the one
          thing the user cannot do. */}
      {icon ? (
        <span
          aria-hidden
          className={`group-disabled:text-text-subtle grid shrink-0 place-items-center rounded-[var(--radius-pill)] transition-transform duration-[120ms] ease-out group-enabled:group-hover:translate-x-0.5 group-disabled:bg-white/[0.06] ${badgeSizing[size]} ${badgeVariants[variant]}`}
        >
          {icon}
        </span>
      ) : null}
    </button>
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
      className={`bg-surface-raised text-text inline-flex h-11 items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] px-5 text-sm font-medium transition-[color,background-color,border-color,transform] duration-[120ms] ease-out hover:border-[var(--border-strong)] active:scale-[0.97] ${className}`}
    >
      {children}
    </Link>
  );
}
