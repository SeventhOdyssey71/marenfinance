import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { base, brand, hit, radius, semanticText, space, text } from '../design/tokens';
import { fonts, type } from '../design/type';
import { Txt } from './Text';

/**
 * Buttons are pills — the soft, borderless UGLYCASH set.
 *
 *   Primary   — the one glowing accent: pink fill, white label, a soft pink glow, and a
 *               near-black circular icon chip on the right so the white glyph reads.
 *   Secondary — quiet soft-grey pill, no border, near-black text.
 *   Both      — 44px min height for touch.
 *
 * The pink primary is the single saturated CTA a screen is allowed (§2); everything else
 * is grey and quiet, so the accent never has to compete. No pill carries an outline.
 *
 * `danger` is not a fill style; destructive actions use `secondary` with danger-toned
 * label text, so the only saturated fill on a screen stays the one pink CTA (§2).
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
            color={text.primary}
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
  /** The one glowing accent: pink fill under a soft pink drop. */
  primary: {
    backgroundColor: brand.violet500,
    paddingRight: 6,
    shadowColor: brand.violet500,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 4,
  },
  primaryPressed: { backgroundColor: brand.violet600 },
  /**
   * A disabled primary is NOT a dimmed pill.
   *
   * `opacity: 0.4` over the fill produced a large mid-grey slab — the loudest object on
   * the screen, telling the user they cannot act. A disabled control should recede. This
   * is the quiet soft-grey surface with no glow, so it reads as the ghost of the pink
   * button that will exist once the form is valid.
   */
  primaryInert: {
    backgroundColor: base.surfaceInset,
    paddingRight: 6,
  },
  /** The quiet action: soft grey, no border. */
  secondary: {
    backgroundColor: base.surfaceInset,
  },
  secondaryPressed: { backgroundColor: base.borderStrong },
  ghost: { backgroundColor: 'transparent' },
  inert: { opacity: 0.4 },
  label: {
    fontFamily: fonts.medium,
    fontSize: type.small.fontSize,
    letterSpacing: 0,
  },
  /**
   * Near-black label on the pink accent fill. White on #FA00FF is only 3.2:1 and fails
   * AA for a 14px label; near-black is 5.9:1 and reads cleanly, and the dark label pairs
   * with the near-black icon chip so the pink pill carries two dark marks, not a wash.
   */
  labelOnWhite: { color: text.primary },
  labelInert: { color: text.muted },
  /**
   * A ghost button is the quietest action on the screen and must read that way. At full
   * strength it had the same weight as the primary CTA sitting directly above it, so the
   * onboarding footer offered two equally loud choices. The shipped web app renders its
   * ghost variant `text-text-muted`; this matches it.
   */
  labelGhost: { color: text.muted },
  labelOnDark: { color: text.primary },
  labelDanger: { color: semanticText.danger },
  spinner: { marginRight: space.sm },
  /**
   * The circular icon chip on the right of the pink pill. It is near-black, not pink —
   * a pink chip on a pink pill would vanish — so the white glyph the callers pass reads
   * at full contrast and the chip becomes the pill's one dark detail.
   */
  badge: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: text.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** On a disabled (grey) pill the chip recedes to subtle grey, still holding the glyph. */
  badgeInert: { backgroundColor: text.subtle },
});
