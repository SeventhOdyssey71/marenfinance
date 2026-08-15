'use client';

import { useMemo, useState } from 'react';
import {
  BORROWING_RATE,
  LIQUIDATION_RESERVE,
  MAREN_POLICY,
  MIN_NET_DEBT,
  assessBorrowRoute,
  borrowCeiling,
  directTroveThreshold,
  formatApr,
  formatBtc,
  formatMusd,
  formatUsd,
  INTEREST_RATE_BPS,
  maxWithdrawable,
  previewBorrow,
  recommendedBorrow,
} from '@maren/sdk';

import { AmountField, AmountSlider, Segmented } from '@/components/app/controls';
import { HealthChip } from '@/components/app/health';
import {
  Btc,
  Dash,
  DropToLiquidation,
  LiquidationPrice,
  Musd,
  Num,
  RatioOrDash,
} from '@/components/app/money';
import { PriceBanner } from '@/components/app/price-banner';
import {
  ActionButton,
  AppCard,
  CardTitle,
  EmptyState,
  Info,
  Label,
  Metric,
  Note,
  StatRow,
} from '@/components/app/primitives';
import { TxSheet, useTxRunner, type TxIntent } from '@/components/app/tx';
import { ArrowRight, VaultIcon } from '@/components/ui/icons';
import { vaultActionGate } from '@/lib/chain/price';
import { mutate } from '@/lib/data/mock';
import { useBalances, usePosition, usePrice } from '@/lib/data/source';
import { parseUnitsSafe } from '@/lib/copy';
import { healthLabel, healthTone, policyRatio, toneClasses } from '@/lib/health';

type Mode = 'deposit' | 'borrow' | 'repay' | 'withdraw';

const MODES = [
  { key: 'deposit' as const, label: 'Deposit' },
  { key: 'borrow' as const, label: 'Borrow' },
  { key: 'repay' as const, label: 'Repay' },
  { key: 'withdraw' as const, label: 'Withdraw' },
];

/** 0.001 BTC — MarenVault.MIN_DEPOSIT, about 79x below the protocol's own minimum. */
const MIN_DEPOSIT = 10n ** 15n;

/**
 * Vault — deposit BTC, draw MUSD, repay, withdraw.
 *
 * The borrow slider is the centre of this screen, and it is bounded by the exact amount
 * that lands the position on Maren's 180% floor. The control cannot be dragged into a
 * state we would refuse.
 *
 * Every figure in the live preview comes from `@maren/sdk` — `borrowCeiling`,
 * `recommendedBorrow`, `previewBorrow`, `maxWithdrawable`. There is no arithmetic in
 * this file that touches a user's risk.
 */
export default function VaultPage() {
  const [chosen, setChosen] = useState<Mode | null>(null);
  const price = usePrice();
  const { data: position } = usePosition();
  const runner = useTxRunner();

  const livePrice = price.state === 'live' ? price.priceWei : null;

  const empty = position !== undefined && position.collateralWei === 0n && position.debtWei === 0n;

  /**
   * A wallet with nothing in it can only do one thing here, so that is the tab it lands
   * on. Deriving the default rather than seeding `useState` means it settles correctly
   * once the position arrives, while an explicit choice still wins.
   */
  const mode: Mode = chosen ?? (empty ? 'deposit' : 'borrow');
  const gate = vaultActionGate(mode, price, { hasDebt: (position?.debtWei ?? 0n) > 0n });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Label>Vault</Label>
        <h1 className="t-h2 mt-2">Bitcoin credit</h1>
        <p className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed">
          Borrow MUSD against Bitcoin without selling it.
        </p>
      </div>

      {price.state !== 'live' ? <PriceBanner feed={price} /> : null}

      <RouteCard />

      {/* No position card when there is no position. An empty account lands on the
          Deposit tab, and the deposit form IS this screen's empty state — a card above
          it repeating "Deposit Bitcoin" over a second identical button is the kind of
          stacked redundancy this pass exists to remove. */}
      {empty ? null : (
        <AppCard>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle>Your position</CardTitle>
            {/* Only when the route card above is not already carrying it. A pooled user
                saw "POOLED" twice in two stacked cards. */}
            {position && position.route !== 'pooled' ? (
              <span className="t-label text-text-subtle">Direct</span>
            ) : null}
          </div>
          <div className="mt-2">
            <StatRow
              label="Collateral"
              value={position ? <Btc wei={position.collateralWei} size="lg" /> : <Dash size="lg" />}
              sub={
                position && livePrice ? (
                  <Num size="sm" tone="subtle">
                    {formatUsd((position.collateralWei * livePrice) / 10n ** 18n)}
                  </Num>
                ) : null
              }
            />
            <StatRow
              label="Total debt"
              hint={
                position?.route === 'direct'
                  ? 'includes the 200 MUSD liquidation reserve'
                  : 'no reserve on the pooled route'
              }
              value={position ? <Musd wei={position.debtWei} size="lg" /> : <Dash size="lg" />}
            />
            <StatRow
              label="Borrow limit"
              hint="fixed when this trove opened"
              value={
                position ? (
                  <Musd wei={position.maxBorrowingCapacityWei} size="lg" />
                ) : (
                  <Dash size="lg" />
                )
              }
              last
            />
          </div>
        </AppCard>
      )}

      <Segmented options={MODES} value={mode} onChange={setChosen} label="Vault action" />

      {mode === 'borrow' ? (
        <BorrowPanel
          runner={runner}
          gateReason={gate.allowed ? null : gate.reason}
          price={livePrice}
          onDeposit={() => setChosen('deposit')}
        />
      ) : null}
      {mode === 'deposit' ? <DepositPanel runner={runner} price={livePrice} /> : null}
      {mode === 'repay' ? <RepayPanel runner={runner} /> : null}
      {mode === 'withdraw' ? (
        <WithdrawPanel
          runner={runner}
          price={livePrice}
          gateReason={gate.allowed ? null : gate.reason}
        />
      ) : null}

      <TxSheet runner={runner} />
    </div>
  );
}

/**
 * Which route the user is on, and why.
 *
 * The interface prefers the direct route whenever it is available, even though pooled
 * volume is better for Maren. A user with enough collateral is told, in plain words, that
 * they do not need to accept pooling risk.
 */
function RouteCard() {
  const { data: position } = usePosition();
  const price = usePrice();
  const livePrice = price.state === 'live' ? price.priceWei : null;

  /**
   * Only the POOLED route gets a card of its own, because only the pooled route has
   * something a user must be told. "You hold your own trove and take no pooling risk"
   * is good news and one line long; it was filling an entire card on the most important
   * screen in the app, so it now rides as a chip on the position card's header instead.
   */
  if (!position || position.route !== 'pooled') return null;

  const assessment = livePrice
    ? assessBorrowRoute(position.collateralWei, livePrice, MAREN_POLICY.targetCr, BORROWING_RATE)
    : null;
  const threshold = livePrice ? directTroveThreshold(livePrice) : null;

  return (
    <AppCard>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <CardTitle>Pooled position</CardTitle>
        <span className="t-label text-text-subtle">Pooled</span>
      </div>

      {/* The pooled-risk statement stays, in one sentence. It is the single most
          important thing a pooled user does not otherwise know, and shortening a
          disclosure is not the same as removing it. */}
      <p className="text-text-muted mt-4 max-w-[68ch] text-sm leading-relaxed">
        Your deposit shares one trove with other users — segregated in{' '}
        <em className="text-text not-italic">accounting, not custody</em>, so a drawdown faster than
        the keeper could socialise losses.
      </p>
      <Info summary="How Maren limits that risk">
        Maren liquidates a pooled position internally at{' '}
        {policyRatio(MAREN_POLICY.vaultLiquidationCr)}, far above the protocol’s 110%, and backs
        that with a 0.001 BTC floor, per-block keeper checks and an insurance buffer funded from
        vault fees. These are mitigations, not a guarantee. You are here because a trove of your own
        needs about {threshold ? formatBtc(threshold) : '0.079 BTC'} — MUSD will not open one below{' '}
        {formatMusd(MIN_NET_DEBT)} of net debt.
      </Info>
      {assessment?.eligible && assessment.route === 'direct' ? (
        <p className="text-text-muted mt-4 max-w-[68ch] text-sm leading-relaxed">
          Your collateral now supports a trove of your own, which would remove this risk entirely.
        </p>
      ) : null}
    </AppCard>
  );
}

function BorrowPanel({
  runner,
  gateReason,
  price,
  onDeposit,
}: {
  runner: ReturnType<typeof useTxRunner>;
  gateReason: string | null;
  price: bigint | null;
  onDeposit: () => void;
}) {
  const { data: position } = usePosition();

  const ceiling = useMemo(
    () => (position && price ? borrowCeiling(position, price) : null),
    [position, price],
  );
  const recommended = useMemo(
    () =>
      position && price && ceiling ? recommendedBorrow(position, price, ceiling.amountWei) : 0n,
    [position, price, ceiling],
  );

  const [amount, setAmount] = useState<bigint | null>(null);
  const value = amount ?? recommended;

  const preview = useMemo(
    () => (position && price ? previewBorrow(position, price, value) : null),
    [position, price, value],
  );

  const disabled = gateReason !== null || !ceiling || ceiling.amountWei === 0n;

  /**
   * Below the 250% we recommend, the resulting ratio shifts from neutral to amber and
   * the copy shifts from descriptive to a question. Above it, the figure is neutral like
   * every other figure on the screen — BRAND.md §2's one-accent rule holds either way,
   * because only ONE figure here ever takes a colour.
   */
  const belowRecommendation = preview !== null && preview.collateralRatio < MAREN_POLICY.targetCr;
  const ratioTone = !preview
    ? null
    : preview.health.status === 'healthy'
      ? belowRecommendation
        ? toneClasses.warning
        : null
      : toneClasses[healthTone[preview.health.status]];

  const dropPercent = preview ? Math.floor(preview.health.priceDropToLiquidationBps / 100) : 0;

  const intent = (): TxIntent => ({
    title: `Borrow ${formatMusd(value)}`,
    details: [
      { label: 'You receive', value: <Musd wei={value} /> },
      {
        label: 'Origination fee (0.1%)',
        value: preview ? <Musd wei={preview.originationFeeWei} /> : <Dash />,
      },
      {
        label: 'Liquidation reserve',
        value:
          position?.route === 'direct' ? (
            <span className="text-text-muted">
              <Musd wei={LIQUIDATION_RESERVE} /> — refunded on close
            </span>
          ) : (
            <span className="text-text-muted">none</span>
          ),
      },
      { label: 'Interest', value: <span>{formatApr(INTEREST_RATE_BPS)}, fixed</span> },
      {
        label: 'Total debt after',
        value: preview ? <Musd wei={preview.debtWei} /> : <Dash />,
      },
      {
        label: 'Resulting ratio',
        value: preview ? (
          <RatioOrDash cr={preview.collateralRatio} debtWei={preview.debtWei} />
        ) : (
          <Dash />
        ),
      },
      {
        label: 'Liquidation price',
        value: preview ? (
          <LiquidationPrice wei={preview.liquidationPriceWei} debtWei={preview.debtWei} />
        ) : (
          <Dash />
        ),
      },
    ],
    gas:
      position?.route === 'pooled'
        ? {
            sponsored: true,
            note: 'Maren’s relayer submits this and pays the Bitcoin gas.',
          }
        : {
            sponsored: false,
            note: 'Costs BTC gas. Maren does not sponsor direct-trove operations.',
          },
    caution: belowRecommendation
      ? `Bitcoin would only need to fall ${dropPercent}% to liquidate this position.`
      : undefined,
    confirmLabel: `Borrow ${formatMusd(value)}`,
    simulate: () => mutate.borrow(value),
  });

  // Nothing to borrow against. The slider, the preview and the fee breakdown are all
  // functions of a position that does not exist, so none of them render.
  if (position && position.collateralWei === 0n) {
    return (
      <AppCard className="p-6 md:p-10">
        <EmptyState
          icon={<VaultIcon className="size-6" />}
          title="Deposit first"
          action={
            <ActionButton onClick={onDeposit} icon={<ArrowRight className="size-4" />}>
              Deposit Bitcoin
            </ActionButton>
          }
        >
          Borrowing needs collateral. {formatApr(INTEREST_RATE_BPS)}, fixed.
        </EmptyState>
      </AppCard>
    );
  }

  return (
    <AppCard className="p-6 md:p-8">
      <CardTitle>Borrow MUSD</CardTitle>
      {/* The rate, and nothing else. That the slider stops at the floor is self-evident
          when it stops, and the cap is named underneath it in any case.

          `data-contrast` is verify-contrast's hook for muted body copy on a card
          surface, which is the worst case for this token — it used to sit on the route
          card, which no longer renders on the direct route. */}
      <p
        data-contrast="route-body"
        className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed"
      >
        {formatApr(INTEREST_RATE_BPS)}, fixed for the life of this loan.
      </p>

      <div className="mt-8">
        <Label>You borrow</Label>
        <div className="mt-3 flex items-baseline gap-3">
          <Num size="xl">{formatMusd(value, { unit: false })}</Num>
          <span className="t-h3 text-text-muted">MUSD</span>
        </div>
      </div>

      <div className="mt-6">
        <AmountSlider
          value={value}
          max={ceiling?.amountWei ?? 0n}
          onChange={setAmount}
          disabled={disabled}
          label="Amount to borrow"
          describeValue={(v) =>
            `${formatMusd(v)} of a maximum ${formatMusd(ceiling?.amountWei ?? 0n)}`
          }
          marker={{
            at: recommended,
            label: `Recommended · ${policyRatio(MAREN_POLICY.targetCr)}`,
            onSelect: () => setAmount(recommended),
          }}
          endLabels={{
            start: '0 MUSD',
            end: formatMusd(ceiling?.amountWei ?? 0n, { unit: false }),
          }}
        />
      </div>

      {ceiling && ceiling.amountWei > 0n ? (
        <p className="text-text-subtle mt-4 text-xs leading-relaxed">
          {ceiling.binding === 'ceiling'
            ? `Capped by Mezo’s per-trove ceiling — ${formatMusd(ceiling.mezoHeadroomWei)} of it is unused. Your ratio would allow ${formatMusd(ceiling.ratioHeadroomWei)}.`
            : `Capped by Maren’s ${policyRatio(MAREN_POLICY.minHealthyCr)} floor. Mezo’s ceiling would allow ${formatMusd(ceiling.mezoHeadroomWei)}.`}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-8 border-t border-[var(--border-hairline)] pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="t-label text-text-subtle">If you borrow this</span>
            <HealthChip status={preview.health.status} />
          </div>

          {/* Every figure here is derived from the debt this borrow WOULD create, so
              each one dashes while that debt is still zero rather than quoting a
              liquidation price for a loan nobody has taken. */}
          <div className="mt-5 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <Metric
              label="Resulting ratio"
              value={
                <RatioOrDash
                  cr={preview.collateralRatio}
                  debtWei={preview.debtWei}
                  size="lg"
                  tone={ratioTone ? 'inherit' : 'default'}
                  className={ratioTone?.text ?? ''}
                />
              }
              caption={healthLabel[preview.health.status]}
            />
            <Metric
              label="Liquidation price"
              value={
                <LiquidationPrice
                  wei={preview.liquidationPriceWei}
                  debtWei={preview.debtWei}
                  size="lg"
                />
              }
              caption="protocol liquidates at 110%"
            />
            <Metric
              label="Bitcoin can fall"
              value={
                <DropToLiquidation
                  bps={preview.health.priceDropToLiquidationBps}
                  debtWei={preview.debtWei}
                  size="lg"
                />
              }
              caption="from today’s price"
            />
          </div>

          <div className="mt-6">
            <StatRow
              label="Origination fee (0.1%)"
              value={<Musd wei={preview.originationFeeWei} />}
            />
            <StatRow
              label="Liquidation reserve"
              hint="refunded when the trove closes"
              value={
                position?.route === 'direct' ? (
                  <Musd wei={LIQUIDATION_RESERVE} />
                ) : (
                  <span className="text-text-subtle text-sm">none on this route</span>
                )
              }
            />
            <StatRow label="Total debt after" value={<Musd wei={preview.debtWei} />} last />
          </div>

          {belowRecommendation ? (
            <p className="text-warning mt-5 max-w-[68ch] text-sm leading-relaxed" role="status">
              Bitcoin would only need to fall {dropPercent}% to liquidate this, below the{' '}
              {policyRatio(MAREN_POLICY.targetCr)} we recommend.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-text-subtle mt-6 text-xs leading-relaxed">
        {position?.route === 'pooled'
          ? 'No gas — Maren’s relayer pays it.'
          : 'Costs BTC gas. Maren does not sponsor direct-trove operations.'}
      </p>

      {gateReason ? (
        <div className="mt-5">
          <Note tone="warning" role="alert">
            {gateReason}
          </Note>
        </div>
      ) : null}

      <div className="mt-7">
        <ActionButton
          onClick={() => runner.request(intent())}
          disabled={disabled || value === 0n}
          icon={<ArrowRight className="size-4" />}
        >
          {value > 0n ? `Borrow ${formatMusd(value)}` : 'Borrow'}
        </ActionButton>
      </div>
    </AppCard>
  );
}

function DepositPanel({
  runner,
  price,
}: {
  runner: ReturnType<typeof useTxRunner>;
  price: bigint | null;
}) {
  const { data: position } = usePosition();
  const [input, setInput] = useState('0.05');
  const wei = parseUnitsSafe(input);

  const belowMinimum = wei > 0n && wei < MIN_DEPOSIT;
  const routeAfter =
    price && position
      ? assessBorrowRoute(
          position.collateralWei + wei,
          price,
          MAREN_POLICY.targetCr,
          BORROWING_RATE,
        )
      : null;

  const intent = (): TxIntent => ({
    title: `Deposit ${formatBtc(wei)}`,
    details: [
      { label: 'Collateral added', value: <Btc wei={wei} /> },
      {
        label: 'Collateral after',
        value: position ? <Btc wei={position.collateralWei + wei} /> : <Dash />,
      },
      {
        label: 'Route after',
        value:
          routeAfter?.eligible === true ? (
            <span className="text-text-muted">
              {routeAfter.route === 'direct' ? 'Direct trove' : 'Pooled'}
            </span>
          ) : (
            <Dash />
          ),
      },
    ],
    gas: {
      sponsored: false,
      note: 'A deposit carries Bitcoin with the call, which the relayer cannot sponsor. Everything after it is free.',
    },
    confirmLabel: `Deposit ${formatBtc(wei)}`,
    simulate: () => mutate.depositBtc(wei),
  });

  return (
    <AppCard className="p-6 md:p-8">
      <CardTitle>Deposit Bitcoin</CardTitle>
      <p className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed">
        Adds collateral and raises your ratio immediately.
      </p>

      <div className="mt-8 max-w-md">
        <AmountField
          value={input}
          onChange={setInput}
          unit="BTC"
          label="Amount"
          presets={[
            { label: '0.001 BTC', value: '0.001' },
            { label: '0.01 BTC', value: '0.01' },
            { label: '0.05 BTC', value: '0.05' },
            { label: '0.1 BTC', value: '0.1' },
          ]}
          error={belowMinimum ? `Below the ${formatBtc(MIN_DEPOSIT)} minimum deposit.` : null}
          hint={
            routeAfter?.eligible === true ? (
              <>
                After this deposit you are on the{' '}
                <span className="text-text-muted">
                  {routeAfter.route === 'direct' ? 'direct trove' : 'pooled'}
                </span>{' '}
                route.
              </>
            ) : null
          }
        />
      </div>

      {/* The one action Maren cannot sponsor, said before the user signs it. */}
      <p className="text-text-subtle mt-6 max-w-[68ch] text-xs leading-relaxed">
        A deposit costs BTC gas — it carries value, and the relayer cannot sponsor that. Everything
        after it is free.
      </p>

      <div className="mt-7">
        <ActionButton
          onClick={() => runner.request(intent())}
          disabled={wei === 0n || belowMinimum}
          icon={<ArrowRight className="size-4" />}
        >
          Deposit {wei > 0n ? formatBtc(wei) : ''}
        </ActionButton>
      </div>
    </AppCard>
  );
}

function RepayPanel({ runner }: { runner: ReturnType<typeof useTxRunner> }) {
  const { data: position } = usePosition();
  const { data: balances } = useBalances();
  const [input, setInput] = useState('500');
  const wei = parseUnitsSafe(input);

  const balance = balances?.musdWei ?? 0n;
  const overBalance = wei > balance;

  const intent = (): TxIntent => ({
    title: `Repay ${formatMusd(wei)}`,
    details: [
      { label: 'Repaying', value: <Musd wei={wei} /> },
      {
        label: 'Debt after',
        value: position ? (
          <Musd wei={position.debtWei > wei ? position.debtWei - wei : 0n} />
        ) : (
          <Dash />
        ),
      },
    ],
    gas: {
      sponsored: true,
      note: 'Gasless on the pooled route. Repaying is never paused and never gated on the oracle — an exit must always be open.',
    },
    confirmLabel: `Repay ${formatMusd(wei)}`,
    simulate: () => mutate.repay(wei),
  });

  return (
    <AppCard className="p-6 md:p-8">
      <CardTitle>Repay debt</CardTitle>
      <p className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed">
        Reduces your principal and raises your ratio. Interest is simple, never compounding.
      </p>

      <div className="mt-8 max-w-md">
        <AmountField
          value={input}
          onChange={setInput}
          unit="MUSD"
          label="Amount"
          max={<Musd wei={balance} size="sm" />}
          maxLabel="Your MUSD balance"
          onMax={() => setInput(formatMusd(balance, { unit: false }).replace(/,/g, ''))}
          presets={[
            { label: '500 MUSD', value: '500' },
            { label: '1,000 MUSD', value: '1000' },
          ]}
          error={overBalance ? 'More than your MUSD balance.' : null}
        />
      </div>

      <p className="text-text-subtle mt-6 text-xs leading-relaxed">
        Repay needs no price, so it stays open when the oracle is stale.
      </p>

      <div className="mt-7">
        <ActionButton
          onClick={() => runner.request(intent())}
          disabled={wei === 0n || overBalance}
          icon={<ArrowRight className="size-4" />}
        >
          Repay {wei > 0n ? formatMusd(wei) : ''}
        </ActionButton>
      </div>
    </AppCard>
  );
}

function WithdrawPanel({
  runner,
  price,
  gateReason,
}: {
  runner: ReturnType<typeof useTxRunner>;
  price: bigint | null;
  gateReason: string | null;
}) {
  const { data: position } = usePosition();
  const [input, setInput] = useState('0.01');
  const wei = parseUnitsSafe(input);

  const available = position && price ? maxWithdrawable(position, price) : null;
  const overAvailable = available !== null && wei > available;

  const intent = (): TxIntent => ({
    title: `Withdraw ${formatBtc(wei)}`,
    details: [
      { label: 'Collateral out', value: <Btc wei={wei} /> },
      {
        label: 'Collateral after',
        value: position ? (
          <Btc wei={position.collateralWei > wei ? position.collateralWei - wei : 0n} />
        ) : (
          <Dash />
        ),
      },
    ],
    gas: {
      sponsored: true,
      note: 'Gasless on the pooled route. Withdrawal is never paused: if Maren halts the vault, entries close and exits stay open.',
    },
    confirmLabel: `Withdraw ${formatBtc(wei)}`,
    simulate: () => mutate.withdrawBtc(wei),
  });

  return (
    <AppCard className="p-6 md:p-8">
      <CardTitle>Withdraw Bitcoin</CardTitle>
      <p className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed">
        The amount available is already capped at Maren’s {policyRatio(MAREN_POLICY.minHealthyCr)}{' '}
        floor.
      </p>

      <div className="mt-8 max-w-md">
        <AmountField
          value={input}
          onChange={setInput}
          unit="BTC"
          label="Amount"
          max={available !== null ? <Btc wei={available} size="sm" /> : <Dash size="sm" />}
          maxLabel="Available to withdraw"
          onMax={() =>
            available !== null && setInput(formatBtc(available, { unit: false }).replace(/,/g, ''))
          }
          error={overAvailable ? 'More than your position can release at 180%.' : null}
        />
      </div>

      {gateReason ? (
        <div className="mt-6">
          <Note tone="warning" role="alert">
            {gateReason}
          </Note>
        </div>
      ) : (
        <p className="text-text-subtle mt-6 text-xs leading-relaxed">
          Withdrawal is never paused. If Maren halts the vault, exits stay open.
        </p>
      )}

      <div className="mt-7">
        <ActionButton
          onClick={() => runner.request(intent())}
          disabled={wei === 0n || overAvailable || gateReason !== null}
          icon={<ArrowRight className="size-4" />}
        >
          Withdraw {wei > 0n ? formatBtc(wei) : ''}
        </ActionButton>
      </div>
    </AppCard>
  );
}
