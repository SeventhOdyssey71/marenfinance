import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { shortAddress } from '@maren/sdk';
import type { Address, Hex } from 'viem';

import { BackHeader } from '../../src/components/BackHeader';
import { Card } from '../../src/components/Card';
import { Icon } from '../../src/components/Icon';
import { PillButton } from '../../src/components/PillButton';
import { Screen } from '../../src/components/Screen';
import { Label, Num, Txt } from '../../src/components/Text';
import { base, radius, semantic, space } from '../../src/design/tokens';
import { MOCK_HANDLE } from '../../src/data/mock';
import { useAppStore } from '../../src/state/store';
import {
  createPrivateKey,
  deriveAddress,
  storeKey,
  type KeyProtection,
} from '../../src/wallet/keystore';

/**
 * Key generation.
 *
 * The key is generated with viem's `generatePrivateKey` (@noble/curves over
 * crypto.getRandomValues, shimmed in app/_layout.tsx) and the address is derived from
 * it locally. Both are real; neither is mocked.
 *
 * The key is held in component state only for as long as it takes to write it to the
 * Keychain, and the resulting protection mode is reported honestly on the next screen.
 */
export default function CreateWallet() {
  const router = useRouter();
  const setAccount = useAppStore((s) => s.setAccount);

  const [address, setAddress] = useState<Address | null>(null);
  const [protection, setProtection] = useState<KeyProtection | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const key: Hex = createPrivateKey();
      const derived = deriveAddress(key);
      // storeKey prompts for Face ID as it writes the biometry-gated Keychain item.
      const result = await storeKey(key);
      setAddress(derived);
      setProtection(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    generate();
  }, [generate]);

  const finish = () => {
    if (!address || !protection) return;
    setAccount({ address, handle: MOCK_HANDLE, protection });
    router.replace('/(tabs)');
  };

  const stored = protection?.mode === 'keychain-biometric';

  return (
    <Screen>
      <BackHeader kicker="Step 2 of 2" title="Key created" />

      {busy ? (
        <Card>
          <Txt variant="body" tone="muted">
            Generating a key and writing it to the Keychain…
          </Txt>
        </Card>
      ) : error ? (
        <Card>
          <Txt variant="body" style={{ color: semantic.danger }}>
            Key generation failed
          </Txt>
          <Txt variant="small" tone="muted" style={styles.body}>
            {error}
          </Txt>
          <PillButton label="Try again" onPress={generate} style={styles.retry} />
        </Card>
      ) : (
        <>
          <Card>
            <Label>Your Mezo address</Label>
            <Num size="numericLg" style={styles.address}>
              {address ? shortAddress(address, 8, 6) : '—'}
            </Num>
            <Txt variant="small" tone="muted" style={styles.full} selectable>
              {address}
            </Txt>
          </Card>

          {/*
            R13's discipline applied to a UI claim: describe the protection that was
            actually achieved, not the one we hoped for.
          */}
          <Card tone="inset" style={styles.protection}>
            <View style={styles.protectionHead}>
              <Icon
                name={stored ? 'lock' : 'alert'}
                size={18}
                color={stored ? semantic.success : semantic.warning}
              />
              <Txt variant="small" style={{ color: stored ? semantic.success : semantic.warning }}>
                {stored
                  ? `Stored in the Keychain, gated by ${protection?.mode === 'keychain-biometric' ? protection.label : 'biometrics'}`
                  : 'Held in memory for this session only'}
              </Txt>
            </View>
            <Txt variant="small" tone="muted" style={styles.body}>
              {stored
                ? 'The key is unreadable without a successful biometric check, which is required on every signature. It is marked this-device-only, so it is excluded from iCloud Keychain and from encrypted backups.'
                : protection?.mode === 'session-only'
                  ? `${protection.reason} Maren did not write an unprotected key to disk. Your account will not survive a restart — enrol biometrics and create the key again to persist it.`
                  : ''}
            </Txt>
          </Card>

          <View style={styles.warning}>
            <Txt variant="small" tone="muted">
              Maren holds no copy of this key. If you lose the device without an export,
              the funds it controls are gone. Not recoverable by us — gone.
            </Txt>
          </View>

          <PillButton
            label="Open my account"
            onPress={finish}
            badge={<Icon name="arrowRight" size={16} color="#FAFAFA" />}
            disabled={!address}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  address: { marginTop: space.md },
  full: { marginTop: space.sm, fontSize: 12 },
  protection: { marginTop: space.lg },
  protectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  body: { marginTop: space.sm },
  warning: {
    marginTop: space.lg,
    marginBottom: space.xxl,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    backgroundColor: base.surfaceInset,
  },
  retry: { marginTop: space.lg },
});
