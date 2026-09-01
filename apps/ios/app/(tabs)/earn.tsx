import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatMusd } from '@maren/sdk';

import { Amount, Musd } from '../../src/components/Money';
import { Card } from '../../src/components/Card';
import { DemoNotice, ReadFailure } from '../../src/components/DataNotice';
import { Icon } from '../../src/components/Icon';
import { PillButton } from '../../src/components/PillButton';
import { StatRow } from '../../src/components/Row';
import { Screen } from '../../src/components/Screen';
import { SegmentedControl } from '../../src/components/SegmentedControl';
import { SuccessCover } from '../../src/components/SuccessCover';
import { Label, Num, Txt } from '../../src/components/Text';
import { TxSheet, useTxRunner } from '../../src/components/TxSheet';
import { base, radius, semanticText, space, text } from '../../src/design/tokens';
import { timeAgo } from '../../src/lib/copy';
import { useBalances, useEarn } from '../../src/hooks/useChainData';
import { useAppStore } from '../../src/state/store';

const WAD = 10n ** 18n;

type Mode = 'deposit' | 'withdraw';

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
 *
 * ── Gas honesty ────────────────────────────────────────────────────────────────
 *
 * Earn does NOT ride the relayer. `MarenEarn` is absent from the relay hub's allowlist
 * (`Deploy.s.sol:_allowlistRelayableCalls`), so `submitLive` in chain/actions.ts routes
 * both `earn-deposit` and `earn-withdraw` DIRECT from the user's wallet — the user pays
 * the BTC gas. `sponsorship.ts` still marks Earn sponsored for the relay-request shape it
 * shares with Pay, but the actual on-chain routing is what a user's wallet feels, so the
 * copy on this screen is derived from the routing and says plainly that you pay gas here.
 * It must never be the borrowed "gasless" line, which would promise something the chain
 * will not honour.
 */
export default function Earn() {
  const { data: earn, error: earnError, refetch: refetchEarn } = useEarn();
  const { data: balances } = useBalances();
  const demo = useAppStore((s) => s.dataSource === 'mock');

  const [mode, setMode] = useState<Mode>('deposit');
  const [selected, setSelected] = useState<bigint>(100n * WAD);
  // Reset the amount to a sensible default when the tab flips, using the adjust-during-
  // render pattern the Vault and Pay screens use rather than an effect that paints the
  // stale figure for one frame.
  const [seenMode, setSeenMode] = useState<Mode>(mode);
  if (seenMode !== mode) {
    setSeenMode(mode);
    setSelected(100n * WAD);
  }

  // The just-delivered supply amount, held only to feed the celebration cover. Set from
  // `onDelivered`, which fires exclusively on a 'delivered' R15 outcome, so the cover can
  // never appear without a receipt behind it.
  const [celebrated, setCelebrated] = useState<bigint | null>(null);
  const lastRun = useRef<{ mode: Mode; wei: bigint } | null>(null);

  const runner = useTxRunner(() => {
    const done = lastRun.current;
    if (done?.mode === 'deposit') setCelebrated(done.wei);
  });

  const available = mode === 'deposit' ? (balances?.musdWei ?? null) : (earn?.assetsWei ?? null);
  const availableLabel = mode === 'deposit' ? 'Spendable MUSD' : 'In Earn';

  const presets: { label: string; wei: bigint }[] =
    mode === 'deposit'
      ? [
          { label: '100 MUSD', wei: 100n * WAD },
          { label: '500 MUSD', wei: 500n * WAD },
          { label: 'All spendable', wei: balances?.musdWei ?? 0n },
        ]
      : [
          { label: '100 MUSD', wei: 100n * WAD },
          { label: '500 MUSD', wei: 500n * WAD },
          { label: 'All in Earn', wei: earn?.assetsWei ?? 0n },
        ];

  const overMax = available !== null && selected > available;
  const canSubmit = available !== null && selected > 0n && !overMax;

  const submit = () => {
    lastRun.current = { mode, wei: selected };
    void runner.run(
      mode === 'deposit'
        ? { type: 'earn-deposit', musdWei: selected }
        : { type: 'earn-withdraw', musdWei: selected },
      `${mode === 'deposit' ? 'Deposit' : 'Withdraw'} ${formatMusd(selected)}`,
    );
  };

  return (
    <Screen bottomInset={space.xxl}>
      <View style={styles.header}>
        <Label>Earn</Label>
        <Txt variant="h2" style={styles.title}>
          Idle MUSD
        </Txt>
      </View>

      {demo ? <DemoNotice /> : null}

      {earnError ? (
        <View style={styles.readError}>
          <ReadFailure
            what="your Earn position"
            detail={earnError instanceof Error ? earnError.message : String(earnError)}
            onRetry={() => {
              void refetchEarn();
            }}
          />
        </View>
      ) : null}

      {/* Position */}
      <Card style={styles.hero}>
        <Label>Your balance in Earn</Label>
        <View style={styles.heroValue}>
          {earn ? (
            <Musd wei={earn.assetsWei} size="numericXl" />
          ) : (
            <Num size="numericXl" tone="muted">
              —
            </Num>
          )}
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
            <Icon name="clock" size={12} color={text.muted} />
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
            This is MUSD actually realised in the past, not a rate and not a forecast. Maren does
            not display an APY for Earn because there is no reliable one to display.
          </Txt>
          <Txt variant="small" tone="muted" style={styles.disclosureBody}>
            The MUSD Stability Pool has no token emissions. Its entire yield is the Bitcoin seized
            in liquidations, sold and compounded back into MUSD. Whether that happens at all depends
            on whether anyone gets liquidated, so returns arrive in lumps and can be zero for
            months.
          </Txt>
        </View>

        {earn ? (
          <View style={styles.eventsBlock}>
            <StatRow
              label="Liquidation events in window"
              value={
                <Num
                  size="numericSm"
                  tone="muted"
                >{`${earn.trailing.liquidationEvents} events`}</Num>
              }
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
      <SegmentedControl<Mode>
        options={[
          { key: 'deposit', label: 'Deposit', accessibilityLabel: 'Deposit into Earn' },
          { key: 'withdraw', label: 'Withdraw', accessibilityLabel: 'Withdraw from Earn' },
        ]}
        value={mode}
        onChange={setMode}
        accessibilityLabel="Deposit into or withdraw from Earn"
        style={styles.segmented}
      />

      <Card style={styles.actionCard}>
        <Label>{mode === 'deposit' ? 'Move into Earn' : 'Move back to spendable'}</Label>
        <View style={styles.actionValue}>
          <Amount value={formatMusd(selected)} size="numericLg" unitTone="musd" align="left" />
        </View>

        <View style={styles.presets}>
          {presets.map((p) => {
            const active = p.wei === selected;
            return (
              <Pressable
                key={p.label}
                onPress={() => setSelected(p.wei)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={p.label}
                style={[styles.preset, active && styles.presetActive]}
              >
                <Txt variant="small" tone={active ? 'primary' : 'muted'}>
                  {p.label}
                </Txt>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.availableRow}>
          <Txt variant="small" tone="muted">
            {availableLabel}
          </Txt>
          <Num
            size="numericSm"
            tone={overMax ? 'inherit' : 'muted'}
            style={overMax ? { color: semanticText.danger } : undefined}
          >
            {available !== null ? formatMusd(available) : '—'}
          </Num>
        </View>

        {/*
          Gas honesty, derived from the routing rather than the sponsorship label. Earn
          self-submits, so the user pays BTC gas on both the deposit and the withdrawal.
          The one place in the app that costs gas after the first deposit says so here.
        */}
        <View style={styles.gasRow}>
          <Icon name="alert" size={14} color={semanticText.warning} />
          <Txt variant="small" tone="muted" style={styles.gasText}>
            You pay the BTC gas here. Earn settles from your own wallet rather than through
            Maren’s relayer, so a deposit or withdrawal costs a little Bitcoin gas.
          </Txt>
        </View>

        {overMax ? (
          <View style={styles.blocked} accessibilityRole="alert">
            <Txt variant="small" style={{ color: semanticText.warning }}>
              {mode === 'deposit'
                ? 'More than your spendable MUSD.'
                : 'More than your balance in Earn.'}
            </Txt>
          </View>
        ) : null}

        <PillButton
          label={mode === 'deposit' ? 'Deposit into Earn' : 'Withdraw from Earn'}
          onPress={submit}
          disabled={!canSubmit}
          badge={<Icon name="arrowRight" size={15} color={base.onAccent} />}
          accessibilityHint="Requires Face ID, then waits for an on-chain receipt."
          style={styles.cta}
        />
      </Card>

      {/* Risk, stated plainly. */}
      <Card tone="inset" style={styles.riskCard}>
        <Txt variant="small" tone="muted">
          Stability Pool deposits absorb liquidated debt. In exchange for the BTC gains you take on
          the risk that your MUSD is used to close somebody else’s position. Historically
          profitable, not guaranteed, and not principal-protected.
        </Txt>
      </Card>

      {/*
        One overlay at a time. On a delivered deposit the celebration replaces the sheet's
        receipt state, so the tx sheet is unmounted while the cover is up; a withdrawal
        keeps the standard sheet with its block and gas receipt.
      */}
      {celebrated === null ? <TxSheet runner={runner} /> : null}
      <SuccessCover
        visible={celebrated !== null}
        amountWei={celebrated ?? 0n}
        unit="musd"
        eyebrow="Delivered"
        headline="You’re now earning"
        subline="is now in the Stability Pool, working on your idle MUSD. Any return is realised Bitcoin from liquidations: lumpy, backward-looking, never a rate."
        doneLabel="Back to Earn"
        onDone={() => {
          setCelebrated(null);
          runner.dismiss();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: space.xl },
  title: { marginTop: space.xs },
  readError: { marginBottom: space.lg },
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
  segmented: { marginBottom: space.lg },
  actionCard: { marginBottom: space.lg },
  actionValue: { marginTop: space.md },
  presets: { flexDirection: 'row', gap: space.sm, marginTop: space.lg, flexWrap: 'wrap' },
  preset: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
  },
  presetActive: { backgroundColor: base.surfaceRaised, borderColor: base.borderStrong },
  availableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.lg,
  },
  gasRow: { flexDirection: 'row', gap: space.sm, marginTop: space.lg, alignItems: 'flex-start' },
  gasText: { flex: 1 },
  blocked: {
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.input,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(180,83,9,0.5)',
  },
  cta: { marginTop: space.xl },
  riskCard: { marginBottom: space.xl },
});
