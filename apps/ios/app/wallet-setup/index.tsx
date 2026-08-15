import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { BackHeader } from '../../src/components/BackHeader';
import { Card } from '../../src/components/Card';
import { Icon } from '../../src/components/Icon';
import { Screen } from '../../src/components/Screen';
import { Label, Txt } from '../../src/components/Text';
import { base, brand, radius, semantic, space } from '../../src/design/tokens';
import { biometricName, getBiometricCapability, type BiometricCapability } from '../../src/wallet/keystore';

/**
 * Create or import.
 *
 * The screen leads with how the key will be held, because that is the decision the user
 * is actually making. If the device cannot back the key with biometrics we say so here,
 * before they commit — not in a toast afterwards.
 */
export default function WalletSetup() {
  const router = useRouter();
  const [cap, setCap] = useState<BiometricCapability | null>(null);

  useEffect(() => {
    getBiometricCapability().then(setCap);
  }, []);

  const protectedByBiometrics = cap?.available === true && cap.enrolled;

  return (
    <Screen>
      <BackHeader kicker="Step 1 of 2" title="Your signing key" />

      <Txt variant="body" tone="muted" style={styles.intro}>
        Maren is non-custodial. The key that signs your transactions is generated on this
        device and never leaves it — we cannot see it, move your funds, or recover it for
        you.
      </Txt>

      {/* Key protection, stated before the choice rather than after it. */}
      <Card tone="inset" style={styles.protectionCard}>
        <View style={styles.protectionHead}>
          <Icon
            name={protectedByBiometrics ? 'faceid' : 'alert'}
            size={20}
            color={protectedByBiometrics ? semantic.success : semantic.warning}
          />
          <Txt variant="small" style={styles.protectionTitle}>
            {cap === null
              ? 'Checking this device…'
              : protectedByBiometrics
                ? `Protected by ${biometricName(cap)}`
                : 'This device cannot protect a stored key'}
          </Txt>
        </View>

        <Txt variant="small" tone="muted" style={styles.protectionBody}>
          {cap === null
            ? 'Reading the Secure Enclave capabilities.'
            : protectedByBiometrics
              ? `Your key is written to the iOS Keychain with requireAuthentication, so ${biometricName(cap)} is required every time it is read — which is every time you sign.`
              : cap.available
                ? 'No Face ID or Touch ID is enrolled. Rather than write an unprotected key to disk, Maren will keep it in memory for this session only and will not persist it. Enrol biometrics in iOS Settings to store it properly.'
                : `${cap.reason} Rather than write an unprotected key to disk, Maren will keep it in memory for this session only.`}
        </Txt>
      </Card>

      <Label style={styles.chooseLabel}>Choose one</Label>

      <Choice
        icon="plus"
        title="Create a new key"
        body="Generates a fresh secp256k1 key on this device and derives your Mezo address from it."
        onPress={() => router.push('/wallet-setup/create')}
      />

      <Choice
        icon="wallet"
        title="Import an existing key"
        body="Paste a 64-character private key. It is validated locally and stored the same way."
        onPress={() => router.push('/wallet-setup/import')}
      />
    </Screen>
  );
}

function Choice({
  icon,
  title,
  body,
  onPress,
}: {
  icon: 'plus' | 'wallet';
  title: string;
  body: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={body}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Card style={styles.choice}>
        <View style={styles.choiceIcon}>
          <Icon name={icon} size={18} color={brand.violet400} />
        </View>
        <View style={styles.choiceBody}>
          <Txt variant="h3">{title}</Txt>
          <Txt variant="small" tone="muted" style={styles.choiceText}>
            {body}
          </Txt>
        </View>
        <Icon name="chevronRight" size={16} color="#6B6B75" />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  intro: { marginBottom: space.xl },
  protectionCard: { marginBottom: space.xxl },
  protectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  protectionTitle: { fontSize: 15 },
  protectionBody: { marginTop: space.sm },
  chooseLabel: { marginBottom: space.md },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    marginBottom: space.md,
  },
  choiceIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: base.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceBody: { flex: 1 },
  choiceText: { marginTop: space.xs },
  pressed: { opacity: 0.7 },
});
