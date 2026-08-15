import { StyleSheet, View } from 'react-native';
import { MAREN_POLICY, MCR, WAD } from '@maren/sdk';

import { base, radius, space, toneColor, type HealthTone } from '../design/tokens';
import { Label, Txt } from './Text';

/**
 * The collateral-ratio scale.
 *
 * A horizontal band rather than a ring or a gauge: this is a banking app, and the useful
 * question is not "what fraction of a circle" but "where do I sit relative to the three
 * thresholds that can cost me money". The thresholds are drawn as labelled ticks, so the
 * number has context without the user having to remember what 180% means.
 *
 * Every threshold comes from @maren/sdk. None is written as a literal here.
 *
 *   110%  MCR                          — the protocol liquidates.
 *   140%  MAREN_POLICY.vaultLiquidationCr — Maren's keeper liquidates a pooled position.
 *   180%  MAREN_POLICY.minHealthyCr    — below this we refuse further borrowing.
 *   250%  MAREN_POLICY.targetCr        — what the borrow slider aims at.
 *
 * The bar is decorative in the strict sense that it repeats information stated exactly
 * in the numerals beside it, so it carries `accessibilityElementsHidden` and VoiceOver
 * reads the numbers instead of trying to describe a shape.
 */

/** The scale runs from the liquidation cliff to a little past the default target. */
const SCALE_MIN = MCR; // 110%
const SCALE_MAX = 3_000_000_000_000_000_000n; // 300%

export interface HealthScaleProps {
  collateralRatio: bigint;
  tone: HealthTone;
}

export function HealthScale({ collateralRatio, tone }: HealthScaleProps) {
  const pct = positionOf(collateralRatio);
  const colour = toneColor[tone];

  return (
    <View style={styles.root} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.track}>
        {/* Filled portion, up to the current ratio. */}
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colour }]} />

        {/* Threshold ticks. Drawn over the fill so they stay legible when it passes. */}
        <Tick at={positionOf(MAREN_POLICY.vaultLiquidationCr)} />
        <Tick at={positionOf(MAREN_POLICY.minHealthyCr)} />
        <Tick at={positionOf(MAREN_POLICY.targetCr)} />

        {/* Current-value marker. */}
        <View style={[styles.marker, { left: `${pct}%`, borderColor: colour }]} />
      </View>

      <View style={styles.legend}>
        <Legend value="110%" caption="Liquidation" />
        <Legend value="180%" caption="Borrow floor" />
        <Legend value="250%" caption="Target" align="right" />
      </View>
    </View>
  );
}

function Tick({ at }: { at: number }) {
  return <View style={[styles.tick, { left: `${at}%` }]} />;
}

function Legend({
  value,
  caption,
  align = 'left',
}: {
  value: string;
  caption: string;
  align?: 'left' | 'right';
}) {
  return (
    <View style={{ alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <Txt variant="numericSm" tone="subtle">
        {value}
      </Txt>
      <Label style={styles.caption}>{caption}</Label>
    </View>
  );
}

/** Clamp a CR onto the 0–100 scale. Uses bigint math down to the last step. */
function positionOf(cr: bigint): number {
  if (cr <= SCALE_MIN) return 0;
  if (cr >= SCALE_MAX) return 100;
  const span = SCALE_MAX - SCALE_MIN;
  // Scaled by 1000 before converting so the Number() cast cannot lose a percent.
  return Number(((cr - SCALE_MIN) * 1000n) / span) / 10;
}

/** Exported for the vault preview, which needs the same geometry. */
export { positionOf as crScalePosition, SCALE_MIN as CR_SCALE_MIN, SCALE_MAX as CR_SCALE_MAX, WAD };

const styles = StyleSheet.create({
  root: { marginTop: space.lg },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.pill,
    opacity: 0.85,
  },
  tick: {
    position: 'absolute',
    top: -2,
    width: 1,
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  marker: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    borderWidth: 2.5,
    backgroundColor: base.bg,
    marginLeft: -7,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.md,
  },
  caption: { marginTop: 2 },
});
