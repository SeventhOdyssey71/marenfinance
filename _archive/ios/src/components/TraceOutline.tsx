import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { brand } from '../design/tokens';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * A dashed rounded-rect border drawn over its parent — the reference design's "trace"
 * accent on a highlighted card.
 *
 * It is an overlay, not a border: `pointerEvents="none"` and an absolute fill, so it
 * decorates whatever it is dropped into without touching that view's layout or stealing
 * its touches. It measures the parent with `onLayout` and insets the rectangle so the
 * dashes sit inside a card's own rounded corner rather than riding its edge.
 *
 * The optional marching-ants animation is off by default and, when on, is disabled whole
 * under reduce-motion per BRAND.md §6 — the hook renders the final (static) frame, it does
 * not merely slow the loop. It drives `strokeDashoffset` on the JS thread because SVG
 * props cannot use the native driver; the loop is slow and cheap enough that this is not
 * a concern.
 */
export interface TraceOutlineProps {
  color?: string;
  /** Corner radius of the dashed rect. Match the host card's radius for a clean nest. */
  cornerRadius?: number;
  /** Distance from the parent's edge to the dashes. */
  inset?: number;
  dash?: number;
  gap?: number;
  strokeWidth?: number;
  /** Slowly march the dashes. Gated by reduce-motion. */
  animated?: boolean;
}

const AnimatedRect = Animated.createAnimatedComponent(Rect);

export function TraceOutline({
  color = brand.violet400,
  cornerRadius = 14,
  inset = 5,
  dash = 5,
  gap = 6,
  strokeWidth = 1.25,
  animated = false,
}: TraceOutlineProps) {
  const reduced = useReducedMotion();
  const [size, setSize] = useState({ w: 0, h: 0 });
  // A stable Animated.Value for the soft marching-ants offset. useMemo rather than a ref
  // so nothing reads `.current` during render.
  const offset = useMemo(() => new Animated.Value(0), []);
  const move = animated && !reduced;

  useEffect(() => {
    if (!move) return;
    // One full dash+gap of travel, looped, so the seam never shows.
    const loop = Animated.loop(
      Animated.timing(offset, {
        toValue: dash + gap,
        duration: 1_400,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [move, offset, dash, gap]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {size.w > 0 && size.h > 0 ? (
        <Svg width={size.w} height={size.h}>
          <AnimatedRect
            x={inset}
            y={inset}
            width={size.w - inset * 2}
            height={size.h - inset * 2}
            rx={cornerRadius}
            ry={cornerRadius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={[dash, gap]}
            strokeDashoffset={move ? offset : 0}
          />
        </Svg>
      ) : null}
    </View>
  );
}
