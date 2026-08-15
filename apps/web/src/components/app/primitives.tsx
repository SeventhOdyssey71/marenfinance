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
        <div className="text-sm text-text-muted">{label}</div>
        {hint ? <div className="mt-1 text-xs text-text-subtle">{hint}</div> : null}
      </div>
      <div className="shrink-0 text-right">
        <div>{value}</div>
        {sub ? <div className="mt-1">{sub}</div> : null}
      </div>
    </div>
  );
}

/** A metric in a grid of metrics. Figures stay neutral here — BRAND.md §2. */
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
    <div className={align === 'right' ? 'text-right' : ''}>
      <Label>{label}</Label>
      <div className="mt-2">{value}</div>
      {/* `text-muted`, not `text-subtle`: a caption that qualifies a headline figure —
          "capped by Mezo's per-trove ceiling" — is decision-relevant, and the subtle
          token measures 3.6:1 against `surface`, under WCAG AA for body text. Subtle is
          reserved for genuinely tertiary text: timestamps and units. */}
      {caption ? <div className="metric-caption mt-1 text-xs text-text-muted">{caption}</div> : null}
    </div>
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
  const border =
    tone === 'warning' ? 'border-warning/30' : 'border-[var(--border-hairline)]';
  return (
    <div
      {...(role ? { role } : {})}
      className={`rounded-[var(--radius-input)] border ${border} bg-surface-inset p-4 text-sm leading-relaxed text-text-muted`}
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
      className={`group inline-flex h-12 items-center justify-between gap-4 rounded-[var(--radius-pill)] pr-2 pl-6 text-[0.9375rem] font-medium transition-colors duration-[120ms] ease-out disabled:cursor-not-allowed ${variants[variant]} ${className}`}
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
