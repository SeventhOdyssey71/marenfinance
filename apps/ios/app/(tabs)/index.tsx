import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  collateralValue,
  formatBtc,
  formatCollateralRatio,
  formatUsd,
  MAREN_POLICY,
} from '@maren/sdk';

import { Btc, Musd, Ratio, Usd } from '../../src/components/Money';
import { Card } from '../../src/components/Card';
import { DemoNotice, ReadFailure } from '../../src/components/DataNotice';
import { HealthScale } from '../../src/components/HealthScale';
import { Icon, type IconName } from '../../src/components/Icon';
import { PriceBanner } from '../../src/components/PriceBanner';
import { StatRow } from '../../src/components/Row';
import { Screen } from '../../src/components/Screen';
import { Sparkline } from '../../src/components/Sparkline';
import { Label, Num, Txt } from '../../src/components/Text';
import { TraceOutline } from '../../src/components/TraceOutline';
import {
  base,
  brand,
  cardShadow,
  healthHeroColor,
  healthLabel,
  healthTone,
  hit,
  radius,
  space,
  text,
  toneColor,
} from '../../src/design/tokens';
import { usableTitle } from '../../src/lib/copy';
import {
  useBalances,
  useHealth,
  usePosition,
  usePrice,
  usePrimaryHandle,
} from '../../src/hooks/useChainData';
import { useSessionPriceSeries } from '../../src/hooks/usePriceSamples';
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

  const demo = useAppStore((s) => s.dataSource === 'mock');

  const price = usePrice();
  // This session's live oracle observations, folded in as they poll — the only honest
  // series behind the sparkline. No indexer, no history, nothing back-filled.
  const priceSeries = useSessionPriceSeries(price);
  const { data: position, error: positionError, refetch: refetchPosition } = usePosition();
  const { data: balances, error: balancesError } = useBalances();
  const health = useHealth();

  // Resolved from MarenRegistry and mirrored into the store, so the header shows this
  // account's own handle or no handle at all, never a placeholder standing in for one.
  usePrimaryHandle();

  /**
   * One notice for the pair, because they fail together.
   *
   * Position and balances are read through the same client in the same batch, so an RPC
   * outage takes both. Two identical warnings stacked on one screen is noise that trains
   * people to scroll past the thing we most need them to read.
   */
  const readError = positionError ?? balancesError;

  const tone = health ? (healthTone[health.status] ?? 'neutral') : 'neutral';
  /** Small semantic indicator — keeps the success green. */
  const pillColour = toneColor[tone];
  /** Hero numeral — neutral while healthy, per BRAND.md §2. */
  const heroColour = healthHeroColor[tone];

  const collateralUsd =
    position && price.state === 'live'
      ? collateralValue(position.collateralWei, price.priceWei)
      : null;

  return (
    <Screen wash bottomInset={space.huge}>
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
          <IconButton name="settings" label="Settings" onPress={() => router.push('/settings')} />
        </View>
      </View>

      {demo ? <DemoNotice /> : null}

      {/*
        The read failure sits ABOVE the hero, not inside it.

        The hero already has a state for "no live price", and stacking a second failure
        inside it would make two different problems look like one. This is the other
        failure: the chain did not answer at all, so there is no position to have an
        opinion about. The balances below render their dash placeholder rather than
        zeroes, and this banner is what says why.
      */}
      {readError ? (
        <View style={styles.readError}>
          <ReadFailure
            what="your position"
            detail={readError instanceof Error ? readError.message : String(readError)}
            onRetry={() => {
              void refetchPosition();
            }}
          />
        </View>
      ) : null}

      {/* Hero: position health */}
      <Card style={styles.hero}>
        {/*
          The one trace-outline accent in the app, on the one card the whole screen is
          built around. Kept quiet — a low-alpha violet dash, slowly marching — so it reads
          as a highlight rather than a warning. Under reduce-motion it renders static.
        */}
        <TraceOutline color="rgba(91,61,245,0.35)" cornerRadius={13} inset={5} animated />
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
              <Txt variant="small" tone="muted" style={styles.crCaption}>
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
                  Below {formatCollateralRatio(MAREN_POLICY.minHealthyCr)} Maren does not let you
                  borrow more. Repay or add collateral to reopen borrowing.
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
          {/*
            The sparkline traces THIS SESSION's live observations only — the samples the
            15s poll has actually seen since the app opened — so it is labelled as such and
            never dressed up as price history. It appears once there are at least two real
            points to join; before that there is no honest line to draw.
          */}
          {priceSeries.length >= 2 ? (
            <View style={styles.tickerTrend}>
              <Sparkline data={priceSeries} color={text.muted} width={72} height={22} />
              <Label style={styles.tickerTrendLabel}>This session</Label>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Balances */}
      <Label style={styles.sectionLabel}>Balances</Label>
      <Card padded={false} style={styles.balances}>
        <View style={styles.balanceBlock}>
          <StatRow
            label="Bitcoin collateral"
            accessibilityLabel={`Bitcoin collateral ${position ? formatBtc(position.collateralWei) : 'unknown'}`}
            value={
              position ? (
                <Btc wei={position.collateralWei} size="numericMd" hidden={hidden} dimFraction />
              ) : (
                <Dash />
              )
            }
            sub={collateralUsd !== null ? <Usd wei={collateralUsd} hidden={hidden} /> : null}
          />
          <StatRow
            label="MUSD balance"
            value={
              balances ? (
                <Musd wei={balances.musdWei} size="numericMd" hidden={hidden} dimFraction />
              ) : (
                <Dash />
              )
            }
            sub={
              <Txt variant="small" tone="muted">
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

      {/*
        Quick actions as one grouped floating pill — a surfaceInset track carrying four
        icon+label segments, per the reference toolbar. It sits in the page flow rather
        than pinned, so it can never ride over the tab bar, and each segment clears the
        44pt target. Routing is unchanged; this is dressing only.
      */}
      <View style={styles.actionBar}>
        <QuickAction icon="send" label="Send" onPress={() => router.push('/pay')} />
        <QuickAction
          icon="arrowDown"
          label="Receive"
          onPress={() => router.push('/pay?tab=request')}
        />
        <QuickAction
          icon="plus"
          label="Borrow"
          onPress={() => router.push('/(tabs)/finance?section=vault')}
        />
        <QuickAction
          icon="earn"
          label="Earn"
          onPress={() => router.push('/(tabs)/finance?section=earn')}
        />
      </View>

      {/*
        The gas story, stated once on the home screen.

        The heading used to read "You hold no Bitcoin for gas", and the body used to say
        vault operations were unsponsored. Both were wrong, in opposite directions: every
        vault operation except the deposit IS relayed, and the deposit is payable, so a
        user does need BTC — once — to open the position. The claim is now the true one.
      */}
      <Card tone="inset" style={styles.gasNote}>
        <View style={styles.gasHead}>
          <Icon name="shield" size={16} color={brand.violet400} />
          <Txt variant="small">No gas after your first deposit</Txt>
        </View>
        <Txt variant="small" tone="muted" style={styles.gasBody}>
          Mezo charges gas in BTC. Depositing sends Bitcoin, so a relayer cannot carry it for you
          and you pay gas on that one transaction. Borrow, repay, withdraw and every payment are
          then signed by you, submitted by Maren’s relayer, and cost you nothing. Earn is the
          exception: its deposits and withdrawals settle from your own wallet, so you pay gas there
          too.
        </Txt>
      </Card>
    </Screen>
  );
}

function Dash() {
  return (
    <Num size="numericLg" tone="muted">
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
      <Txt variant="small" tone="muted" style={styles.heroStatCaption}>
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
      <Icon name={name} size={18} color={text.muted} />
    </Pressable>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: Extract<IconName, 'send' | 'arrowDown' | 'plus' | 'earn'>;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      // The pressed segment lifts to a white raised chip inside the inset track — the same
      // affordance the segmented control uses, so a tap reads as "this one" the moment it
      // lands rather than only as a dim.
      style={({ pressed }) => [styles.actionSeg, pressed && styles.actionSegPressed]}
    >
      <Icon name={icon} size={20} color={text.primary} />
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
  /** A white chip with the card's own drop, so the chrome and the cards agree. */
  iconButton: {
    width: hit.min,
    height: hit.min,
    borderRadius: radius.pill,
    backgroundColor: base.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...cardShadow,
  },
  readError: { marginBottom: space.lg },
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
  ticker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.xl,
    paddingHorizontal: space.xs,
  },
  tickerTrend: { alignItems: 'flex-end', gap: 2 },
  tickerTrendLabel: { fontSize: 10, letterSpacing: 0.5 },
  sectionLabel: { marginBottom: space.md },
  balances: { paddingHorizontal: space.xl, marginBottom: space.xl },
  balanceBlock: { paddingVertical: space.xs },
  /** The grouped floating pill: an inset track with the card's own soft drop. */
  actionBar: {
    flexDirection: 'row',
    backgroundColor: base.surfaceInset,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    padding: 6,
    marginBottom: space.xl,
    ...cardShadow,
  },
  actionSeg: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  actionSegPressed: { backgroundColor: base.surfaceRaised },
  gasNote: { marginBottom: space.xl },
  gasHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  gasBody: { marginTop: space.sm },
  pressed: { opacity: 0.6 },
});
