import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { hit, radius, space, base } from '../design/tokens';
import { Icon } from './Icon';
import { Label, Txt } from './Text';

/** A screen header with a 44pt back target and an optional right-hand slot. */
export function BackHeader({
  title,
  kicker,
  right,
  onBack,
}: {
  title?: string;
  kicker?: string;
  right?: React.ReactNode;
  onBack?: () => void;
}) {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <Pressable
        onPress={onBack ?? (() => router.back())}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={10}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Icon name="chevronLeft" size={18} color="#FAFAFA" />
      </Pressable>

      <View style={styles.titles}>
        {kicker ? <Label>{kicker}</Label> : null}
        {title ? (
          <Txt variant="h3" accessibilityRole="header">
            {title}
          </Txt>
        ) : null}
      </View>

      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    marginBottom: space.xl,
  },
  back: {
    width: hit.min,
    height: hit.min,
    borderRadius: radius.pill,
    backgroundColor: base.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  titles: { flex: 1, gap: 2 },
  right: { minWidth: 0 },
});
