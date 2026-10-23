import { MAREN_POLICY, MCR, WAD, formatCollateralRatio, type HealthStatus } from '@maren/sdk';

import { healthLabel, healthTone, toneClasses } from '@/lib/health';

/**
 * The health chip and the health scale.
 *
 * These two are the ONLY coloured elements on a position. Every figure around them
 * (ratio, liquidation price, drop tolerance) stays `text`. That is BRAND.md §2's rule,
 * written after an earlier card rendered four saturated colours in one small panel and
 * read as decoration rather than information.
 *
 * Status is never carried by colour alone: the chip is a dot AND a word, and the scale
 * states its thresholds in figures beside the marks.
 */

export function HealthChip({ status }: { status: HealthStatus }) {
  const tone = toneClasses[healthTone[status]];
  // A dot and a word, no outline. It sits in panel header bars and beside large figures,
  // and a bordered pill there read as one more badge competing with the number.
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[0.8125rem] font-medium ${tone.text}`}
    >
      <span aria-hidden className={`size-2 shrink-0 rounded-[var(--radius-pill)] ${tone.dot}`} />
      {healthLabel[status]}
    </span>
  );
}

/**
 * A ratio laid on the bands it is judged against, with the thresholds stated rather than
 * implied by colour. The scale runs from the protocol's 110% cliff to 300%; anything
 * above that is clamped to the end, because the difference between 400% and 800% is not
 * information a user needs and rendering it would compress the part that matters.
 *
 * The scale is its own size container. It renders inside a phone-width card, inside a
 * disclosure on Home, and across a full-width panel, and the two minor captions (140,
 * 160) only fit when there is room for them, which is a question about the scale's width,
 * not the viewport's.
 */
export function HealthScale({
  collateralRatio,
  status,
}: {
  collateralRatio: bigint;
  status: HealthStatus;
}) {
  const min = MCR; // 110%
  const max = 3n * WAD; // 300%
  const clamped = collateralRatio > max ? max : collateralRatio < min ? min : collateralRatio;
  // Integer math throughout, then one division at the very end for a CSS percentage.
  const position = Number(((clamped - min) * 1000n) / (max - min)) / 10;

  const percentOf = (value: bigint) => Number(((value - min) * 1000n) / (max - min)) / 10;

  /**
   * Ticks and their captions share one percentage each. An earlier version spaced the
   * captions with `justify-between`, which put "180% Maren floor" at the middle of the
   * track while its tick sat at 37%. A scale whose labels disagree with its marks is
   * worse than a scale with no labels at all.
   */
  const marks = [
    { at: MAREN_POLICY.vaultLiquidationCr, label: '140', minor: true },
    { at: MAREN_POLICY.warnCr, label: '160', minor: true },
    { at: MAREN_POLICY.minHealthyCr, label: '180 floor', minor: false },
    { at: MAREN_POLICY.targetCr, label: '250 target', minor: false },
  ];

  const tone = toneClasses[healthTone[status]];

  return (
    <div className="@container mt-6">
      <div
        className="bg-surface-inset relative h-1.5"
        role="img"
        aria-label={`Collateral ratio ${formatCollateralRatio(collateralRatio)} on a scale from 110% to 300%. Maren's borrowing floor is 180%; pooled positions can be liquidated below 140%, and direct troves below 110%.`}
      >
        {marks.map((mark) => (
          <span
            key={mark.label}
            aria-hidden
            className={`absolute top-1/2 w-px -translate-y-1/2 ${
              mark.minor ? 'bg-text/20 h-1.5' : 'bg-text/45 h-3'
            }`}
            style={{ left: `${percentOf(mark.at)}%` }}
          />
        ))}
        <span
          aria-hidden
          className={`absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-pill)] border-2 border-surface ${tone.dot}`}
          style={{ left: `${position}%` }}
        />
      </div>

      <div className="text-text-muted relative mt-3 h-4 text-xs">
        <span className="num absolute left-0">110</span>
        {marks.map((mark) => (
          <span
            key={mark.label}
            className={`num absolute -translate-x-1/2 whitespace-nowrap ${
              mark.minor ? '@md:inline hidden' : ''
            }`}
            style={{ left: `${percentOf(mark.at)}%` }}
          >
            {mark.label}
          </span>
        ))}
        <span className="num absolute right-0">300+</span>
      </div>
      <p className="sr-only">
        Percentages are collateral ratios. Maren refuses to lend below 180%; pooled positions can be
        liquidated below 140%, and direct troves below 110%.
      </p>
    </div>
  );
}
