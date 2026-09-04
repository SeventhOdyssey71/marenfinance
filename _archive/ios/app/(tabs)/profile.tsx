import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { getChain, shortAddress } from '@maren/sdk';

import { Card } from '../../src/components/Card';
import { Icon } from '../../src/components/Icon';
import { PillButton } from '../../src/components/PillButton';
import { StatRow } from '../../src/components/Row';
import { Screen } from '../../src/components/Screen';
import { Label, Num, Txt } from '../../src/components/Text';
import { base, brand, radius, semanticText, space } from '../../src/design/tokens';
import { useAppStore } from '../../src/state/store';

/**
 * Profile — who you are on Maren, and the way into everything that configures the app.
 *
 * This is the fourth tab in the new shell. It is deliberately thin: it states your handle
 * and address, shows at a glance which network and data source the app is reading, and
 * hands off to the full Settings screen for the controls that already live there (network,
 * security, the developer switches, sign out). Nothing here reimplements those — the
 * "Open settings" pill pushes the existing /settings route, so there is one place a setting
 * is changed and one place it is read from.
 */
export default function Profile() {
  const router = useRouter();
  const handle = useAppStore((s) => s.handle);
  const address = useAppStore((s) => s.address);
  const network = useAppStore((s) => s.network);
  const dataSource = useAppStore((s) => s.dataSource);
  const hidden = useAppStore((s) => s.amountsHidden);
  const toggleHidden = useAppStore((s) => s.toggleAmountsHidden);

  const [copied, setCopied] = useState(false);
  const chain = getChain(network);

  const copyAddress = async () => {
    await Clipboard.setStringAsync(address ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1_800);
  };

  return (
    <Screen wash bottomInset={space.huge}>
      <View style={styles.header}>
        <Label>Account</Label>
        <Txt variant="h2" style={styles.title}>
          {handle ?? 'Maren'}
        </Txt>
      </View>

      {/* Identity */}
      <Card style={styles.identity}>
        <View style={styles.avatar}>
          <Icon name="person" size={26} color={brand.violet600} />
        </View>
        <View style={styles.identityBody}>
          <Txt variant="h3" numberOfLines={1}>
            {handle ?? 'No handle yet'}
          </Txt>
          <Num size="numericSm" tone="muted" style={styles.identityAddress}>
            {address ? shortAddress(address, 8, 6) : 'No wallet'}
          </Num>
        </View>
        {address ? (
          <PillButton
            label={copied ? 'Copied' : 'Copy'}
            variant="secondary"
            block={false}
            onPress={copyAddress}
            accessibilityHint="Copies your full Mezo address to the clipboard."
          />
        ) : null}
      </Card>

      {/* Account and data source, at a glance */}
      <Label style={styles.sectionLabel}>This session</Label>
      <Card padded={false} style={styles.section}>
        <View style={styles.sectionInner}>
          <StatRow
            label="Network"
            value={
              <Txt variant="small">{network === 'mainnet' ? 'Mezo Mainnet' : 'Mezo Matsnet'}</Txt>
            }
          />
          <StatRow
            label="Reading from"
            hint={
              dataSource === 'live'
                ? `${chain.name}, chain ${chain.id}`
                : 'nothing, the figures are invented'
            }
            value={
              <Txt
                variant="small"
                style={{
                  color: dataSource === 'live' ? semanticText.success : semanticText.warning,
                }}
              >
                {dataSource === 'live' ? 'Live chain' : 'Demo data'}
              </Txt>
            }
          />
          <StatRow
            label="Amounts"
            hint="hide balances behind a dot while you are in public"
            value={
              <Txt variant="small" tone="muted">
                {hidden ? 'Hidden' : 'Shown'}
              </Txt>
            }
            onPress={toggleHidden}
            accessibilityLabel={
              hidden ? 'Amounts are hidden. Tap to show.' : 'Amounts are shown. Tap to hide.'
            }
            accessibilityHint="Toggles whether balances are visible."
            last
          />
        </View>
      </Card>

      {/* The full settings screen. */}
      <PillButton
        label="Open settings"
        badge={<Icon name="settings" size={16} color={base.onAccent} />}
        onPress={() => router.push('/settings')}
        accessibilityHint="Opens network, security, developer options and sign out."
        style={styles.settingsButton}
      />

      <Txt variant="small" tone="muted" style={styles.footNote}>
        Network, security, the developer switches and sign out all live in Settings. Maren holds no
        copy of your key, so it is the one place your account can be changed.
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: space.xl },
  title: { marginTop: 2 },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    marginBottom: space.xl,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: brand.violet900,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityBody: { flex: 1, gap: 3 },
  identityAddress: { marginTop: 2 },
  sectionLabel: { marginBottom: space.md },
  section: { marginBottom: space.xl },
  sectionInner: { paddingHorizontal: space.xl, paddingVertical: space.xs },
  settingsButton: { marginTop: space.xs },
  footNote: { marginTop: space.md },
});
