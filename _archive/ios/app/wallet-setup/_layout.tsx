import { Stack } from 'expo-router';

import { base } from '../../src/design/tokens';

export default function WalletSetupLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: base.bg },
      }}
    />
  );
}
