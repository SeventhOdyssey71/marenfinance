import { useEffect, useMemo } from 'react';
import { Animated, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { base, radius, semantic, semanticText, space } from '../design/tokens';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Btc, Musd } from './Money';
import { Icon } from './Icon';
import { PillButton } from './PillButton';
import { Label, Txt } from './Text';

/**
 * A full-screen celebration shown after a *delivered* value move — Talise's
 * savings-success cover in Maren's house style, generalised so Earn and Vault share one.
 *
 * The honesty rule that governs the whole app governs this too: it is a cover, not a
 * claim. It is only ever mounted by a caller that has already seen a `delivered` outcome
 * from the R15 checkpoint, so there is no path that reaches this screen without a receipt
 * behind it. It states the exact amount that moved, nothing forward-looking, and no rate.
 *
 * The subline reads as a continuation of the amount above it ("{1,000.00 MUSD} / is now
 * spendable."), so callers write it as the predicate only.
 *
 * Motion is one entrance — the mark and copy scale and fade up once — and it is disabled
 * whole under reduce-motion (§6): the hook renders the final frame rather than a shortened
 * animation. It runs on the native driver because only transform and opacity move.
 */
export interface SuccessCoverProps {
  visible: boolean;
  /** The amount that moved, 1e18. Rendered as the hero numeral. */
  amountWei: bigint;
  /** Which asset the amount is denominated in. */
  unit?: 'musd' | 'btc';
  /** Small tracked caption above the headline. */
  eyebrow?: string;
  headline: string;
  /** The predicate that follows the amount, e.g. "is now spendable." */
  subline: string;
  doneLabel?: string;
  onDone: () => void;
}

export function SuccessCover({
  visible,
  amountWei,
  unit = 'musd',
  eyebrow = 'Delivered',
  headline,
  subline,
  doneLabel = 'Done',
  onDone,
}: SuccessCoverProps) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  // One shared progress value, 0 → 1, driving opacity and a small rise+scale. useMemo so
  // nothing reads `.current` during render; the effect below starts it when the cover
  // mounts and resets it when it leaves so a second success animates again.
  const progress = useMemo(() => new Animated.Value(reduced ? 1 : 0), [reduced]);

  useEffect(() => {
    if (!visible) return;
    if (reduced) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 320,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [visible, reduced, progress]);

  if (!visible) return null;

  const rise = progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });

  return (
    <Modal transparent={false} animationType="fade" visible onRequestClose={onDone}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.center}>
          <Animated.View
            style={[styles.mark, { opacity: progress, transform: [{ scale }] }]}
            accessible
            accessibilityRole="image"
            accessibilityLabel="Success"
          >
            <Icon name="check" size={34} color={semantic.success} />
          </Animated.View>

          <Animated.View style={{ opacity: progress, transform: [{ translateY: rise }] }}>
            <Label style={styles.eyebrow}>{eyebrow}</Label>
            <Txt variant="h2" style={styles.headline}>
              {headline}
            </Txt>
            <View style={styles.amount}>
              {unit === 'btc' ? (
                <Btc wei={amountWei} size="numericXl" align="left" />
              ) : (
                <Musd wei={amountWei} size="numericXl" align="left" />
              )}
            </View>
            <Txt variant="small" tone="muted" style={styles.subline}>
              {subline}
            </Txt>
          </Animated.View>
        </View>

        <View style={styles.footer}>
          <PillButton
            label={doneLabel}
            onPress={onDone}
            accessibilityHint="Closes this confirmation."
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: base.bg, paddingHorizontal: space.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mark: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${semanticText.success}55`,
    backgroundColor: base.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xl,
  },
  eyebrow: { textAlign: 'center', color: semanticText.success },
  headline: { textAlign: 'center', marginTop: space.sm },
  amount: { alignItems: 'center', marginTop: space.lg },
  subline: { textAlign: 'center', marginTop: space.lg, maxWidth: 320 },
  footer: { paddingBottom: space.lg },
});
