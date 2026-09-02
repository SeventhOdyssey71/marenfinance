import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { base, hit, radius } from '../design/tokens';
import { Txt } from './Text';
import { describeSegments, type SegmentOption } from './SegmentedControl.logic';

export { describeSegments } from './SegmentedControl.logic';
export type { SegmentOption, SegmentDescriptor } from './SegmentedControl.logic';

/**
 * A segmented control — two or more mutually exclusive tabs in a single pill track.
 *
 * The Vault, Pay and Earn screens each grew their own inline copy of this shape before
 * there was a component for it. This is that shape extracted once, so a screen adding a
 * segmented control gets the light-theme styling, the tablist semantics and the touch
 * target for free rather than transcribing them and drifting.
 *
 * The track is `surfaceInset` (the page tint cut into the surface) and the selected
 * segment is a raised white pill, which is the one place `surfaceRaised` earns its keep on
 * light: white-on-tinted is exactly the affordance for "this one is chosen". The reference
 * design's dark pill-tab shape is kept; its colours are not.
 *
 * ACCESSIBILITY. The container is a `tablist` and each segment a `tab` carrying its own
 * `selected` state, so VoiceOver announces "Balances, tab, 1 of 2, selected". The visible
 * pill is 40pt tall and every segment takes a vertical `hitSlop`, so the real touch target
 * clears the 44pt floor even though the pill reads a little tighter.
 */

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (key: T) => void;
  /** Labels the whole control for assistive tech, e.g. "Balances or history". */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: SegmentedControlProps<T>) {
  const segments = describeSegments(options, value);

  return (
    <View
      style={[styles.track, style]}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {segments.map((segment) => (
        <Pressable
          key={segment.key}
          onPress={() => onChange(segment.key)}
          accessibilityRole="tab"
          accessibilityState={{ selected: segment.selected }}
          accessibilityLabel={segment.accessibilityLabel}
          // The pill is 40pt; the slop lifts the real target past the 44pt floor (§4).
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          style={[styles.segment, segment.selected && styles.segmentActive]}
        >
          <Txt variant="small" tone={segment.selected ? 'primary' : 'muted'}>
            {segment.label}
          </Txt>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: base.surfaceInset,
    borderRadius: radius.pill,
    padding: 4,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  // A raised white pill on the tinted track. `surfaceRaised` is #FFFFFF, which is the
  // point: white-on-tinted marks the selection without a saturated colour.
  segmentActive: {
    backgroundColor: base.surfaceRaised,
    minHeight: hit.min - 4,
    // A soft drop lifts the chosen pill off the grey track — the raised white affordance.
    shadowColor: '#101013',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
});
