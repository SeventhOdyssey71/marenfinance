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

/**
 * The top of every app screen: one title, one optional line of context, actions on the
 * right at desktop widths and below the copy on a phone. `eyebrow` is a quiet sentence-case
 * label above the title, for screens that live inside a section (Finance > Vault).
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className = '',
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`flex flex-col gap-4 pb-6 pt-4 md:flex-row md:items-end md:justify-between md:pt-6 ${className}`}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="t-label mb-2">{eyebrow}</p> : null}
        <h1 className="t-h1">{title}</h1>
        {description ? (
          <p className="text-text-muted mt-2 max-w-[60ch] text-[0.9375rem] leading-relaxed text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A heading for a group of cards inside a screen, with an optional trailing action. */
export function SectionHeader({
  title,
  action,
  id,
  className = '',
}: {
  title: ReactNode;
  action?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={`mb-3 flex items-center justify-between gap-4 ${className}`}>
      <h2 id={id} className="text-text text-[0.9375rem] font-medium tracking-[-0.012em]">
        {title}
      </h2>
      {action ? <div className="text-text-muted text-sm">{action}</div> : null}
    </div>
  );
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
  return <span className={`t-label ${className}`}>{children}</span>;
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
            <h2 id={labelledBy} className="text-text text-sm font-medium tracking-[-0.01em]">
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
      <summary className="text-text-muted hover:text-text inline-flex cursor-pointer list-none items-center gap-1.5 rounded-[var(--radius-pill)] text-xs transition-colors duration-150 ease-out marker:content-none">
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
    // The app renders inside a fixed ~480px phone frame at every viewport, so this
    // stacks unconditionally — a mobile card, never a viewport-responsive strip. A
    // `sm:flex-row` here activated on desktop viewports *inside* the narrow frame and
    // collapsed the title to one word per line.
    <div className="flex flex-col items-start gap-4">
      {icon ? (
        <span className="bg-surface-inset grid size-11 shrink-0 place-items-center rounded-[var(--radius-pill)] text-violet-500">
          {icon}
        </span>
      ) : null}
      <div className="w-full min-w-0">
        <h3 className="t-h3">{title}</h3>
        {children ? (
          <p className="text-text-muted mt-1.5 max-w-[62ch] text-sm leading-relaxed">{children}</p>
        ) : null}
      </div>
      {action ? <div className="w-full">{action}</div> : null}
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
    primary: 'bg-violet-500 text-white hover:bg-violet-600',
    secondary: 'bg-surface-inset text-text hover:bg-[#e8e8ec]',
  } as const;
  const badges = {
    primary: 'bg-white/20 text-white',
    secondary: 'bg-text/[0.07] text-text',
  } as const;

  return (
    <a
      href={href}
      className={`group inline-flex h-11 items-center justify-between gap-3 rounded-[var(--radius-pill)] pl-5 pr-1.5 text-[0.9375rem] font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] ${variants[variant]}`}
    >
      <span className="whitespace-nowrap">{children}</span>
      {icon ? (
        <span
          aria-hidden
          className={`grid size-8 shrink-0 place-items-center rounded-[var(--radius-pill)] transition-transform duration-150 ease-out group-hover:translate-x-0.5 ${badges[variant]}`}
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
  // Neutral notes are a soft grey well — tone, not an outline. A warning keeps its
  // amber hairline because there the border carries meaning.
  const border = tone === 'warning' ? 'border border-warning/25 bg-[#fff8eb]' : 'bg-surface-inset';
  return (
    <div
      {...(role ? { role } : {})}
      className={`rounded-[var(--radius-input)] ${border} text-text-muted p-4 text-sm leading-relaxed`}
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

/**
 * ONE loading vocabulary for the whole app, in two words.
 *
 * A `Skeleton` block is what a screen shows while it has NOTHING yet — it stands in the
 * exact footprint the real figure will take, so the number arriving does not shove the
 * layout. `Refreshing` is what a screen shows while it already has figures on display and
 * is re-reading them (a react-query background refetch, and every refetch a confirmed
 * write triggers): the existing numbers stay put and update calmly in place, with a quiet
 * violet mark saying they are being checked rather than the screen blanking. Honest-data
 * cuts both ways here — a skeleton is an admission we do not know the number yet, never a
 * placeholder figure; and a background refetch never hides the last known-true value
 * behind a spinner, because that value is still the truest thing we can show until a new
 * one lands.
 */

/**
 * A neutral skeleton block: the quiet violet-grey `surface-inset` well, pulsing gently.
 * Decorative, so `aria-hidden` — the announcement lives once on the `AppLoading` wrapper
 * rather than on every block. Under `prefers-reduced-motion` the pulse is dropped for a
 * static block, the same call the spinners make: a paused animation reads as broken.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`bg-surface-inset block animate-pulse rounded-[var(--radius-input)] motion-reduce:animate-none ${className}`}
    />
  );
}

/**
 * A card-shaped skeleton that traces `Panel`: the same hairline, the same header bar over
 * a rule, the same edge-to-edge rows at `StatRow`'s rhythm. Matching the final shape is
 * the point — the panel does not resize or jump when the real numbers replace it.
 */
export function SkeletonPanel({ rows = 3, header = true }: { rows?: number; header?: boolean }) {
  return (
    <div className="card" aria-hidden>
      {header ? (
        <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-5 py-3">
          <Skeleton className="h-3 w-24" />
        </div>
      ) : null}
      <div className="px-5 py-1.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className={`flex items-center justify-between gap-4 py-3 ${
              i === rows - 1 ? '' : 'border-b border-[var(--border-hairline)]'
            }`}
          >
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The first-load body: a stack of `SkeletonPanel`s, one per panel the real screen will
 * show, so the page keeps its height and rhythm before any figure has arrived. Carries
 * the single `role="status"` for the whole skeleton, announced once rather than once per
 * block. `panels` is the row count for each card, so a caller matches its own layout.
 */
export function AppLoading({ panels = [3, 3] }: { panels?: number[] }) {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">Reading your data from Mezo</span>
      {panels.map((rows, i) => (
        <SkeletonPanel key={i} rows={rows} />
      ))}
    </div>
  );
}

/**
 * The background-refetch mark: a quiet brand-violet spinner and one word, shown beside a
 * screen's title while its figures are being re-read. It never covers the numbers — the
 * whole point is that they stay on screen and update in place. `role="status"` so a
 * screen reader hears the update without it being an interruption; reduced-motion swaps
 * the ring for a static dot, matching every other spinner in the app.
 */
export function Refreshing({ label = 'Refreshing' }: { label?: string }) {
  return (
    <span className="text-text-subtle inline-flex items-center gap-2 text-xs" role="status">
      <span
        aria-hidden
        className="size-3 shrink-0 animate-spin rounded-[var(--radius-pill)] border-2 border-violet-500 border-t-transparent motion-reduce:hidden"
      />
      <span
        aria-hidden
        className="hidden size-1.5 shrink-0 rounded-[var(--radius-pill)] bg-violet-500 motion-reduce:block"
      />
      {label}
    </span>
  );
}
