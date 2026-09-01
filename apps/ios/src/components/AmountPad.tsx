import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { base, hit, radius, space, text } from '../design/tokens';
import { fonts } from '../design/type';
import { Icon } from './Icon';
import { Txt } from './Text';

/**
 * The amount keypad — a 3x4 grid (1-9, ".", 0, backspace) that edits a decimal string
 * without ever going through a float. It is the reference wallet's Send numpad in Maren's
 * house style: plain StyleSheet, design tokens, the Maren Icon set, and the same
 * `parseMusd` the Pay screen already uses to turn its output into wei.
 *
 * The custom pad rather than the OS decimal keyboard is deliberate: the amount is the
 * loudest thing on the screen, and a system keyboard would cover it at the moment the user
 * is trying to read what they typed. It also lets us cap the fraction at MUSD's two
 * decimals and the integer part at nine digits, so the hero numeral can never overflow.
 *
 * Every key clears the 44pt touch floor (§4) and carries its own accessibility label, so
 * VoiceOver reads "1", "Decimal point", "Delete" rather than three unlabelled buttons.
 */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '<'] as const;

export interface AmountPadProps {
  value: string;
  onChange: (next: string) => void;
  /** Digits allowed before the point. */
  maxInt?: number;
  /** Digits allowed after the point. MUSD is a two-decimal unit. */
  maxFrac?: number;
}

export function AmountPad({ value, onChange, maxInt = 9, maxFrac = 2 }: AmountPadProps) {
  const press = (key: string) => {
    // A light tap on every key. Haptics are not visual motion, so this is not gated on
    // reduce-motion; the .catch keeps a simulator without a Taptic Engine silent.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    if (key === '<') return onChange(value.slice(0, -1));

    if (key === '.') {
      if (value.includes('.')) return;
      return onChange(value === '' ? '0.' : `${value}.`);
    }

    const [intPart, fracPart] = value.split('.');
    if (value.includes('.')) {
      if ((fracPart ?? '').length >= maxFrac) return;
    } else if ((intPart ?? '').replace(/^0+/, '').length >= maxInt) {
      return;
    }

    let next = value + key;
    // Strip a leading zero on the integer part so "05" becomes "5", but leave "0." alone.
    if (!next.includes('.')) next = next.replace(/^0+(?=\d)/, '');
    onChange(next);
  };

  return (
    <View style={styles.pad}>
      {KEYS.map((key) => (
        <Pressable
          key={key}
          onPress={() => press(key)}
          accessibilityRole="button"
          accessibilityLabel={labelFor(key)}
          style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
        >
          {key === '<' ? (
            <Icon name="backspace" size={24} color={text.primary} />
          ) : (
            <Txt style={styles.keyLabel}>{key}</Txt>
          )}
        </Pressable>
      ))}
    </View>
  );
}

function labelFor(key: string): string {
  if (key === '<') return 'Delete';
  if (key === '.') return 'Decimal point';
  return key;
}

const styles = StyleSheet.create({
  pad: { flexDirection: 'row', flexWrap: 'wrap' },
  key: {
    width: '33.33%',
    minHeight: hit.min + 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
  },
  keyPressed: { backgroundColor: base.surfaceInset },
  keyLabel: {
    fontFamily: fonts.medium,
    fontSize: 26,
    lineHeight: 32,
    color: text.primary,
  },
});
