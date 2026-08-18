import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';

import { base, cardShadow, radius, space } from '../design/tokens';

/**
 * BRAND.md §4 Card, as the light app renders it: white fill, 16px radius, 24px padding,
 * and a soft drop.
 *
 * The web rule states the reason in one line: "On dark, a card is a hairline and nothing
 * else. On light, the hairline alone reads as an unfinished wireframe — the card IS a
 * white surface with a soft drop." So the dark theme's 1px inner top highlight is gone,
 * the hairline goes with it on the two white tones, and elevation comes from
 * `cardShadow`.
 *
 * `overflow: 'hidden'` went with the highlight, and not only because nothing needs
 * clipping now. On iOS it compiles to `layer.masksToBounds = true`, which clips the
 * layer's own shadow — a card carrying both would render with no drop at all.
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

export function Card({ children, tone = 'surface', padded = true, style, ...rest }: CardProps) {
  /**
   * The inset tone is a recessed panel, not a raised one — it is the page tint sitting
   * inside a card. It keeps the hairline and takes no shadow, or it would read as
   * floating above the surface it is supposed to be cut into.
   */
  const inset = tone === 'inset';

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: fill[tone] },
        inset ? styles.insetEdge : cardShadow,
        padded && styles.padded,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
  },
  /** Only the recessed tone draws an edge; a white card is defined by its drop. */
  insetEdge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
  },
  padded: {
    padding: space.xl,
  },
});
