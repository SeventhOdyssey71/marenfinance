import { StyleSheet, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router';

import { Icon, type IconName } from '../../src/components/Icon';
import { base, brand, text } from '../../src/design/tokens';
import { fonts } from '../../src/design/type';

/**
 * The five surfaces. ARCHITECTURE.md §2 names four (Vault, Pay, Earn, Portfolio);
 * Activity is split out from Portfolio because a transaction history that lives inside
 * a scroll view is a history nobody reads.
 *
 * The bar is a hairline-topped white strip — no blur, no translucency. Violet marks the
 * active tab and is the only saturated colour on the chrome (§2).
 *
 * The inactive tint is `text-muted`, not `text-subtle`. A tab label is 11px text, so
 * 4.5:1 is the bar; #82828C on the white strip is 3.80:1 and does not clear it.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.bar,
        tabBarActiveTintColor: brand.violet500,
        tabBarInactiveTintColor: text.muted,
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
        sceneStyle: { backgroundColor: base.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: icon('wallet'),
          tabBarAccessibilityLabel: 'Home and portfolio',
        }}
      />
      <Tabs.Screen
        name="vault"
        options={{
          title: 'Vault',
          tabBarIcon: icon('vault'),
          tabBarAccessibilityLabel: 'Vault: deposit, borrow, repay, withdraw',
        }}
      />
      <Tabs.Screen
        name="pay"
        options={{
          title: 'Pay',
          tabBarIcon: icon('send'),
          tabBarAccessibilityLabel: 'Pay: send and request MUSD',
        }}
      />
      <Tabs.Screen
        name="earn"
        options={{
          title: 'Earn',
          tabBarIcon: icon('earn'),
          tabBarAccessibilityLabel: 'Earn on idle MUSD',
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: icon('activity'),
          tabBarAccessibilityLabel: 'Transaction history',
        }}
      />
    </Tabs>
  );
}

function icon(name: IconName) {
  // React Navigation types `color` as ColorValue (which admits an opaque platform
  // colour). Everything we pass in is a plain hex string from the design tokens, so
  // narrowing here is safe and keeps Icon's own prop honest.
  function TabBarIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} size={22} color={String(color)} />;
  }
  // Named rather than an arrow, so a tab shows as <TabBarIcon> in the inspector
  // instead of <Unknown> — and so react/display-name is satisfied honestly.
  TabBarIcon.displayName = `TabBarIcon(${name})`;
  return TabBarIcon;
}

const styles = StyleSheet.create({
  bar: {
    // White, not the page colour: the bar has to separate from the content scrolling
    // under it, and #F7F6FB on #F7F6FB is one hairline holding the whole boundary.
    backgroundColor: base.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: base.border,
    height: 88,
    paddingTop: 8,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: 0.2,
    marginTop: 2,
  },
  // 44pt minimum touch target across the full bar height.
  item: { paddingVertical: 4, minHeight: 44 },
});
