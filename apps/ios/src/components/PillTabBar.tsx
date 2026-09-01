import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { base, brand, cardShadow, hit, radius, space, text } from '../design/tokens';
import { Icon, type IconName } from './Icon';
import { Txt } from './Text';

/**
 * The floating pill tab bar.
 *
 * Ported from the reference wallet's shell as a PATTERN only: a capsule that floats over
 * the page rather than a full-width strip welded to the bottom edge, so the four surfaces
 * read as a control the thumb reaches for rather than system chrome. Its colours are
 * Maren's, not the reference's dark glass: the capsule is a white surface with the card's
 * own soft drop (tokens.cardShadow), a hairline border, and the active tab sits in a
 * tinted `surfaceInset` pill with a violet glyph and label. Violet is the one saturated
 * colour on the chrome, exactly as the old strip had it (BRAND.md §2).
 */

/**
 * The minimal structural shape expo-router's `<Tabs tabBar>` hands its component.
 * Declared locally rather than imported from @react-navigation/bottom-tabs so the file
 * does not pull a second copy of the react-navigation types into the build.
 */
type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (e: {
      type: 'tabPress';
      target: string;
      canPreventDefault: true;
    }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
};

/** route name → icon + label. Home · Finance · Activity · Profile. */
const TABS: Record<string, { icon: IconName; label: string }> = {
  index: { icon: 'wallet', label: 'Home' },
  finance: { icon: 'vault', label: 'Finance' },
  activity: { icon: 'activity', label: 'Activity' },
  profile: { icon: 'person', label: 'Profile' },
};

export function PillTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      // Only the capsule takes touches; the transparent gutter around it lets the content
      // scrolling underneath stay tappable right up to the pill's edge.
      pointerEvents="box-none"
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, space.md) }]}
    >
      <View style={styles.bar}>
        {state.routes.map((route, i) => {
          const cfg = TABS[route.name];
          if (!cfg) return null;
          const focused = state.index === i;
          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          const tint = focused ? brand.violet500 : text.muted;
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={cfg.label}
              hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
              style={[styles.item, focused && styles.itemActive]}
            >
              <Icon name={cfg.icon} size={20} color={tint} />
              <Txt variant="small" style={[styles.label, { color: tint }]}>
                {cfg.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: base.surface,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    paddingHorizontal: 6,
    gap: 4,
    ...cardShadow,
  },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    // The pill floats, so the real touch target is the item itself: 56 tall clears the
    // 44pt floor (§4) with room for the icon-over-label stack.
    minHeight: 56,
    minWidth: hit.min + 20,
    paddingHorizontal: space.lg,
    // Inner radius = outer pill radius − the bar's 6px padding, kept as a real capsule so
    // the active fill nests concentrically inside the bar.
    borderRadius: radius.pill,
  },
  // The tinted "this one" pill, the same surfaceInset the segmented control selects with,
  // inverted here (fill on white) because the bar itself is the white surface.
  itemActive: { backgroundColor: base.surfaceInset },
  label: { fontSize: 11, letterSpacing: 0.2 },
});
