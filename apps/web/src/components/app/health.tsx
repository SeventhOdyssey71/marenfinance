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

  const marks = [
    { at: MAREN_POLICY.vaultLiquidationCr, label: '140%' },
    { at: MAREN_POLICY.warnCr, label: '160%' },
    { at: MAREN_POLICY.minHealthyCr, label: '180%' },
    { at: MAREN_POLICY.targetCr, label: '250%' },
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
            style={{ left: `${Number(((mark.at - min) * 1000n) / (max - min)) / 10}%` }}
          />
        ))}
        <span
          aria-hidden
          className={`absolute -top-1 size-3.5 -translate-x-1/2 rounded-[var(--radius-pill)] border-2 border-bg ${tone.dot}`}
          style={{ left: `${position}%` }}
        />
      </div>

      <div className="mt-2.5 flex justify-between text-[0.6875rem] text-text-subtle">
        <span className="num">110% protocol</span>
        <span className="num">180% Maren floor</span>
        <span className="num">300%+</span>
      </div>
    </div>
  );
}
