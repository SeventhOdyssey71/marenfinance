import type { ReactNode } from 'react';

import { InfoIcon } from '@/components/ui/icons';
import { PillAction } from '@/components/ui/pill-button';

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
 * A panel: a hairline card with a compact header bar and rows that run edge to edge.
 *
 * This is the shape a lending interface is built from — Aave, Spark, Liquity all do it —
 * and it is what the dApp was missing. A titled card with `p-6` and an `h3` gives every
 * group of four numbers the visual weight of a chapter heading; a `t-label` bar over a
 * hairline gives it the weight of a column header, which is what it is.
 *
 * The body carries its own horizontal padding so `StatRow` hairlines reach the panel edge
 * and the rows read as a table rather than as a stack of paragraphs.
 */
export function Panel({
  title,
  meta,
  children,
  className = '',
  labelledBy,
}: {
  title?: string;
  /** Right side of the header bar: a health chip, a route tag, a link. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section
      className={`card ${className}`}
      {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
    >
      {title || meta ? (
        // A `div`, not a `header`. `<header>` is a landmark, and a page with six panels
        // would expose six of them — which is how verify-behaviour caught this: the dApp
        // shell went from one header landmark to four the moment panels shipped.
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--border-hairline)] px-5 py-3">
          {title ? (
            <h2 id={labelledBy} className="t-label text-text-subtle">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {meta ? <div className="flex flex-wrap items-center gap-3">{meta}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** The row area of a `Panel`. Separate so a panel can also hold a form or a strip. */
export function PanelBody({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`px-5 py-1.5 ${className}`}>{children}</div>;
}

/**
 * A row of figures across the top of a panel, divided by hairlines.
 *
 * `divide-x` rather than gaps: on a numbers-forward screen the rule between two figures is
 * what says they are separate readings of the same thing, and a gap says they are two
 * unrelated blocks. Stacks to a single column below `sm`, where the divider flips to
 * horizontal so the same reading survives.
 */
export function MetricStrip({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 divide-y divide-[var(--border-hairline)] sm:auto-cols-fr sm:grid-flow-col sm:divide-x sm:divide-y-0">
      {children}
    </div>
  );
}

/**
 * A label/value row on a hairline, one line tall.
 *
 * It used to be two: the label stacked over a `hint`, the value stacked over a `sub`, at
 * `py-3.5`. Four rows of that is a screen. The hint now rides on the label after a middot
 * and the sub rides before the value, so a table of eight facts is eight lines. Anything
 * that genuinely needs a sentence goes behind `Info` at panel level instead.
 */
export function StatRow({
  label,
  hint,
  value,
  sub,
  last = false,
}: {
  label: string;
  /** A few words, on the same line. Not a sentence — use `Info` for those. */
  hint?: string;
  value: ReactNode;
  sub?: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-2.5 ${
        last ? '' : 'border-b border-[var(--border-hairline)]'
      }`}
    >
      <span className="text-text-muted min-w-0 truncate text-sm">
        {label}
        {hint ? <span className="text-text-subtle"> · {hint}</span> : null}
      </span>
      <span className="flex shrink-0 items-baseline gap-3 text-right">
        {sub ? <span className="text-text-subtle text-xs">{sub}</span> : null}
        {value}
      </span>
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
  className = '',
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  align?: 'left' | 'right';
  /** Padding when the metric sits in a `MetricStrip` rather than a plain grid. */
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${align === 'right' ? 'text-right' : ''} ${className}`}>
      <Label>{label}</Label>
      <div className="mt-1.5 truncate">{value}</div>
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
      <summary className="text-text-muted hover:text-text inline-flex cursor-pointer list-none items-center gap-1.5 rounded-[var(--radius-pill)] text-xs transition-colors duration-[120ms] ease-out marker:content-none">
        <InfoIcon className="size-3.5 shrink-0" />
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
    // A band, not a column. Stacked, this was a 450px-tall card with content in its
    // top-left quadrant and nothing anywhere else — the least dense thing on a screen
    // whose whole point is density. Icon, copy and action now sit on one line from `sm`
    // up, and the card is a strip.
    <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
      {icon ? (
        <span className="bg-surface-inset grid size-11 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] text-violet-400">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <h3 className="t-h3">{title}</h3>
        {children ? (
          <p className="text-text-muted mt-1.5 max-w-[62ch] text-sm leading-relaxed">{children}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
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
    primary: 'bg-text text-bg hover:bg-text/90',
    secondary:
      'bg-surface-raised text-text border border-[var(--border-hairline)] hover:border-[var(--border-strong)]',
  } as const;
  const badges = {
    primary: 'bg-violet-500 text-white',
    secondary: 'bg-text/[0.06] text-text-muted',
  } as const;

  return (
    <a
      href={href}
      className={`group inline-flex h-12 items-center justify-between gap-4 rounded-[var(--radius-pill)] pl-6 pr-2 text-[0.9375rem] font-medium transition-[color,background-color,border-color,transform] duration-[120ms] ease-out active:scale-[0.97] ${variants[variant]}`}
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

/**
 * A pill button that performs an action rather than navigating.
 *
 * This used to carry its own copy of the pill's paint — a second set of fills, radii and
 * badge colours living a few files away from `components/ui/pill-button.tsx`. They had
 * already drifted: the disabled primary here was `white/25`, below AA against `surface`,
 * on a control that the preflight work now makes users look at often. It delegates, so
 * there is one pill in the product. `quiet` maps to the shared `ghost`.
 */
export function ActionButton({
  variant = 'primary',
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
  return <PillAction variant={variant === 'quiet' ? 'ghost' : variant} {...rest} />;
}

/**
 * A quiet in-flight state: spinner and one sentence of what is being read.
 *
 * Under `prefers-reduced-motion` the ring is hidden outright and a static dot
 * takes its place — pausing a spin animation would freeze the ring mid-rotation,
 * which reads as broken rather than as motion declined (same treatment as the
 * transaction sheet's spinner).
 */
export function Loading({ children }: { children: ReactNode }) {
  return (
    <div className="text-text-muted flex items-center gap-3 py-6 text-sm" role="status">
      <span
        aria-hidden
        className="size-3.5 shrink-0 animate-spin rounded-[var(--radius-pill)] border-2 border-current border-t-transparent motion-reduce:hidden"
      />
      <span
        aria-hidden
        className="hidden size-1.5 shrink-0 rounded-[var(--radius-pill)] bg-current motion-reduce:block"
      />
      <span>{children}</span>
    </div>
  );
}
