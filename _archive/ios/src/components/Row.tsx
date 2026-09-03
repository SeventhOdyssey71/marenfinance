import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { base, hit, space, text } from '../design/tokens';
import { Icon } from './Icon';
import { Txt } from './Text';

/**
 * A label/value row — the workhorse of every detail panel in the app.
 *
 * The value is passed as a node rather than a string so callers must render it through
 * <Num>, which is the only component that applies tabular figures. A row with a bare
 * string value would silently lose BRAND.md §3's numeral rules.
 */
export interface StatRowProps {
  label: string;
  value: ReactNode;
  /** Secondary line under the value, e.g. the USD equivalent of a BTC figure. */
  sub?: ReactNode;
  hint?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  last?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function StatRow({
  label,
  value,
  sub,
  hint,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  last = false,
  style,
}: StatRowProps) {
  const content = (
    <View style={[styles.row, !last && styles.divider, style]}>
      <View style={styles.labelCol}>
        <Txt variant="small" tone="muted">
          {label}
        </Txt>
        {hint ? (
          <Txt variant="small" tone="muted" style={styles.hint}>
            {hint}
          </Txt>
        ) : null}
      </View>
      <View style={styles.valueCol}>
        {value}
        {sub ? <View style={styles.sub}>{sub}</View> : null}
      </View>
      {/* A disclosure chevron is quiet ornament that repeats the row's own tappability,
          so it takes the light `subtle` grey. Nothing that reads as copy uses this tone. */}
      {onPress ? <Icon name="chevronRight" size={16} color={text.subtle} /> : null}
    </View>
  );

  if (!onPress) {
    // Group the label and value into one VoiceOver stop so it reads "Collateral ratio,
    // 254.1 percent" rather than as two disconnected elements.
    return (
      <View accessible accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function Divider() {
  return <View style={styles.standaloneDivider} />;
}

const styles = StyleSheet.create({
  row: {
    minHeight: hit.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    paddingVertical: space.md,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: base.border,
  },
  standaloneDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: base.border,
    marginVertical: space.lg,
  },
  // The label takes what is left after the numeral, rather than the numeral being
  // squeezed. A wrapped figure is much worse than a wrapped label — BRAND.md §3 wants
  // digits in a stable tabular column.
  labelCol: { flexShrink: 1, flexGrow: 1, flexBasis: 0 },
  valueCol: { alignItems: 'flex-end', flexShrink: 0 },
  sub: { marginTop: 2 },
  hint: { marginTop: 2 },
  pressed: { opacity: 0.6 },
});
