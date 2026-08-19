import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  BORROWING_RATE,
  MAREN_POLICY,
  assessHealth,
  collateralRatio,
  formatBtc,
  formatMusd,
  formatUsd,
  liquidationPrice,
  maxNetDebtAt,
  totalDebtFor,
} from '@maren/sdk';

import { Amount, Btc, Musd, Ratio } from '../../src/components/Money';
import { Card } from '../../src/components/Card';
import { DemoNotice, ReadFailure } from '../../src/components/DataNotice';
import { Icon } from '../../src/components/Icon';
import { PillButton } from '../../src/components/PillButton';
import { PriceBanner } from '../../src/components/PriceBanner';
import { StatRow } from '../../src/components/Row';
import { Screen } from '../../src/components/Screen';
import { Slider } from '../../src/components/Slider';
import { Label, Num, Txt } from '../../src/components/Text';
import { TxSheet, useTxRunner } from '../../src/components/TxSheet';
import {
  base,
  brand,
  healthLabel,
  healthTone,
  radius,
  semanticText,
  space,
  toneColor,
} from '../../src/design/tokens';
import { isSponsoredKind } from '../../src/chain/sponsorship';
import { priceGate } from '../../src/chain/price';
import { gasCopy } from '../../src/lib/copy';
import { useBalances, usePosition, usePrice } from '../../src/hooks/useChainData';
import { useAppStore } from '../../src/state/store';

type Mode = 'deposit' | 'borrow' | 'repay' | 'withdraw';

const MODES: { key: Mode; label: string }[] = [
  { key: 'deposit', label: 'Deposit' },
  { key: 'borrow', label: 'Borrow' },
  { key: 'repay', label: 'Repay' },
  { key: 'withdraw', label: 'Withdraw' },
];

/**
 * Vault — deposit BTC, borrow MUSD, repay, withdraw.
 *
 * The borrow slider is the centre of this screen. It is bounded by the exact MUSD amount
 * that lands the position on Maren's 180% floor, computed by the SDK's `maxNetDebtAt`,
 * so the control cannot be dragged into a state we would refuse. That is a deliberate
 * choice over validating on submit: a slider that goes somewhere and then throws an
 * error has already told the user they can do something they cannot.
 *
 * Every figure in the live preview — resulting CR, liquidation price, total debt — comes
 * from @maren/sdk. There is no arithmetic in this file that touches a user's risk.
 */
export default function Vault() {
  const [mode, setMode] = useState<Mode>('borrow');
  const price = usePrice();
  const { data: position, error: positionError, refetch: refetchPosition } = usePosition();
  const { data: balances } = useBalances();
  const runner = useTxRunner();
  const demo = useAppStore((s) => s.dataSource === 'mock');

  const gate = priceGate(price);
  const livePrice = price.state === 'live' ? price.priceWei : null;

  return (
    <Screen bottomInset={space.xxl}>
      <View style={styles.header}>
        <Label>Vault</Label>
        <Txt variant="h2" style={styles.title}>
          Bitcoin credit
        </Txt>
      </View>

      {demo ? <DemoNotice /> : null}

      {/*
        A read failure and a stale price are different problems and get different
        notices. This one means the chain did not answer, so there is no position to
        compute against; the price banner below means the oracle answered too long ago
        for the protocol to accept its number.
      */}
      {positionError ? (
        <View style={styles.banner}>
          <ReadFailure
            what="your position"
            detail={positionError instanceof Error ? positionError.message : String(positionError)}
            onRetry={() => {
              void refetchPosition();
            }}
          />
        </View>
      ) : null}

      {/* The price gate is stated once, at the top, and disables everything below it. */}
      {price.state !== 'live' ? (
        <View style={styles.banner}>
          <PriceBanner feed={price} />
        </View>
      ) : null}

      {/* Current position summary */}
      <Card style={styles.summary}>
        <StatRow
          label="Collateral"
          value={position ? <Btc wei={position.collateralWei} /> : <Num tone="muted">—</Num>}
          sub={
            position && livePrice ? (
              <Txt variant="numericSm" tone="muted">
                {formatUsd((position.collateralWei * livePrice) / 10n ** 18n)}
              </Txt>
            ) : null
          }
        />
        <StatRow
          label="Total debt"
          hint="includes the 200 MUSD gas compensation"
          value={position ? <Musd wei={position.debtWei} plain /> : <Num tone="muted">—</Num>}
        />
        <StatRow
          label="Borrow limit"
          hint="Mezo caps this at the price when the trove opened"
          value={
            position ? (
              <Musd wei={position.maxBorrowingCapacityWei} plain />
            ) : (
              <Num tone="muted">—</Num>
            )
          }
          last
        />
      </Card>

      {/* Mode switch */}
      <View style={styles.segmented} accessibilityRole="tablist">
        {MODES.map((m) => {
          const active = m.key === mode;
          return (
            <Pressable
              key={m.key}
              onPress={() => setMode(m.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={m.label}
              style={[styles.segment, active && styles.segmentActive]}
            >
              <Txt variant="small" tone={active ? 'primary' : 'muted'}>
                {m.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      {mode === 'borrow' ? (
        <BorrowPanel
          position={position}
          price={livePrice}
          gateReason={gate.allowed ? null : gate.reason}
          onSubmit={(wei) =>
            runner.run({ type: 'borrow', musdWei: wei }, `Borrow ${formatMusd(wei)}`)
          }
        />
      ) : null}

      {mode === 'deposit' ? (
        <AmountPanel
          key="deposit"
          unit="BTC"
          title="Deposit Bitcoin"
          body="Adds collateral to your trove and raises your collateral ratio immediately. Note that adding collateral does not raise your Mezo borrow limit. Only a refinance does."
          presets={[
            { label: '0.01 BTC', wei: 10n ** 16n },
            { label: '0.05 BTC', wei: 5n * 10n ** 16n },
            { label: '0.1 BTC', wei: 10n ** 17n },
          ]}
          format={formatBtc}
          sponsored={isSponsoredKind('deposit')}
          disabledReason={gate.allowed ? null : gate.reason}
          cta="Deposit"
          onSubmit={(wei) =>
            runner.run({ type: 'deposit', btcWei: wei }, `Deposit ${formatBtc(wei)}`)
          }
        />
      ) : null}

      {mode === 'repay' ? (
        <AmountPanel
          key="repay"
          unit="MUSD"
          title="Repay debt"
          body="Reduces your principal and raises your collateral ratio. Interest is simple and non-compounding, fixed at the rate this trove opened at."
          presets={presetsFor(balances?.musdWei ?? 0n)}
          format={formatMusd}
          sponsored={isSponsoredKind('repay')}
          max={balances?.musdWei ?? 0n}
          maxLabel="Your MUSD balance"
          disabledReason={gate.allowed ? null : gate.reason}
          cta="Repay"
          onSubmit={(wei) =>
            runner.run({ type: 'repay', musdWei: wei }, `Repay ${formatMusd(wei)}`)
          }
        />
      ) : null}

      {mode === 'withdraw' ? (
        <AmountPanel
          key="withdraw"
          unit="BTC"
          title="Withdraw Bitcoin"
          body="Removes collateral. Maren refuses any withdrawal that would take the position below 180%, so the amount available here is already limited by your outstanding debt."
          presets={[
            { label: '0.01 BTC', wei: 10n ** 16n },
            { label: '0.05 BTC', wei: 5n * 10n ** 16n },
          ]}
          format={formatBtc}
          sponsored={isSponsoredKind('withdraw')}
          disabledReason={gate.allowed ? null : gate.reason}
          cta="Withdraw"
          onSubmit={(wei) =>
            runner.run({ type: 'withdraw', btcWei: wei }, `Withdraw ${formatBtc(wei)}`)
          }
        />
      ) : null}

      <TxSheet runner={runner} />
    </Screen>
  );
}

/** Borrow, with the live CR / liquidation-price preview. */
function BorrowPanel({
  position,
  price,
  gateReason,
  onSubmit,
}: {
  position: ReturnType<typeof usePosition>['data'];
  price: bigint | null;
  gateReason: string | null;
  onSubmit: (wei: bigint) => void;
}) {
  /**
   * The hard ceiling: the additional net debt that lands the position exactly on
   * MAREN_POLICY.minHealthyCr (180%). Computed by the SDK, then reduced by the debt
   * already outstanding. Mezo's per-trove `maxBorrowingCapacity` caps it further.
   */
  const ceiling = useMemo(() => {
    if (!position || !price) return 0n;

    const netDebtAtFloor = maxNetDebtAt(
      position.collateralWei,
      price,
      MAREN_POLICY.minHealthyCr,
      BORROWING_RATE,
    );
    const headroom = netDebtAtFloor - position.principalWei;
    const mezoHeadroom = position.maxBorrowingCapacityWei - position.principalWei;
    const limit = headroom < mezoHeadroom ? headroom : mezoHeadroom;
    return limit > 0n ? limit : 0n;
  }, [position, price]);

  /** Where the recommended 250% target sits on that track. */
  const recommended = useMemo(() => {
    if (!position || !price) return 0n;
    const atTarget =
      maxNetDebtAt(position.collateralWei, price, MAREN_POLICY.targetCr, BORROWING_RATE) -
      position.principalWei;
    const clamped = atTarget < 0n ? 0n : atTarget > ceiling ? ceiling : atTarget;
    return clamped;
  }, [position, price, ceiling]);

  const [amount, setAmount] = useState<bigint | null>(null);
  const value = amount ?? recommended;

  /** The projected position if this borrow goes through. */
  const preview = useMemo(() => {
    if (!position || !price) return null;
    const newPrincipal = position.principalWei + value;
    // totalDebtFor adds the origination fee and the 200 MUSD gas compensation — quoting
    // net debt as the debt would understate the risk.
    const newTotalDebt = totalDebtFor(newPrincipal, BORROWING_RATE);
    const cr = collateralRatio(position.collateralWei, newTotalDebt, price);
    return {
      cr,
      liq: liquidationPrice(position.collateralWei, newTotalDebt),
      totalDebt: newTotalDebt,
      health: assessHealth(position.collateralWei, newTotalDebt, price),
    };
  }, [position, price, value]);

  const disabled = gateReason !== null || ceiling === 0n;
  const tone = preview ? (healthTone[preview.health.status] ?? 'neutral') : 'neutral';
  const colour = toneColor[tone];

  return (
    <Card style={styles.panel}>
      <Txt variant="h3">Borrow MUSD</Txt>
      <Txt variant="small" tone="muted" style={styles.panelBody}>
        1.00% APR, simple interest, fixed for the life of this loan. The slider stops at Maren’s
        180% floor and will not let you past it.
      </Txt>

      {/* Amount */}
      <View style={styles.amountBlock}>
        <Label>You borrow</Label>
        <View style={styles.amountRow}>
          <Amount value={formatMusd(value)} size="numericXl" unitTone="musd" align="left" />
        </View>
      </View>

      <Slider
        value={value}
        max={ceiling}
        onChange={setAmount}
        marker={{ at: recommended, label: 'Recommended' }}
        formatValue={(w) => formatMusd(w)}
        accessibilityLabel="Amount to borrow"
        accessibilityHint={`Maximum ${formatMusd(ceiling)}, which is Maren's 180 percent collateral floor. Recommended ${formatMusd(recommended)}.`}
        disabled={disabled}
        style={styles.slider}
      />

      <View style={styles.sliderEnds}>
        <Txt variant="numericSm" tone="muted">
          0 MUSD
        </Txt>
        <Pressable
          onPress={() => setAmount(recommended)}
          accessibilityRole="button"
          accessibilityLabel={`Set to recommended, ${formatMusd(recommended)}`}
          hitSlop={10}
        >
          <Txt variant="small" tone="violet">
            Recommended · 250%
          </Txt>
        </Pressable>
        <Txt variant="numericSm" tone="muted">
          {formatMusd(ceiling, { unit: false })}
        </Txt>
      </View>

      {/* Live preview */}
      {preview ? (
        <View style={styles.preview}>
          <View style={styles.previewRow}>
            <View style={styles.previewCell}>
              <Label>Resulting ratio</Label>
              <View style={styles.previewValue}>
                <Ratio cr={preview.cr} size="numericLg" color={colour} />
              </View>
              <Txt variant="small" style={{ color: colour }}>
                {healthLabel[preview.health.status]}
              </Txt>
            </View>

            <View style={[styles.previewCell, styles.previewCellRight]}>
              <Label>Liquidation price</Label>
              <View style={styles.previewValue}>
                {/*
                  numericMd, not numericLg: a six-figure liquidation price is ten
                  characters, and at 28px mono that wrapped mid-number across two lines
                  ("$36,283." / "74") in a half-width cell. A wrapped figure is the one
                  thing BRAND.md §3's tabular column exists to prevent.
                */}
                <Num size="numericMd" numberOfLines={1} adjustsFontSizeToFit>
                  {formatUsd(preview.liq)}
                </Num>
              </View>
              <Txt variant="small" tone="muted">
                {formatPriceDropCaption(preview.health.priceDropToLiquidationBps)}
              </Txt>
            </View>
          </View>

          <View style={styles.previewFooter}>
            <StatRow
              label="Origination fee (0.1%)"
              value={<Musd wei={(value * BORROWING_RATE) / 10n ** 18n} plain size="numericSm" />}
            />
            <StatRow
              label="Total debt after"
              value={<Musd wei={preview.totalDebt} plain size="numericSm" />}
              last
            />
          </View>
        </View>
      ) : null}

      {/*
        Gas honesty. This note used to say every vault operation cost BTC gas, which was
        wrong in the direction that matters least but is still wrong: only the deposit is
        unsponsored, because it is the only payable one.
      */}
      <View style={styles.gasRow}>
        <Icon name="shield" size={14} color={brand.violet400} />
        <Txt variant="small" tone="muted" style={styles.gasText}>
          Depositing sends Bitcoin, so it is the one action a relayer cannot carry for you. You pay
          gas on that first transaction. Borrow, repay and withdraw are relayed and cost you
          nothing.
        </Txt>
      </View>

      {gateReason ? (
        <View style={styles.blocked} accessibilityRole="alert">
          <Txt variant="small" style={{ color: semanticText.warning }}>
            {gateReason}
          </Txt>
        </View>
      ) : null}

      <PillButton
        label={value > 0n ? `Borrow ${formatMusd(value)}` : 'Borrow'}
        onPress={() => onSubmit(value)}
        disabled={disabled || value === 0n}
        badge={<Icon name="arrowRight" size={15} color={base.onAccent} />}
        accessibilityHint="Requires Face ID, then waits for an on-chain receipt."
        style={styles.cta}
      />
    </Card>
  );
}

/** Deposit / repay / withdraw share one simpler shape. */
function AmountPanel({
  unit,
  title,
  body,
  presets,
  format,
  max,
  maxLabel,
  disabledReason,
  cta,
  sponsored,
  onSubmit,
}: {
  unit: 'BTC' | 'MUSD';
  title: string;
  body: string;
  presets: { label: string; wei: bigint }[];
  format: (wei: bigint) => string;
  max?: bigint;
  maxLabel?: string;
  disabledReason: string | null;
  cta: string;
  sponsored: boolean;
  onSubmit: (wei: bigint) => void;
}) {
  const [selected, setSelected] = useState<bigint>(presets[0]?.wei ?? 0n);
  const overMax = max !== undefined && selected > max;
  const disabled = disabledReason !== null || selected === 0n || overMax;

  return (
    <Card style={styles.panel}>
      <Txt variant="h3">{title}</Txt>
      <Txt variant="small" tone="muted" style={styles.panelBody}>
        {body}
      </Txt>

      <View style={styles.amountBlock}>
        <Label>Amount</Label>
        <View style={styles.amountRow}>
          <Amount
            value={format(selected)}
            size="numericXl"
            unitTone={unit === 'BTC' ? 'btc' : 'musd'}
            align="left"
          />
        </View>
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

      {max !== undefined ? (
        <View style={styles.maxRow}>
          <Txt variant="small" tone="muted">
            {maxLabel}
          </Txt>
          <Num
            size="numericSm"
            tone={overMax ? 'inherit' : 'muted'}
            style={overMax ? { color: semanticText.danger } : undefined}
          >
            {format(max)}
          </Num>
        </View>
      ) : null}

      <View style={styles.gasRow}>
        <Icon
          name={sponsored ? 'shield' : 'alert'}
          size={14}
          color={sponsored ? brand.violet400 : semanticText.warning}
        />
        <Txt variant="small" tone="muted" style={styles.gasText}>
          {sponsored ? gasCopy.sponsoredTitle + '.' : gasCopy.unsponsoredBody}
        </Txt>
      </View>

      {disabledReason ? (
        <View style={styles.blocked} accessibilityRole="alert">
          <Txt variant="small" style={{ color: semanticText.warning }}>
            {disabledReason}
          </Txt>
        </View>
      ) : null}

      <PillButton
        label={cta}
        onPress={() => onSubmit(selected)}
        disabled={disabled}
        badge={<Icon name="arrowRight" size={15} color={base.onAccent} />}
        accessibilityHint="Requires Face ID, then waits for an on-chain receipt."
        style={styles.cta}
      />
    </Card>
  );
}

function presetsFor(balance: bigint): { label: string; wei: bigint }[] {
  const wad = 10n ** 18n;
  return [
    { label: '500 MUSD', wei: 500n * wad },
    { label: '1,000 MUSD', wei: 1_000n * wad },
    { label: 'All available', wei: balance },
  ];
}

function formatPriceDropCaption(bps: number): string {
  if (bps <= 0) return 'liquidatable now';
  return `${(bps / 100).toFixed(0)}% below today`;
}

const styles = StyleSheet.create({
  header: { marginBottom: space.xl },
  title: { marginTop: space.xs },
  banner: { marginBottom: space.lg },
  summary: { marginBottom: space.xl },
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
  panel: { marginBottom: space.xl },
  panelBody: { marginTop: space.sm },
  amountBlock: { marginTop: space.xl },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: space.sm },
  unit: { marginBottom: 2 },
  slider: { marginTop: space.lg },
  sliderEnds: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.xs,
  },
  preview: {
    marginTop: space.xl,
    paddingTop: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: base.border,
  },
  previewRow: { flexDirection: 'row', gap: space.lg },
  previewCell: { flex: 1 },
  previewCellRight: { alignItems: 'flex-end' },
  previewValue: { marginTop: space.sm, marginBottom: space.xs },
  previewFooter: { marginTop: space.lg },
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
  maxRow: {
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
});
