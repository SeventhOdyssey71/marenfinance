import type { ReactNode } from 'react';

/**
 * The small shared pieces every app screen is built from. Deliberately the same shapes
 * the landing page uses — `.card`, `.t-label`, the hairline, the 8/16/999 radii — so the
 * dApp and the marketing site read as one product rather than two teams.
 */

export function AppCard({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return <Tag className={`card p-6 ${className}`}>{children}</Tag>;
}

export function CardTitle({
  children,
  id,
  className = '',
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <h2 id={id} className={`t-h3 ${className}`}>
      {children}
    </h2>
  );
}

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`t-label text-text-subtle ${className}`}>{children}</span>;
}

/**
 * A label/value row on a hairline. `hint` is the place to put the thing a user would
 * otherwise have to know — "includes the 200 MUSD gas compensation" — rather than
 * leaving a figure that quietly means something other than it appears to.
 */
export function StatRow({
  label,
  hint,
  value,
  sub,
  last = false,
}: {
  label: string;
  hint?: string;
  value: ReactNode;
  sub?: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-6 py-3.5 ${
        last ? '' : 'border-b border-[var(--border-hairline)]'
      }`}
    >
      <div className="min-w-0">
        <div className="text-text-muted text-sm">{label}</div>
        {hint ? <div className="text-text-subtle mt-1 text-xs">{hint}</div> : null}
      </div>
      <div className="shrink-0 text-right">
        <div>{value}</div>
        {sub ? <div className="mt-1">{sub}</div> : null}
      </div>
    </div>
  );
}

/**
 * A metric in a grid of metrics. Figures stay neutral here — BRAND.md §2.
 *
 * `min-w-0` and `truncate` are load-bearing, not cosmetic. A CSS grid track defaults to
 * `minmax(auto, 1fr)`, so a long unbreakable value sets the column's minimum width and
 * pushes into its neighbour: that is how "LIQUIDATION PRICE" and "BITCOIN CAN FALL" came
 * to render on top of one another when the value was a 66-character sentinel. The SDK's
 * display ceiling now stops such a value existing; this stops any future one colliding.
 * The exact figure stays reachable through the `title` every `Num` carries.
 */
export function Metric({
  label,
  value,
  caption,
  align = 'left',
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <div className={`min-w-0 ${align === 'right' ? 'text-right' : ''}`}>
      <Label>{label}</Label>
      <div className="mt-2 truncate">{value}</div>
      {/* `text-muted`, not `text-subtle`: a caption that qualifies a headline figure —
          "capped by Mezo's per-trove ceiling" — is decision-relevant, and the subtle
          token measures 3.6:1 against `surface`, under WCAG AA for body text. Subtle is
          reserved for genuinely tertiary text: timestamps and units. */}
      {caption ? (
        <div className="metric-caption text-text-muted mt-1 text-xs">{caption}</div>
      ) : null}
    </div>
  );
}

/**
 * The explanation a screen does not lead with.
 *
 * Maren's surfaces are full of things that are true, load-bearing and too long to say
 * up front — why a borrow ceiling does not move when collateral is added, why a pooled
 * position shares a trove. Deleting them would make the product less honest; leading
 * with them makes every screen a document. So they live one click down: closed by
 * default, open to anyone who wants the reason, and never in the way of the number.
 *
 * A native `<details>` rather than a tooltip, so it works on touch, survives no-JS, and
 * is announced by a screen reader without any ARIA of our own.
 */
export function Info({
  summary = 'Why this number',
  children,
  id,
}: {
  summary?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <details id={id} className="group mt-4">
      <summary className="text-text-muted hover:text-text marker:content-none inline-flex cursor-pointer list-none items-center gap-1.5 rounded-[var(--radius-pill)] text-xs transition-colors duration-[120ms] ease-out">
        <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0" fill="currentColor">
          <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm0 1.2a5.3 5.3 0 110 10.6A5.3 5.3 0 018 2.7zm-.75 2.4h1.5v1.5h-1.5V5.1zm0 2.6h1.5v4h-1.5v-4z" />
        </svg>
        {summary}
      </summary>
      <div className="text-text-muted mt-2.5 max-w-[68ch] text-xs leading-relaxed">{children}</div>
    </details>
  );
}

/**
 * The state a screen is in before the user has done anything.
 *
 * A brand-new wallet is the default state for everyone Mezo sends here, so it gets a
 * purposeful card with one instruction rather than a grid of dashes and zeroes. One
 * headline, at most one line of copy, one action.
 */
export function EmptyState({
  title,
  children,
  action,
  icon,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-4 py-4">
      {icon ? (
        <span className="bg-surface-inset grid size-12 place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] text-violet-400">
          {icon}
        </span>
      ) : null}
      <div>
        <h3 className="t-h3">{title}</h3>
        {children ? (
          <p className="text-text-muted mt-2 max-w-[52ch] text-sm leading-relaxed">{children}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** A pill link styled as a primary action. The navigating twin of `ActionButton`. */
export function ActionLink({
  href,
  children,
  icon,
  variant = 'primary',
}: {
  href: string;
  children: ReactNode;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  const variants = {
    primary: 'bg-white text-[#08080A] hover:bg-white/90',
    secondary:
      'bg-surface-raised text-text border border-[var(--border-hairline)] hover:border-[var(--border-strong)]',
  } as const;
  const badges = {
    primary: 'bg-violet-500 text-white',
    secondary: 'bg-white/[0.06] text-text-muted',
  } as const;

  return (
    <a
      href={href}
      className={`group inline-flex h-12 items-center justify-between gap-4 rounded-[var(--radius-pill)] pl-6 pr-2 text-[0.9375rem] font-medium transition-colors duration-[120ms] ease-out ${variants[variant]}`}
    >
      <span className="whitespace-nowrap">{children}</span>
      {icon ? (
        <span
          aria-hidden
          className={`grid size-9 shrink-0 place-items-center rounded-[var(--radius-pill)] transition-transform duration-[120ms] ease-out group-hover:translate-x-0.5 ${badges[variant]}`}
        >
          {icon}
        </span>
      ) : null}
    </a>
  );
}

/** An inset well for a secondary note — risk statements, gas disclosures, disclosures. */
export function Note({
  children,
  tone = 'neutral',
  role,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'warning';
  role?: 'alert' | 'status';
}) {
  const border = tone === 'warning' ? 'border-warning/30' : 'border-[var(--border-hairline)]';
  return (
    <div
      {...(role ? { role } : {})}
      className={`rounded-[var(--radius-input)] border ${border} bg-surface-inset text-text-muted p-4 text-sm leading-relaxed`}
    >
      {children}
    </div>
  );
}

/** A pill button that performs an action rather than navigating. */
export function ActionButton({
  children,
  onClick,
  disabled = false,
  variant = 'primary',
  type = 'button',
  icon,
  className = '',
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet';
  type?: 'button' | 'submit';
  icon?: ReactNode;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  const variants = {
    primary:
      'bg-white text-[#08080A] hover:bg-white/90 active:bg-white/80 disabled:bg-white/25 disabled:text-[#08080A]/60',
    secondary:
      'bg-surface-raised text-text border border-[var(--border-hairline)] hover:border-[var(--border-strong)] disabled:text-text-subtle',
    quiet: 'bg-transparent text-text-muted hover:text-text',
  } as const;

  const badges = {
    primary: 'bg-violet-500 text-white',
    secondary: 'bg-white/[0.06] text-text-muted',
    quiet: 'bg-white/[0.06] text-text-muted',
  } as const;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`group inline-flex h-12 items-center justify-between gap-4 rounded-[var(--radius-pill)] pl-6 pr-2 text-[0.9375rem] font-medium transition-colors duration-[120ms] ease-out disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...rest}
    >
      <span className="whitespace-nowrap">{children}</span>
      {icon ? (
        <span
          aria-hidden
          className={`grid size-9 shrink-0 place-items-center rounded-[var(--radius-pill)] transition-transform duration-[120ms] ease-out group-enabled:group-hover:translate-x-0.5 ${badges[variant]}`}
        >
          {icon}
        </span>
      ) : null}
    </button>
  );
}
