'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * A group of figures that lays itself out by the width it is GIVEN, not by the viewport.
 *
 * `MetricStrip` switches at the viewport's `sm`, which is right for a full-width panel and
 * wrong for the same panel anywhere narrower than the viewport suggests (a disclosure, a
 * half-width column): three columns of ~100px each, every label truncated. These panels
 * render in several places, so the group is a CSS container and decides for itself:
 *
 *   narrow (under 36rem)  label and caption on the left, the figure on the right, one row
 *                         per figure on a hairline. Reads like a statement.
 *   wide (36rem and up)   the figures side by side as metric cells divided by hairlines,
 *                         each figure a size up. Reads like a dashboard strip.
 *
 * `layout="rows"` keeps the row form at every width, for the secondary tables (fees, what
 * a deposit leaves you with) that should never compete with the headline strip above them.
 *
 * Semantically a `<dl>`: each `Fact` is a term (the label), its value, and an optional
 * caption that qualifies the value. Rows run edge to edge, so a group belongs directly in
 * a card, not inside its padding.
 */

type Layout = 'auto' | 'rows';

const LayoutContext = createContext<Layout>('auto');

export function FactGroup({
  children,
  layout = 'auto',
  className = '',
}: {
  children: ReactNode;
  layout?: Layout;
  className?: string;
}) {
  const auto = layout === 'auto';
  return (
    <LayoutContext.Provider value={layout}>
      <div className={`${auto ? '@container' : ''} ${className}`}>
        <dl
          className={`grid grid-cols-1 divide-y divide-[var(--border-hairline)] ${
            auto ? '@xl:auto-cols-fr @xl:grid-flow-col @xl:divide-x @xl:divide-y-0' : ''
          }`}
        >
          {children}
        </dl>
      </div>
    </LayoutContext.Provider>
  );
}

// Row layout: label (r1 c1), value (r1 c2), caption under the label (r2 c1).
// Cell layout: one column, so the same three stack as label, value, caption.
const ROW = {
  wrap: 'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-5 py-3',
  label: 'text-text-muted min-w-0 text-sm',
  // Every figure renders through `.num`, so the size is set on it here rather than asking
  // each caller for two sizes.
  value: 'col-start-2 row-start-1 min-w-0 text-right [&_.num]:text-[0.9375rem]',
  caption: 'text-text-muted col-start-1 mt-0.5 min-w-0 text-xs leading-relaxed',
};

const CELL = {
  // content-start: a figure with no caption must not drop below its neighbours.
  wrap: '@xl:grid-cols-1 @xl:content-start @xl:py-4',
  label: '@xl:text-[0.8125rem]',
  // In a cell the figure leads its own column, so it steps up a size.
  value:
    '@xl:col-start-auto @xl:row-start-auto @xl:mt-1.5 @xl:truncate @xl:text-left @xl:[&_.num]:text-xl',
  caption: '@xl:mt-1',
};

export function Fact({
  label,
  value,
  caption,
}: {
  label: string;
  value: ReactNode;
  /** A few words that qualify the figure: its dollar value, where it comes from. */
  caption?: ReactNode;
}) {
  const auto = useContext(LayoutContext) === 'auto';
  const cls = (part: keyof typeof ROW) => `${ROW[part]} ${auto ? CELL[part] : ''}`;

  return (
    <div className={cls('wrap')}>
      <dt className={cls('label')}>{label}</dt>
      <dd className={cls('value')}>{value}</dd>
      {caption ? <dd className={cls('caption')}>{caption}</dd> : null}
    </div>
  );
}
