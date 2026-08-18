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
 * BRAND.md §4: "Buttons are pills."
 *
 *   Primary   — near-black fill, page-coloured text, circular violet icon badge right.
 *   Secondary — white fill, hairline border, near-black text.
 *   Both      — 44px min height for touch.
 *
 * The primary pill inverted with the theme rather than staying white, which is exactly
 * what the web does: its class is `bg-text text-bg`, so the fill is whatever the text
 * colour is and the label is whatever the page is. On dark that was a white pill with
 * near-black text; on light it is a near-black pill on an off-white page, 16.62:1.
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
            color={variant === 'primary' ? base.bg : text.primary}
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
  primary: { backgroundColor: text.primary, paddingRight: 6 },
  primaryPressed: { backgroundColor: '#2E2E36' },
  /**
   * A disabled primary is NOT a dimmed pill.
   *
   * `opacity: 0.4` over the fill produced a large mid-grey slab — the loudest object on
   * the screen, in a colour that is in no palette, telling the user they cannot act. A
   * disabled control should recede. This is the recessed surface with a hairline, so it
   * reads as an outline of the button that will exist once the form is valid. It uses
   * `surfaceInset` rather than `surfaceRaised` because a raised pill is now #FFFFFF and
   * would vanish on the white card most of these sit on.
   */
  primaryInert: {
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    paddingRight: 6,
  },
  secondary: {
    backgroundColor: base.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.borderStrong,
  },
  secondaryPressed: { backgroundColor: base.surfaceInset },
  ghost: { backgroundColor: 'transparent' },
  inert: { opacity: 0.4 },
  label: {
    fontFamily: fonts.medium,
    fontSize: type.small.fontSize,
    letterSpacing: 0,
  },
  /** Named for the web class it mirrors, `text-bg`: the page colour on the text colour. */
  labelOnWhite: { color: base.bg },
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
  /** The circular violet icon badge from the reference design. */
  badge: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: brand.violet500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * The badge loses its saturation with the button — §2 keeps violet for live CTAs.
   *
   * A translucent scrim was the dark theme's answer and does not survive the move: over
   * an #EFEDF6 pill it lands on a near-white grey, and the white glyph inside it would
   * disappear. `text-subtle` is the desaturated fill that still holds the glyph at
   * 3.80:1, which is the bar for a graphical object.
   */
  badgeInert: { backgroundColor: text.subtle },
});
