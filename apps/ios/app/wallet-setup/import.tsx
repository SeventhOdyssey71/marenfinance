import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { shortAddress } from '@maren/sdk';
import type { Address } from 'viem';

import { BackHeader } from '../../src/components/BackHeader';
import { Card } from '../../src/components/Card';
import { Icon } from '../../src/components/Icon';
import { PillButton } from '../../src/components/PillButton';
import { Screen } from '../../src/components/Screen';
import { Label, Num, Txt } from '../../src/components/Text';
import { base, radius, semantic, space } from '../../src/design/tokens';
import { fonts } from '../../src/design/type';
import { MOCK_HANDLE } from '../../src/data/mock';
import { useAppStore } from '../../src/state/store';
import { deriveAddress, normalisePrivateKey, storeKey } from '../../src/wallet/keystore';

/**
 * Import an existing key.
 *
 * Validation is local and total: `normalisePrivateKey` requires exactly 64 hex
 * characters and returns null otherwise, so a truncated paste cannot be accepted and
 * then produce a wrong address that silently sends funds nowhere.
 *
 * The preview address is derived before anything is stored, so the user can check it
 * against what they expect before committing.
 */
export default function ImportWallet() {
  const router = useRouter();
  const setAccount = useAppStore((s) => s.setAccount);

  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalised = normalisePrivateKey(raw);
  const preview: Address | null = normalised ? deriveAddress(normalised) : null;
  const dirty = raw.trim().length > 0;

  const submit = async () => {
    if (!normalised || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const protection = await storeKey(normalised);
      setAccount({ address: preview, handle: MOCK_HANDLE, protection });
      setRaw('');
      router.replace('/(tabs)');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <BackHeader kicker="Import" title="Existing key" />

      <Txt variant="body" tone="muted" style={styles.intro}>
        Paste a 64-character secp256k1 private key. It is checked on this device and never
        transmitted.
      </Txt>

      <Card tone="inset" padded={false} style={styles.field}>
        <TextInput
          value={raw}
          onChangeText={setRaw}
          placeholder="0x…"
          placeholderTextColor="#6B6B75"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          multiline
          // Keeps the key out of the keyboard's learned-word store.
          textContentType="password"
          secureTextEntry={false}
          style={styles.input}
          accessibilityLabel="Private key"
          accessibilityHint="Paste your 64 character private key."
        />
      </Card>

      {dirty && !normalised ? (
        <View style={styles.invalid} accessibilityRole="alert">
          <Icon name="alert" size={16} color={semantic.danger} />
          <Txt variant="small" style={{ color: semantic.danger, flex: 1 }}>
            Not a valid key. Expected exactly 64 hexadecimal characters, with or without a 0x prefix
            — got {normaliseLength(raw)}.
          </Txt>
        </View>
      ) : null}

      {preview ? (
        <Card style={styles.previewCard}>
          <Label>Derives to</Label>
          <Num size="numericLg" style={styles.preview}>
            {shortAddress(preview, 8, 6)}
          </Num>
          <Txt variant="small" tone="subtle" style={styles.previewFull} selectable>
            {preview}
          </Txt>
          <Txt variant="small" tone="muted" style={styles.check}>
            Check this matches the address you expect before continuing.
          </Txt>
        </Card>
      ) : null}

      {error ? (
        <Txt variant="small" style={[styles.error, { color: semantic.danger }]}>
          {error}
        </Txt>
      ) : null}

      <PillButton
        label="Import and protect"
        onPress={submit}
        disabled={!normalised}
        loading={busy}
        badge={<Icon name="lock" size={15} color="#FAFAFA" />}
        accessibilityHint="Stores the key in the Keychain behind a biometric check."
        style={styles.submit}
      />
    </Screen>
  );
}

function normaliseLength(raw: string): string {
  const body = raw.trim().replace(/^0[xX]/, '');
  return `${body.length}`;
}

const styles = StyleSheet.create({
  intro: { marginBottom: space.xl },
  field: { padding: space.lg },
  input: {
    color: '#FAFAFA',
    fontFamily: fonts.mono,
    fontSize: 14,
    lineHeight: 22,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  invalid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(248,113,113,0.3)',
    backgroundColor: base.surfaceInset,
  },
  previewCard: { marginTop: space.lg },
  preview: { marginTop: space.md },
  previewFull: { marginTop: space.sm, fontSize: 12 },
  check: { marginTop: space.md },
  error: { marginTop: space.md },
  submit: { marginTop: space.xxl },
});
