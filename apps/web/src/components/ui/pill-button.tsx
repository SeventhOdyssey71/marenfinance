import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowUpRight } from './icons';

type Size = 'sm' | 'md' | 'lg';
type Variant = 'primary' | 'secondary' | 'ghost' | 'dark';
/**
 * How the trailing icon is drawn.
 *   filled  a soft disc behind the glyph, for the one primary action on a view
 *   ring    an outlined disc
 *   bare    the glyph alone, for secondary actions
 */
type Badge = 'filled' | 'ring' | 'bare';

// 44px is the default target (md). sm is for dense toolbars on desktop, lg for heroes.
const sizing: Record<Size, string> = {
  sm: 'h-9 pl-4 pr-1.5 text-[0.8125rem] gap-2',
  md: 'h-11 pl-5 pr-1.5 text-[0.9375rem] gap-3',
  lg: 'h-[52px] pl-6 pr-2 text-[0.9375rem] gap-3.5',
};

const bareSizing: Record<Size, string> = {
  sm: 'h-9 px-4 text-[0.8125rem] gap-1.5',
  md: 'h-11 px-5 text-[0.9375rem] gap-2',
  lg: 'h-[52px] px-6 text-[0.9375rem] gap-2.5',
};

const badgeSizing: Record<Size, string> = {
  sm: 'size-6',
  md: 'size-8',
  lg: 'size-9',
};

/**
 * Primary is the logo violet, solid, white type. Secondary is a quiet grey well.
 * Dark is ink, for a call to action that sits on a light marketing band. Ghost is
 * text. No pill carries an outline or a glow: the fill is the hierarchy.
 */
const variants: Record<Variant, string> = {
  primary: 'bg-violet-500 text-white hover:bg-violet-600',
  secondary: 'bg-surface text-text border border-[var(--border-strong)] hover:bg-surface-inset',
  ghost: 'bg-transparent text-violet-400 hover:text-violet-600',
  dark: 'bg-ink text-white hover:bg-[#25252b]',
};

/**
 * Disabled paint, per variant. `lib/chain/preflight.ts` disables anything that cannot
 * succeed, so this is a state people genuinely see beside a sentence explaining it.
 * It has to read as "not available", not "broken", and stay legible.
 */
const disabledVariants: Record<Variant, string> = {
  primary: 'disabled:bg-surface-inset disabled:text-text-subtle',
  secondary: 'disabled:text-text-subtle disabled:hover:bg-surface',
  ghost: 'disabled:text-text-subtle',
  dark: 'disabled:bg-surface-inset disabled:text-text-subtle',
};

const badgeVariants: Record<Variant, string> = {
  primary: 'bg-white/20 text-white',
  secondary: 'bg-text/[0.07] text-text',
  ghost: 'bg-text/[0.06] text-text-muted',
  dark: 'bg-white/15 text-white',
};

const RING_BADGE = 'border border-current/35';

const PRESS =
  'transition-[color,background-color,border-color] duration-150 ease-[var(--ease-standard)] active:brightness-95';

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

/** The Maren pill, as a link. Navigating links earn a trailing arrow by default. */
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
  // The square system draws every trailing icon bare. `badge` stays in the API so call
  // sites keep compiling; a disc around an arrow belongs to the old pill.
  void badge;
  const shape: Badge = 'bare';
  const glyph = icon ?? <ArrowUpRight className="size-4" />;

  const inner = (
    <>
      <span className="whitespace-nowrap">{children}</span>
      {shape === 'bare' ? (
        <span
          aria-hidden
          className="shrink-0 transition-transform duration-150 ease-out group-hover:translate-x-0.5"
        >
          {glyph}
        </span>
      ) : (
        <span
          aria-hidden
          className={`grid shrink-0 place-items-center rounded-[var(--radius-pill)] transition-transform duration-150 ease-out group-hover:translate-x-0.5 ${badgeSizing[size]} ${shape === 'ring' ? RING_BADGE : badgeVariants[variant]}`}
        >
          {glyph}
        </span>
      )}
    </>
  );

  const box = shape === 'bare' ? bareSizing[size] : sizing[size];
  // Press-scale, matching PillAction: a link should feel as physical as a button.
  const classes = `group inline-flex items-center justify-between rounded-[var(--radius-control)] ${PRESS} ${box} ${variants[variant]} ${className}`;

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
      className={`group inline-flex items-center justify-center rounded-[var(--radius-control)] ${PRESS} disabled:cursor-not-allowed disabled:active:scale-100 ${bareSizing[size]} ${icon ? 'justify-between' : ''} ${variants[variant]} ${disabledVariants[variant]} ${className}`}
      {...rest}
    >
      <span className="whitespace-nowrap">{children}</span>
      {/* The badge greys out with the button. A violet badge is the loudest thing on a
          Maren screen; leaving it at full strength on a disabled control points at the one
          thing the user cannot do. */}
      {icon ? (
        <span
          aria-hidden
          className="group-disabled:text-text-subtle grid shrink-0 place-items-center transition-transform duration-150 ease-out group-enabled:group-hover:translate-x-0.5"
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
      className={`bg-surface text-text hover:bg-surface-inset inline-flex h-11 items-center rounded-[var(--radius-control)] border border-[var(--border-strong)] px-5 text-[0.9375rem] ${PRESS} ${className}`}
    >
      {children}
    </Link>
  );
}
