import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { base, brand, hit, radius, space } from '../design/tokens';
import { fonts, type } from '../design/type';
import { Txt } from './Text';

/**
 * BRAND.md §4: "Buttons are pills."
 *
 *   Primary   — white fill, near-black text, circular violet icon badge on the right.
 *   Secondary — surface-raised fill, hairline border, white text.
 *   Both      — 44px min height for touch.
 *
 * `danger` is not in BRAND.md as a button style; destructive actions use `secondary`
 * with danger-toned label text, so that the only saturated fill on a screen stays the
 * violet badge (§2).
 */
export type PillVariant = 'primary' | 'secondary' | 'ghost';

export interface PillButtonProps {
  label: string;
  onPress?: () => void;
  variant?: PillVariant;
  /** Glyph rendered inside the circular violet badge on a primary button. */
  badge?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  /** Stretch to the container width — the default for a screen's main action. */
  block?: boolean;
  /** Spoken by VoiceOver instead of `label` when the label alone is ambiguous. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  tone?: 'default' | 'danger';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function PillButton({
  label,
  onPress,
  variant = 'primary',
  badge,
  disabled = false,
  loading = false,
  block = true,
  accessibilityLabel,
  accessibilityHint,
  tone = 'default',
  style,
  testID,
}: PillButtonProps) {
  const inert = disabled || loading;

  return (
    <Pressable
      onPress={inert ? undefined : onPress}
      disabled={inert}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy: loading }}
      // 44pt minimum touch target, BRAND.md §4.
      hitSlop={8}
      style={({ pressed }) => [
        styles.root,
        block && styles.block,
        variant === 'primary' && (inert ? styles.primaryInert : styles.primary),
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        pressed && variant === 'primary' && styles.primaryPressed,
        pressed && variant !== 'primary' && styles.secondaryPressed,
        inert && variant !== 'primary' && styles.inert,
        style,
      ]}
    >
      <View style={styles.inner}>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={variant === 'primary' ? base.bg : '#FAFAFA'}
            style={styles.spinner}
          />
        ) : null}
        <Txt
          style={[
            styles.label,
            variant === 'primary'
              ? inert
                ? styles.labelInert
                : styles.labelOnWhite
              : variant === 'ghost'
                ? styles.labelGhost
                : styles.labelOnDark,
            tone === 'danger' && variant !== 'primary' && styles.labelDanger,
          ]}
          numberOfLines={1}
        >
          {label}
        </Txt>
      </View>

      {variant === 'primary' && badge ? (
        <View style={[styles.badge, inert && styles.badgeInert]} pointerEvents="none">
          {badge}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    minHeight: hit.min,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  block: { alignSelf: 'stretch' },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingVertical: space.md,
  },
  primary: { backgroundColor: '#FAFAFA', paddingRight: 6 },
  primaryPressed: { backgroundColor: '#E4E4E7' },
  /**
   * A disabled primary is NOT a dimmed white pill.
   *
   * `opacity: 0.4` over a white fill produced a large mid-grey slab — the loudest object
   * on the screen, in a colour that is in no palette, telling the user they cannot act.
   * A disabled control should recede. This is the secondary surface with a hairline, so
   * it reads as an outline of the button that will exist once the form is valid.
   */
  primaryInert: {
    backgroundColor: base.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    paddingRight: 6,
  },
  secondary: {
    backgroundColor: base.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
  },
  secondaryPressed: { backgroundColor: '#202026' },
  ghost: { backgroundColor: 'transparent' },
  inert: { opacity: 0.4 },
  label: {
    fontFamily: fonts.medium,
    fontSize: type.small.fontSize,
    letterSpacing: 0,
  },
  labelOnWhite: { color: base.bg },
  labelInert: { color: '#A1A1AA' },
  /**
   * A ghost button is the quietest action on the screen and must read that way. At full
   * #FAFAFA it had the same weight as the primary CTA sitting directly above it, so the
   * onboarding footer offered two equally loud choices. The shipped web app renders its
   * ghost variant `text-text-muted`; this matches it.
   */
  labelGhost: { color: '#A1A1AA' },
  labelOnDark: { color: '#FAFAFA' },
  labelDanger: { color: '#F87171' },
  spinner: { marginRight: space.sm },
  /** The circular violet icon badge from the reference design. */
  badge: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: brand.violet500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The badge loses its saturation with the button — §2 keeps violet for live CTAs. */
  badgeInert: { backgroundColor: 'rgba(255,255,255,0.06)' },
});
