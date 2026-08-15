import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { getChain, shortAddress, type MezoNetwork } from '@maren/sdk';

import { BackHeader } from '../../src/components/BackHeader';
import { Card } from '../../src/components/Card';
import { Icon } from '../../src/components/Icon';
import { PillButton } from '../../src/components/PillButton';
import { StatRow } from '../../src/components/Row';
import { Screen } from '../../src/components/Screen';
import { Label, Num, Txt } from '../../src/components/Text';
import { AUTH_ORIGIN, AUTH_REDIRECT_URI } from '../../src/auth/webAuth';
import { STALE_AFTER_SECONDS } from '../../src/chain/price';
import { base, brand, radius, semantic, space } from '../../src/design/tokens';
import { useAppStore } from '../../src/state/store';
import {
  biometricName,
  clearKey,
  getBiometricCapability,
  requirePresence,
  type BiometricCapability,
} from '../../src/wallet/keystore';

/**
 * Settings — network, security, address, sign out.
 *
 * The security section describes what is actually true of this build rather than what
 * we would like to be true. R13 is the rule: "Either verify the attestation assertion
 * properly, or say the product does not use attestation." So the App Attest row says,
 * in plain words, that this build does not use it.
 */
export default function Settings() {
  const router = useRouter();
  const address = useAppStore((s) => s.address);
  const handle = useAppStore((s) => s.handle);
  const protection = useAppStore((s) => s.protection);
  const network = useAppStore((s) => s.network);
  const setNetwork = useAppStore((s) => s.setNetwork);
  const forcedStale = useAppStore((s) => s.forcedStaleSeconds);
  const setForcedStale = useAppStore((s) => s.setForcedStale);
  const signOut = useAppStore((s) => s.signOut);

  const [cap, setCap] = useState<BiometricCapability | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getBiometricCapability().then(setCap);
  }, []);

  const chain = getChain(network);

  const copyAddress = async () => {
    await Clipboard.setStringAsync(address ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1_800);
  };

  const doSignOut = async () => {
    // A presence check before destroying the key, so a grabbed unlocked phone cannot
    // wipe an account in one tap.
    const ok = await requirePresence('Confirm it is you before signing out');
    if (!ok) return;
    await clearKey();
    signOut();
    router.replace('/onboarding');
  };

  return (
    <Screen bottomInset={space.xxl}>
      <BackHeader title="Settings" />

      {/* Account */}
      <Label style={styles.sectionLabel}>Account</Label>
      <Card padded={false} style={styles.section}>
        <View style={styles.sectionInner}>
          <StatRow
            label="Handle"
            value={
              <Num size="numeric" tone="muted">
                {handle ?? '—'}
              </Num>
            }
          />
          <StatRow
            label="Address"
            value={
              <Num size="numericSm" tone="muted">
                {address ? shortAddress(address, 8, 6) : '—'}
              </Num>
            }
            onPress={copyAddress}
            accessibilityLabel={`Address ${address}. Tap to copy.`}
            accessibilityHint="Copies your full address to the clipboard."
            last
          />
        </View>
      </Card>

      {address ? (
        <View style={styles.fullAddress}>
          <Num size="numericSm" tone="muted" selectable>
            {address}
          </Num>
          <Pressable
            onPress={copyAddress}
            accessibilityRole="button"
            accessibilityLabel="Copy address"
            hitSlop={10}
            style={styles.copyButton}
          >
            <Icon
              name={copied ? 'check' : 'copy'}
              size={15}
              color={copied ? semantic.success : '#6B6B75'}
            />
          </Pressable>
        </View>
      ) : null}

      {/* Network */}
      <Label style={styles.sectionLabel}>Network</Label>
      <View style={styles.networkRow}>
        {(['testnet', 'mainnet'] as MezoNetwork[]).map((n) => {
          const active = n === network;
          const c = getChain(n);
          return (
            <Pressable
              key={n}
              onPress={() => setNetwork(n)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${c.name}, chain ID ${c.id}`}
              style={[styles.networkCard, active && styles.networkCardActive]}
            >
              <View style={styles.networkHead}>
                <Txt variant="small" tone={active ? 'primary' : 'muted'}>
                  {n === 'testnet' ? 'Matsnet' : 'Mainnet'}
                </Txt>
                {active ? <Icon name="check" size={14} color={brand.violet400} /> : null}
              </View>
              <Num size="numericSm" tone="muted" style={styles.chainId}>
                {`chain ${c.id}`}
              </Num>
            </Pressable>
          );
        })}
      </View>

      <Txt variant="small" tone="muted" style={styles.networkNote}>
        {network === 'mainnet'
          ? 'Mainnet moves real Bitcoin and real MUSD. Every figure on screen is a live position.'
          : 'Matsnet is Mezo’s testnet. Nothing here is worth anything, which is the point.'}
      </Txt>

      {/* Security */}
      <Label style={styles.sectionLabel}>Security</Label>
      <Card padded={false} style={styles.section}>
        <View style={styles.sectionInner}>
          <StatRow
            label="Signing key"
            hint={
              protection?.mode === 'keychain-biometric'
                ? 'iOS Keychain, this device only'
                : 'in memory, this session only'
            }
            value={
              <Txt
                variant="small"
                style={{
                  color:
                    protection?.mode === 'keychain-biometric' ? semantic.success : semantic.warning,
                }}
              >
                {protection?.mode === 'keychain-biometric' ? protection.label : 'Not persisted'}
              </Txt>
            }
          />
          <StatRow
            label="Biometrics"
            value={
              <Txt variant="small" tone="muted">
                {cap === null
                  ? 'checking'
                  : cap.available
                    ? cap.enrolled
                      ? `${biometricName(cap)} enrolled`
                      : `${biometricName(cap)} not enrolled`
                    : 'unavailable'}
              </Txt>
            }
            hint="required on every signature"
          />
          <StatRow
            label="Sign-in"
            hint="ASWebAuthenticationSession over a verified universal link"
            value={
              <Num size="numericSm" tone="muted">
                {AUTH_ORIGIN.replace('https://', '')}
              </Num>
            }
          />
          <StatRow
            label="App Attest"
            hint="not implemented in this build — we do not claim it"
            value={
              <Txt variant="small" tone="muted">
                Not used
              </Txt>
            }
            last
          />
        </View>
      </Card>

      <Card tone="inset" style={styles.authNote}>
        <View style={styles.authHead}>
          <Icon name="shield" size={15} color={semantic.success} />
          <Txt variant="small" style={{ color: semantic.success }}>
            No custom URL scheme is used for authentication
          </Txt>
        </View>
        <Txt variant="small" tone="muted" style={styles.authBody}>
          The auth callback arrives only on {AUTH_REDIRECT_URI}, a universal link Apple verifies
          against this app’s entitlement, with a 256-bit CSRF token compared in constant time. A
          custom scheme is claimable by any other app on the device, so Maren refuses to accept one
          — the check is in code, not in a policy document.
        </Txt>
      </Card>

      {/* Developer */}
      <Label style={styles.sectionLabel}>Developer</Label>
      <Card style={styles.section}>
        <View style={styles.switchRow}>
          <View style={styles.switchBody}>
            <Txt variant="small">Simulate a stale price feed</Txt>
            <Txt variant="small" tone="muted" style={styles.switchCaption}>
              Backdates the oracle observation past Mezo’s {STALE_AFTER_SECONDS}s limit so the
              price-unavailable state and the borrow gate can be exercised.
            </Txt>
          </View>
          <Switch
            value={forcedStale > 0}
            onValueChange={(on) => setForcedStale(on ? 90 : 0)}
            trackColor={{ false: '#27272A', true: brand.violet500 }}
            thumbColor="#FAFAFA"
            ios_backgroundColor="#27272A"
            accessibilityLabel="Simulate a stale price feed"
          />
        </View>
      </Card>

      {/* Explorer */}
      <StatRow
        label="Block explorer"
        value={
          <Num size="numericSm" tone="muted">
            {chain.blockExplorers?.default.url.replace('https://', '') ?? '—'}
          </Num>
        }
        last
      />

      <PillButton
        label="Sign out"
        variant="secondary"
        tone="danger"
        onPress={doSignOut}
        accessibilityHint="Deletes the signing key from this device. This cannot be undone."
        style={styles.signOut}
      />

      <Txt variant="small" tone="muted" style={styles.signOutNote}>
        Signing out deletes the key from the Keychain. Maren holds no copy — without your own backup
        the funds it controls are unrecoverable.
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { marginBottom: space.md, marginTop: space.lg },
  section: { marginBottom: space.sm },
  sectionInner: { paddingHorizontal: space.xl, paddingVertical: space.xs },
  fullAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.xs,
    marginBottom: space.sm,
  },
  copyButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  networkRow: { flexDirection: 'row', gap: space.md },
  networkCard: {
    flex: 1,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: base.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    minHeight: 44,
  },
  networkCardActive: { borderColor: 'rgba(139,119,255,0.45)', backgroundColor: base.surfaceRaised },
  networkHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chainId: { marginTop: space.xs },
  networkNote: { marginTop: space.md },
  authNote: { marginBottom: space.sm },
  authHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  authBody: { marginTop: space.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  switchBody: { flex: 1 },
  switchCaption: { marginTop: space.xs },
  signOut: { marginTop: space.xl },
  signOutNote: { marginTop: space.md },
});
