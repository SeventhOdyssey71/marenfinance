import { Tabs } from 'expo-router';

import { PillTabBar } from '../../src/components/PillTabBar';
import { base } from '../../src/design/tokens';

/**
 * The four root surfaces — Home · Finance · Activity · Profile.
 *
 * ARCHITECTURE.md §2's original five tabs (Home, Vault, Pay, Earn, Activity) are folded
 * into four here, matching the reference wallet's shell: Vault and Earn become the two
 * segments of Finance, and Pay stops being a tab — its send/request/split/link flows are
 * pushed routes off Home now (see app/pay.tsx and the root Stack). What is left are the
 * four places you *look*, with the money *flows* pushed over them.
 *
 * The native strip is replaced by a floating pill bar (PillTabBar). Violet still marks the
 * active tab and is the only saturated colour on the chrome; the bar is a white capsule
 * with the card's own soft drop rather than a hairline-topped strip. Because it floats,
 * each screen pads its scroll content to clear it (bottomInset on the Screen).
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <PillTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: base.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="finance" options={{ title: 'Finance' }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
