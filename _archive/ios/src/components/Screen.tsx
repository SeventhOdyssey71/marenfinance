import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { base, gradients, space } from '../design/tokens';

/**
 * The page shell. Soft grey UGLYCASH canvas, safe-area aware, with an optional static
 * gradient wash at the top — the subtle pink ambient glow.
 *
 * BRAND.md §5 is explicit: "Never mount a shader above the fold on the iOS app — use a
 * static gradient there." So this is expo-linear-gradient with a pink → pale-pink →
 * canvas ramp, and nothing animates.
 */
export interface ScreenProps {
  children: ReactNode;
  /** Render the pink ambient glow behind the top of the page. */
  wash?: boolean;
  scroll?: boolean;
  /** Extra bottom padding, e.g. to clear a pinned action bar. */
  bottomInset?: number;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Screen({
  children,
  wash = false,
  scroll = true,
  bottomInset = 0,
  contentStyle,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  const body = (
    <View style={[styles.body, { paddingTop: insets.top + space.sm }, contentStyle]}>
      {children}
    </View>
  );

  return (
    <View style={styles.root} testID={testID}>
      {wash ? (
        <LinearGradient
          colors={gradients.hero}
          locations={[0, 0.45, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.wash}
          pointerEvents="none"
        />
      ) : null}

      {scroll ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl + bottomInset }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          // Keeps the rubber-band overscroll on the canvas colour rather than on the
          // system default, which is white and reads a shade off against #F2F2F2.
          contentInsetAdjustmentBehavior="never"
        >
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: base.bg },
  scroll: { flex: 1 },
  body: { paddingHorizontal: space.xl },
  wash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 420,
  },
});
