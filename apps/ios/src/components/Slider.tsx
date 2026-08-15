import { useCallback, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { base, brand, radius, space } from '../design/tokens';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * A slider built on PanResponder rather than a native control.
 *
 * Two reasons. First, the native iOS slider cannot be styled to BRAND.md §4 — it has
 * a fixed thumb and a system tint, and the point of this control is that the violet is
 * the only saturated colour on the screen. Second, and more importantly, the value here
 * is a `bigint` of MUSD wei: routing it through a float `value` prop would round the
 * user's borrow amount, and BRAND.md §8 forbids rounding in the direction that flatters
 * a position.
 *
 * Accessibility is not an afterthought on a custom control. This one carries
 * `accessibilityRole="adjustable"`, publishes `accessibilityValue` in real units, and
 * implements increment/decrement so VoiceOver's swipe-up/down gestures move it in ten
 * discrete steps.
 */
export interface SliderProps {
  /** Current value, 1e18 fixed point. */
  value: bigint;
  /** Inclusive maximum. The track physically cannot exceed this. */
  max: bigint;
  onChange: (next: bigint) => void;
  /** Optional marker drawn on the track, e.g. the recommended 250% CR position. */
  marker?: { at: bigint; label: string };
  /** Spoken value, e.g. "4,200.00 MUSD". */
  formatValue: (wei: bigint) => string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  disabled?: boolean;
  style?: ViewStyle;
}

const STEPS = 10n;

export function Slider({
  value,
  max,
  onChange,
  marker,
  formatValue,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  style,
}: SliderProps) {
  const [width, setWidth] = useState(0);
  const reduceMotion = useReducedMotion();

  const trackPageX = useRef(0);
  const trackRef = useRef<View>(null);
  const lastHapticStep = useRef(-1);

  /**
   * Map an x offset within the track to a value, and emit it.
   *
   * `width` and `max` come straight from render scope rather than from mirror refs.
   * The old shape kept `widthRef`/`maxRef`/`onChangeRef` in sync by assigning during
   * render, which is the thing React's purity rules exist to stop; the only reason it
   * existed was to keep a `PanResponder` instance stable across renders, and this
   * component no longer creates one.
   */
  const setFromX = useCallback(
    (x: number) => {
      if (width <= 0 || max <= 0n) return;
      const clamped = Math.max(0, Math.min(width, x));
      // Convert through a 1e6 integer fraction so the bigint conversion is exact at the
      // endpoints — dragging fully right must land on `max`, not max minus a rounding.
      const fraction = BigInt(Math.round((clamped / width) * 1_000_000));
      const next = (max * fraction) / 1_000_000n;

      const step = Math.round((clamped / width) * 10);
      if (step !== lastHapticStep.current) {
        lastHapticStep.current = step;
        Haptics.selectionAsync().catch(() => {});
      }

      onChange(next);
    },
    [width, max, onChange],
  );

  /**
   * The gesture is handled with the View responder props rather than `PanResponder`.
   *
   * `PanResponder.create` has to run somewhere, and every place to put it in a function
   * component is either during render or behind a ref read during render. These are
   * plain event-handler props, which is where reading a ref is legitimate — and it
   * removes an indirection rather than adding one.
   *
   * `pageX` with the measured track offset, not `locationX`: `locationX` is relative to
   * whichever child the touch actually landed on, so dragging across the thumb would
   * jump.
   */
  const shouldRespond = useCallback(() => !disabled, [disabled]);

  const onGrant = useCallback(
    (e: GestureResponderEvent) => setFromX(e.nativeEvent.pageX - trackPageX.current),
    [setFromX],
  );

  const onMove = useCallback(
    (e: GestureResponderEvent) => setFromX(e.nativeEvent.pageX - trackPageX.current),
    [setFromX],
  );

  const onRelease = useCallback(() => {
    lastHapticStep.current = -1;
  }, []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
    trackRef.current?.measureInWindow((x) => {
      trackPageX.current = x;
    });
  }, []);

  const pct = max > 0n ? Number((value * 1000n) / max) / 10 : 0;
  const markerPct =
    marker && max > 0n ? Math.min(100, Number((marker.at * 1000n) / max) / 10) : null;

  const nudge = (direction: 1n | -1n) => {
    const stepSize = max / STEPS;
    const next = value + direction * stepSize;
    onChange(next < 0n ? 0n : next > max ? max : next);
  };

  return (
    <View style={style}>
      <View
        ref={trackRef}
        onLayout={onLayout}
        onStartShouldSetResponder={shouldRespond}
        onMoveShouldSetResponder={shouldRespond}
        onResponderGrant={onGrant}
        onResponderMove={onMove}
        onResponderRelease={onRelease}
        onResponderTerminate={onRelease}
        // The whole 44pt band is grabbable, not just the 8pt visual track.
        style={styles.hitArea}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled }}
        accessibilityValue={{ text: formatValue(value) }}
        accessibilityActions={[
          { name: 'increment', label: 'Increase' },
          { name: 'decrement', label: 'Decrease' },
        ]}
        onAccessibilityAction={(event) => {
          if (disabled) return;
          if (event.nativeEvent.actionName === 'increment') nudge(1n);
          if (event.nativeEvent.actionName === 'decrement') nudge(-1n);
        }}
      >
        <View style={[styles.track, disabled && styles.trackDisabled]}>
          <View style={[styles.fill, { width: `${pct}%` }]} />

          {markerPct !== null ? (
            <View style={[styles.marker, { left: `${markerPct}%` }]} pointerEvents="none" />
          ) : null}

          <View
            style={[
              styles.thumb,
              { left: `${pct}%` },
              disabled && styles.thumbDisabled,
              // BRAND.md §6: nothing animates under reduce-motion. The thumb is driven
              // directly by the gesture either way, so there is no transition to strip —
              // this only suppresses the press-scale affordance.
              !reduceMotion && styles.thumbLift,
            ]}
            pointerEvents="none"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hitArea: { height: 44, justifyContent: 'center' },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    justifyContent: 'center',
  },
  trackDisabled: { opacity: 0.4 },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.pill,
    backgroundColor: brand.violet500,
  },
  marker: {
    position: 'absolute',
    top: -3,
    width: 1.5,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  thumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    marginLeft: -12,
    borderRadius: radius.pill,
    backgroundColor: '#FAFAFA',
    borderWidth: 3,
    borderColor: brand.violet500,
  },
  thumbLift: {},
  thumbDisabled: { borderColor: '#3F3F46' },
  spacer: { height: space.sm },
});
