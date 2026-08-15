import { MAREN_POLICY, MCR, WAD, formatCollateralRatio, type HealthStatus } from '@maren/sdk';

import { healthLabel, healthTone, toneClasses } from '@/lib/health';

/**
 * The health chip and the health scale.
 *
 * These two are the ONLY coloured elements on the portfolio hero. Every figure around
 * them — ratio, liquidation price, drop tolerance — stays `text`. That is BRAND.md §2's
 * rule, written after an earlier card rendered four saturated colours in one small panel
 * and read as decoration rather than information.
 */

export function HealthChip({ status }: { status: HealthStatus }) {
  const tone = toneClasses[healthTone[status]];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-[var(--radius-pill)] border px-3 py-1.5 text-[0.8125rem] ${tone.border} ${tone.text}`}
    >
      <span aria-hidden className={`size-1.5 rounded-[var(--radius-pill)] ${tone.dot}`} />
      {healthLabel[status]}
    </span>
  );
}

/**
 * A ratio laid on the bands it is judged against, with the thresholds stated rather than
 * implied by colour. The scale runs from the protocol's 110% cliff to 300%; anything
 * above that is clamped to the end, because the difference between 400% and 800% is not
 * information a user needs and rendering it would compress the part that matters.
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
   * track while its tick sat at 37% — a scale whose labels disagree with its marks is
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
    <div className="mt-6">
      <div
        className="relative h-1.5 rounded-[var(--radius-pill)] bg-surface-inset"
        role="img"
        aria-label={`Collateral ratio ${formatCollateralRatio(collateralRatio)} on a scale from 110% to 300%. Maren's floor is 180%; the protocol liquidates at 110%.`}
      >
        {marks.map((mark) => (
          <span
            key={mark.label}
            aria-hidden
            className="absolute top-0 h-1.5 w-px bg-white/20"
            style={{ left: `${percentOf(mark.at)}%` }}
          />
        ))}
        <span
          aria-hidden
          className={`absolute -top-1 size-3.5 -translate-x-1/2 rounded-[var(--radius-pill)] border-2 border-bg ${tone.dot}`}
          style={{ left: `${position}%` }}
        />
      </div>

      <div className="relative mt-2.5 h-4 text-[0.6875rem] text-text-subtle">
        <span className="num absolute left-0">110</span>
        {marks.map((mark) => (
          <span
            key={mark.label}
            className={`num absolute -translate-x-1/2 whitespace-nowrap ${
              mark.minor ? 'hidden sm:inline' : ''
            }`}
            style={{ left: `${percentOf(mark.at)}%` }}
          >
            {mark.label}
          </span>
        ))}
        <span className="num absolute right-0">300+</span>
      </div>
      <p className="sr-only">
        Percentages are collateral ratios. Maren refuses to lend below 180%; the protocol
        liquidates below 110%.
      </p>
    </div>
  );
}
