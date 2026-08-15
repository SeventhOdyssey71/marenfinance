import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';

import { base, cardHighlight, radius, space } from '../design/tokens';

/**
 * BRAND.md §4 Card: surface fill, 1px hairline border, 16px radius, 24px padding.
 *
 * "Elevation comes from the hairline and a barely-there inner top highlight
 * (inset 0 1px 0 rgba(255,255,255,0.04)), never from a heavy drop shadow."
 *
 * React Native has no inset box-shadow, so the highlight is a 1px absolutely positioned
 * view pinned to the top edge, inside the border radius. There is no `shadow*` or
 * `elevation` prop anywhere in this component, deliberately.
 */
export interface CardProps extends ViewProps {
  children?: ReactNode;
  /** `raised` is BRAND's surface-raised — modals, popovers, hovered cards. */
  tone?: 'surface' | 'raised' | 'inset';
  /** Turn off the default 24px padding when the card hosts its own edge-to-edge rows. */
  padded?: boolean;
  style?: ViewStyle | ViewStyle[];
}

const fill: Record<NonNullable<CardProps['tone']>, string> = {
  surface: base.surface,
  raised: base.surfaceRaised,
  inset: base.surfaceInset,
};

export function Card({
  children,
  tone = 'surface',
  padded = true,
  style,
  ...rest
}: CardProps) {
  return (
    <View
      style={[styles.card, { backgroundColor: fill[tone] }, padded && styles.padded, style]}
      {...rest}
    >
      <View style={styles.topHighlight} pointerEvents="none" />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    overflow: 'hidden',
  },
  padded: {
    padding: space.xl,
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: cardHighlight,
  },
});
