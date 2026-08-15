import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatMusd, formatUsd } from '@maren/sdk';

import { Amount, Musd } from '../../src/components/Money';
import { Card } from '../../src/components/Card';
import { Icon } from '../../src/components/Icon';
import { PillButton } from '../../src/components/PillButton';
import { StatRow } from '../../src/components/Row';
import { Screen } from '../../src/components/Screen';
import { Label, Num, Txt } from '../../src/components/Text';
import { TxSheet, useTxRunner } from '../../src/components/TxSheet';
import { base, radius, semantic, space } from '../../src/design/tokens';
import { timeAgo } from '../../src/lib/copy';
import { useBalances, useEarn } from '../../src/hooks/useChainData';

/**
 * Earn — idle MUSD into the MUSD Stability Pool via MarenEarn (ERC-4626).
 *
 * The hard rule for this screen, from both ARCHITECTURE.md §3.5 and the brief: there is
 * NO APY here. The Stability Pool has no token emissions; its yield is liquidation gains
 * only, which are lumpy and unpredictable. So the headline number is realised MUSD over
 * an observed window, labelled backward-looking, with the event count shown so the
 * lumpiness is visible rather than smoothed into a rate.
 *
 * Deriving an annualised figure from three events in ninety days would be a lie with a
 * percent sign on it. The screen says so in as many words.
 */
export default function Earn() {
  const { data: earn } = useEarn();
  const { data: balances } = useBalances();
  const runner = useTxRunner();
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');

  const preset = 500n * 10n ** 18n;

  return (
    <Screen bottomInset={space.xxl}>
      <View style={styles.header}>
        <Label>Earn</Label>
        <Txt variant="h2" style={styles.title}>
          Idle MUSD
        </Txt>
      </View>

      {/* Position */}
      <Card style={styles.hero}>
        <Label>Your balance in Earn</Label>
        <View style={styles.heroValue}>
          {earn ? <Musd wei={earn.assetsWei} size="numericXl" /> : <Num size="numericXl" tone="muted">—</Num>}
        </View>

        {earn ? (
          <StatRow
            label="Deposited"
            value={<Musd wei={earn.depositedWei} plain size="numericSm" />}
            last
          />
        ) : null}
      </Card>

      {/* Trailing realised yield — explicitly backward-looking. */}
      <Card style={styles.yieldCard}>
        <View style={styles.yieldHead}>
          <Label>Realised over the last {earn?.trailing.windowDays ?? 90} days</Label>
          <View style={styles.backwardPill}>
            <Icon name="clock" size={12} color="#A1A1AA" />
            <Txt variant="small" tone="muted" style={styles.backwardText}>
              Backward-looking
            </Txt>
          </View>
        </View>

        <View style={styles.yieldValue}>
          {earn ? (
            <Amount
              value={formatMusd(earn.trailing.realisedWei)}
              size="numericXl"
              unitTone="musd"
              align="left"
            />
          ) : (
            <Num size="numericXl" tone="muted">
              —
            </Num>
          )}
        </View>

        {/*
          The disclosure that makes the number honest. Not a footnote, not a tooltip —
          it sits directly under the figure it qualifies.
        */}
        <View style={styles.disclosure}>
          <Txt variant="small" tone="muted">
            This is MUSD actually realised in the past, not a rate and not a forecast.
            Maren does not display an APY for Earn because there is no reliable one to
            display.
          </Txt>
          <Txt variant="small" tone="muted" style={styles.disclosureBody}>
            The MUSD Stability Pool has no token emissions. Its entire yield is the
            Bitcoin seized in liquidations, sold and compounded back into MUSD. Whether
            that happens at all depends on whether anyone gets liquidated, so returns
            arrive in lumps and can be zero for months.
          </Txt>
        </View>

        {earn ? (
          <View style={styles.eventsBlock}>
            <StatRow
              label="Liquidation events in window"
              value={<Num size="numericSm" tone="muted">{`${earn.trailing.liquidationEvents} events`}</Num>}
            />
            <StatRow
              label="Most recent gain"
              value={
                <Num size="numericSm" tone="muted">
                  {earn.trailing.lastGainAt ? timeAgo(earn.trailing.lastGainAt) : 'none yet'}
                </Num>
              }
              last
            />
          </View>
        ) : null}
      </Card>

      {/* Actions */}
      <View style={styles.segmented} accessibilityRole="tablist">
        {(['deposit', 'withdraw'] as const).map((m) => {
          const active = m === mode;
          return (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={m === 'deposit' ? 'Deposit into Earn' : 'Withdraw from Earn'}
              style={[styles.segment, active && styles.segmentActive]}
            >
              <Txt variant="small" tone={active ? 'primary' : 'muted'}>
                {m === 'deposit' ? 'Deposit' : 'Withdraw'}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <Card style={styles.actionCard}>
        <Label>{mode === 'deposit' ? 'Move into Earn' : 'Move back to spendable'}</Label>
        <View style={styles.actionValue}>
          <Amount value={formatMusd(preset)} size="numericLg" unitTone="musd" align="left" />
        </View>

        <View style={styles.availableRow}>
          <Txt variant="small" tone="muted">
            {mode === 'deposit' ? 'Spendable MUSD' : 'In Earn'}
          </Txt>
          <Num size="numericSm" tone="muted">
            {mode === 'deposit'
              ? formatMusd(balances?.musdWei ?? 0n)
              : formatMusd(earn?.assetsWei ?? 0n)}
          </Num>
        </View>

        <View style={styles.gasRow}>
          <Icon name="shield" size={14} color={semantic.success} />
          <Txt variant="small" tone="muted" style={styles.gasText}>
            Gasless. Maren’s relayer pays the BTC gas for Earn deposits and withdrawals.
          </Txt>
        </View>

        <PillButton
          label={mode === 'deposit' ? 'Deposit into Earn' : 'Withdraw from Earn'}
          onPress={() =>
            runner.run(
              mode === 'deposit'
                ? { type: 'earn-deposit', musdWei: preset }
                : { type: 'earn-withdraw', musdWei: preset },
              `${mode === 'deposit' ? 'Deposit' : 'Withdraw'} ${formatMusd(preset)}`,
            )
          }
          badge={<Icon name="arrowRight" size={15} color="#FAFAFA" />}
          accessibilityHint="Requires Face ID, then waits for an on-chain receipt."
          style={styles.cta}
        />
      </Card>

      {/* Risk, stated plainly. */}
      <Card tone="inset" style={styles.riskCard}>
        <Txt variant="small" tone="muted">
          Stability Pool deposits absorb liquidated debt. In exchange for the BTC gains
          you take on the risk that your MUSD is used to close somebody else’s position —
          historically profitable, not guaranteed, and not principal-protected.
        </Txt>
      </Card>

      <TxSheet runner={runner} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: space.xl },
  title: { marginTop: space.xs },
  hero: { marginBottom: space.lg },
  heroValue: { marginTop: space.md, marginBottom: space.md },
  yieldCard: { marginBottom: space.xl },
  yieldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    flexWrap: 'wrap',
  },
  backwardPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    backgroundColor: base.surfaceInset,
  },
  backwardText: { fontSize: 11 },
  yieldValue: { marginTop: space.lg },
  disclosure: { marginTop: space.lg },
  disclosureBody: { marginTop: space.sm },
  eventsBlock: {
    marginTop: space.lg,
    paddingTop: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: base.border,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: base.surfaceInset,
    borderRadius: radius.pill,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    marginBottom: space.lg,
  },
  segment: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  segmentActive: { backgroundColor: base.surfaceRaised },
  actionCard: { marginBottom: space.lg },
  actionValue: { marginTop: space.md },
  availableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.lg,
  },
  gasRow: { flexDirection: 'row', gap: space.sm, marginTop: space.lg, alignItems: 'flex-start' },
  gasText: { flex: 1 },
  cta: { marginTop: space.xl },
  riskCard: { marginBottom: space.xl },
});
