import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { collateralValue, formatBtc, formatCollateralRatio, formatUsd, MAREN_POLICY } from '@maren/sdk';

import { Btc, Musd, Ratio, Usd } from '../../src/components/Money';
import { Card } from '../../src/components/Card';
import { HealthScale } from '../../src/components/HealthScale';
import { Icon } from '../../src/components/Icon';
import { PriceBanner } from '../../src/components/PriceBanner';
import { StatRow } from '../../src/components/Row';
import { Screen } from '../../src/components/Screen';
import { Label, Num, Txt } from '../../src/components/Text';
import {
  base,
  healthHeroColor,
  healthLabel,
  healthTone,
  hit,
  radius,
  space,
  toneColor,
} from '../../src/design/tokens';
import { usableTitle } from '../../src/lib/copy';
import { useBalances, useHealth, usePosition, usePrice } from '../../src/hooks/useChainData';
import { useAppStore } from '../../src/state/store';

/**
 * Home / Portfolio.
 *
 * Position health is the hero, per the brief. Everything above the fold answers one
 * question — how far can Bitcoin fall before this position is liquidated — and the CR,
 * the liquidation price and the drop-to-liquidation are all stated as numbers rather
 * than implied by a colour.
 *
 * When the price feed is not live, the health block is replaced by the price banner.
 * There is no "last known health" rendering, because a health figure computed from a
 * stale price is a stale figure wearing a current label.
 */
export default function Home() {
  const router = useRouter();
  const handle = useAppStore((s) => s.handle);
  const hidden = useAppStore((s) => s.amountsHidden);
  const toggleHidden = useAppStore((s) => s.toggleAmountsHidden);

  const price = usePrice();
  const { data: position } = usePosition();
  const { data: balances } = useBalances();
  const health = useHealth();

  const tone = health ? healthTone[health.status] ?? 'neutral' : 'neutral';
  /** Small semantic indicator — keeps the success green. */
  const pillColour = toneColor[tone];
  /** Hero numeral — neutral while healthy, per BRAND.md §2. */
  const heroColour = healthHeroColor[tone];

  const collateralUsd =
    position && price.state === 'live'
      ? collateralValue(position.collateralWei, price.priceWei)
      : null;

  return (
    <Screen wash bottomInset={space.xxl}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Label>Account</Label>
          <Txt variant="h3" style={styles.handle}>
            {handle ?? 'Maren'}
          </Txt>
        </View>

        <View style={styles.headerActions}>
          <IconButton
            name={hidden ? 'lock' : 'wallet'}
            label={hidden ? 'Show amounts' : 'Hide amounts'}
            onPress={toggleHidden}
          />
          <IconButton
            name="settings"
            label="Settings"
            onPress={() => router.push('/settings')}
          />
        </View>
      </View>

      {/* Hero: position health */}
      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <Label>Position health</Label>
          {health ? (
            <View style={[styles.statusPill, { borderColor: `${pillColour}55` }]}>
              <View style={[styles.statusDot, { backgroundColor: pillColour }]} />
              <Txt variant="small" style={{ color: pillColour }}>
                {healthLabel[health.status] ?? health.status}
              </Txt>
            </View>
          ) : null}
        </View>

        {health && position ? (
          <>
            <View
              style={styles.crRow}
              accessible
              accessibilityLabel={`Collateral ratio ${formatCollateralRatio(health.collateralRatio)}. Status: ${healthLabel[health.status]}.`}
            >
              <Ratio cr={health.collateralRatio} size="numericXl" color={heroColour} />
              <Txt variant="small" tone="subtle" style={styles.crCaption}>
                collateral ratio
              </Txt>
            </View>

            <HealthScale collateralRatio={health.collateralRatio} tone={tone} />

            <View style={styles.heroStats}>
              <HeroStat
                label="Liquidation price"
                value={formatUsd(health.liquidationPrice)}
                caption="protocol liquidates at 110%"
              />
              {/*
                Split into a numeral plus prose. `formatPriceDrop` returns the whole
                sentence ("57% below today's price"), which set in 16px mono wrapped
                across two lines and collided with the caption.
              */}
              <HeroStat
                label="Room to fall"
                value={`${Math.floor(health.priceDropToLiquidationBps / 100)}%`}
                caption={
                  health.priceDropToLiquidationBps <= 0
                    ? 'at or below liquidation'
                    : `below today’s price · ${usableTitle(health.priceDropToLiquidationBps)}`
                }
                align="right"
              />
            </View>

            {!health.canBorrow ? (
              <View style={styles.blockedNote} accessibilityRole="alert">
                <Icon name="alert" size={16} color={toneColor.warning} />
                <Txt variant="small" tone="muted" style={styles.blockedText}>
                  Below {formatCollateralRatio(MAREN_POLICY.minHealthyCr)} Maren does not
                  let you borrow more. Repay or add collateral to reopen borrowing.
                </Txt>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.priceState}>
            <PriceBanner feed={price} />
          </View>
        )}
      </Card>

      {/* Price ticker, when live */}
      {price.state === 'live' ? (
        <View style={styles.ticker}>
          <PriceBanner feed={price} />
        </View>
      ) : null}

      {/* Balances */}
      <Label style={styles.sectionLabel}>Balances</Label>
      <Card padded={false} style={styles.balances}>
        <View style={styles.balanceBlock}>
          <StatRow
            label="Bitcoin collateral"
            accessibilityLabel={`Bitcoin collateral ${position ? formatBtc(position.collateralWei) : 'unknown'}`}
            value={position ? <Btc wei={position.collateralWei} size="numericMd" hidden={hidden} /> : <Dash />}
            sub={collateralUsd !== null ? <Usd wei={collateralUsd} hidden={hidden} /> : null}
          />
          <StatRow
            label="MUSD balance"
            value={balances ? <Musd wei={balances.musdWei} size="numericMd" hidden={hidden} /> : <Dash />}
            sub={
              <Txt variant="small" tone="subtle">
                spendable
              </Txt>
            }
          />
          <StatRow
            label="Outstanding debt"
            hint="principal + interest + 200 MUSD gas compensation"
            value={position ? <Musd wei={position.debtWei} plain hidden={hidden} /> : <Dash />}
            last
          />
        </View>
      </Card>

      {/* Quick actions */}
      <View style={styles.actions}>
        <QuickAction icon="send" label="Send" onPress={() => router.push('/(tabs)/pay')} />
        <QuickAction icon="scan" label="Scan" onPress={() => router.push('/scan')} />
        <QuickAction icon="plus" label="Borrow" onPress={() => router.push('/(tabs)/vault')} />
        <QuickAction icon="earn" label="Earn" onPress={() => router.push('/(tabs)/earn')} />
      </View>

      {/* The gas story, stated once on the home screen. */}
      <Card tone="inset" style={styles.gasNote}>
        <View style={styles.gasHead}>
          <Icon name="shield" size={16} color={toneColor.success} />
          <Txt variant="small" style={{ color: toneColor.success }}>
            You hold no Bitcoin for gas
          </Txt>
        </View>
        <Txt variant="small" tone="subtle" style={styles.gasBody}>
          Mezo charges gas in BTC. Maren’s relayer pays it for every payment and Earn
          action, so your BTC stays collateral. Vault operations go through Mezo’s own
          signed borrower contract and are not sponsored — the Vault screen says so before
          you sign.
        </Txt>
      </Card>
    </Screen>
  );
}

function Dash() {
  return (
    <Num size="numericLg" tone="subtle">
      —
    </Num>
  );
}

function HeroStat({
  label,
  value,
  caption,
  align = 'left',
}: {
  label: string;
  value: string;
  caption: string;
  align?: 'left' | 'right';
}) {
  return (
    <View
      style={[styles.heroStat, align === 'right' && styles.heroStatRight]}
      accessible
      accessibilityLabel={`${label}: ${value}. ${caption}.`}
    >
      <Label>{label}</Label>
      <Num size="numeric" style={styles.heroStatValue}>
        {value}
      </Num>
      <Txt variant="small" tone="subtle" style={styles.heroStatCaption}>
        {caption}
      </Txt>
    </View>
  );
}

function IconButton({
  name,
  label,
  onPress,
}: {
  name: 'settings' | 'wallet' | 'lock';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Icon name={name} size={18} color="#A1A1AA" />
    </Pressable>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: 'send' | 'scan' | 'plus' | 'earn';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
    >
      <View style={styles.quickIcon}>
        <Icon name={icon} size={19} color="#FAFAFA" />
      </View>
      <Txt variant="small" tone="muted">
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: space.xl,
  },
  handle: { marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: space.sm },
  iconButton: {
    width: hit.min,
    height: hit.min,
    borderRadius: radius.pill,
    backgroundColor: base.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { marginBottom: space.lg },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusDot: { width: 6, height: 6, borderRadius: radius.pill },
  crRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: space.lg },
  crCaption: { marginLeft: 2 },
  heroStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.xl,
    gap: space.lg,
  },
  heroStat: { flex: 1 },
  heroStatRight: { alignItems: 'flex-end' },
  heroStatValue: { marginTop: space.sm },
  heroStatCaption: { marginTop: 2 },
  blockedNote: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.lg,
    paddingTop: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: base.border,
  },
  blockedText: { flex: 1 },
  priceState: { marginTop: space.lg },
  ticker: { marginBottom: space.xl, paddingHorizontal: space.xs },
  sectionLabel: { marginBottom: space.md },
  balances: { paddingHorizontal: space.xl, marginBottom: space.xl },
  balanceBlock: { paddingVertical: space.xs },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.xl,
  },
  quickAction: { flex: 1, alignItems: 'center', gap: space.sm },
  quickIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: base.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gasNote: { marginBottom: space.xl },
  gasHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  gasBody: { marginTop: space.sm },
  pressed: { opacity: 0.6 },
});
