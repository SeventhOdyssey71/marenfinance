import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { Screen } from '../../src/components/Screen';
import { SegmentedControl } from '../../src/components/SegmentedControl';
import { Label, Txt } from '../../src/components/Text';
import { EarnBody } from '../../src/screens/EarnScreen';
import { VaultBody } from '../../src/screens/VaultScreen';
import { space } from '../../src/design/tokens';

type Section = 'vault' | 'earn';

/**
 * Finance — Bitcoin credit and idle-MUSD earning, the two protocol surfaces on one screen.
 *
 * The old Vault and Earn tabs are gone; their bodies live here as two segments, lifted
 * whole (see src/screens/VaultScreen.tsx and EarnScreen.tsx). The segmented control is the
 * same component Activity and Earn already use, so the switch reads identically to the rest
 * of the app. Home's Borrow and Earn pills and the Balances panel deep-link straight to a
 * section (`?section=earn`, `?section=vault&action=deposit`); the vault action rides through
 * on the same params object, which VaultBody reads for its preselected mode.
 */
function asSection(value: string | undefined): Section | null {
  return value === 'vault' || value === 'earn' ? value : null;
}

export default function Finance() {
  const params = useLocalSearchParams<{ section?: string }>();
  const requested = asSection(params.section);

  const [section, setSection] = useState<Section>(requested ?? 'vault');
  // Honour a deep-linked section on arrival and whenever it changes, adjusted during render
  // against the previous value — the same shape Vault uses for its action param, so a tap on
  // Home's Earn pill lands on the Earn segment in one paint rather than flashing Vault first.
  const [seenSection, setSeenSection] = useState(params.section);
  if (seenSection !== params.section) {
    setSeenSection(params.section);
    if (requested) setSection(requested);
  }

  return (
    <Screen bottomInset={space.huge}>
      <View style={styles.header}>
        <Label>Finance</Label>
        <Txt variant="h2" style={styles.title}>
          {section === 'vault' ? 'Bitcoin credit' : 'Idle MUSD'}
        </Txt>
      </View>

      <SegmentedControl<Section>
        options={[
          { key: 'vault', label: 'Vault', accessibilityLabel: 'Vault: borrow MUSD against Bitcoin' },
          { key: 'earn', label: 'Earn', accessibilityLabel: 'Earn on idle MUSD' },
        ]}
        value={section}
        onChange={setSection}
        accessibilityLabel="Vault or Earn"
        style={styles.segmented}
      />

      {section === 'vault' ? <VaultBody /> : <EarnBody />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: space.xl },
  title: { marginTop: space.xs },
  segmented: { marginBottom: space.xl },
});
