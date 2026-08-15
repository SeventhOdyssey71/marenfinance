'use client';

import { useState } from 'react';
import { formatMusd } from '@maren/sdk';

import { AmountField, Segmented } from '@/components/app/controls';
import { Dash, Musd, Num } from '@/components/app/money';
import {
  ActionButton,
  AppCard,
  CardTitle,
  Label,
  Metric,
  Note,
  StatRow,
} from '@/components/app/primitives';
import { TxSheet, useTxRunner, type TxIntent } from '@/components/app/tx';
import { ArrowRight } from '@/components/ui/icons';
import { parseUnitsSafe, timeAgo } from '@/lib/copy';
import { mutate } from '@/lib/data/mock';
import { useBalances, useEarn } from '@/lib/data/source';

/**
 * Earn — idle MUSD into the MUSD Stability Pool via MarenEarn, an ERC-4626 vault.
 *
 * THIS SCREEN IS DELIBERATELY UNEXCITING, and the hard rule is that there is no APY on
 * it. The Stability Pool has no token emissions; its entire yield is the Bitcoin seized
 * in liquidations, which is lumpy and can be zero for months. Annualising three events in
 * ninety days would be a lie with a percent sign on it.
 *
 * So the headline is MUSD actually realised over an observed window, labelled
 * backward-looking, with the event count shown so the lumpiness stays visible rather than
 * being smoothed into a rate. A less honest version of this screen would raise more
 * deposits — and attract capital that leaves for the next number.
 */
export default function EarnPage() {
  const { data: earn } = useEarn();
  const { data: balances } = useBalances();
  const runner = useTxRunner();
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('500');

  const wei = parseUnitsSafe(amount);
  const spendable = balances?.musdWei ?? 0n;
  const inEarn = earn?.assetsWei ?? 0n;
  const ceiling = mode === 'deposit' ? spendable : inEarn;
  const overCeiling = wei > ceiling;

  const intent = (): TxIntent => ({
    title:
      mode === 'deposit' ? `Deposit ${formatMusd(wei)} into Earn` : `Withdraw ${formatMusd(wei)}`,
    details: [
      { label: 'Amount', value: <Musd wei={wei} /> },
      {
        label: mode === 'deposit' ? 'In Earn after' : 'Spendable after',
        value: <Musd wei={mode === 'deposit' ? inEarn + wei : spendable + wei} />,
      },
      {
        label: 'Return',
        value: <span className="text-text-muted">liquidation gains only — no fixed rate</span>,
      },
    ],
    gas: {
      sponsored: true,
      note: 'No gas. Maren’s relayer pays the Bitcoin network fee for Earn deposits and withdrawals.',
    },
    confirmLabel: mode === 'deposit' ? 'Deposit' : 'Withdraw',
    simulate: () => (mode === 'deposit' ? mutate.earnDeposit(wei) : mutate.earnWithdraw(wei)),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Label>Earn</Label>
        <h1 className="t-h2 mt-2">Idle MUSD</h1>
        <p className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed">
          MUSD you are not spending goes into the Stability Pool through an ERC-4626 vault. Returns
          come from liquidations, which are irregular. Past returns do not predict future ones.
        </p>
      </div>

      <AppCard className="p-6 md:p-8">
        <CardTitle>Your balance in Earn</CardTitle>
        <div className="mt-6 flex flex-wrap items-baseline gap-3">
          {earn ? (
            <Num size="xl">{formatMusd(earn.assetsWei, { unit: false })}</Num>
          ) : (
            <Dash size="xl" />
          )}
          <span className="t-h3 text-text-muted">MUSD</span>
        </div>
        <div className="mt-6">
          <StatRow
            label="Deposited"
            hint="everything you have put in, for computing realised return"
            value={earn ? <Musd wei={earn.depositedWei} /> : <Dash />}
            last
          />
        </div>
      </AppCard>

      {/* --------------------------------------------- Trailing realised yield */}
      <AppCard className="p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <CardTitle>Realised over the last {earn?.trailing.windowDays ?? 90} days</CardTitle>
          <span className="bg-surface-inset text-text-muted inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--border-hairline)] px-3 py-1.5 text-xs">
            Backward-looking
          </span>
        </div>

        <div className="mt-6 flex flex-wrap items-baseline gap-3">
          {earn ? (
            <Num size="xl">{formatMusd(earn.trailing.realisedWei, { unit: false })}</Num>
          ) : (
            <Dash size="xl" />
          )}
          <span className="t-h3 text-text-muted">MUSD</span>
        </div>

        {/* The disclosure that makes the number honest. Not a footnote, not a tooltip —
            it sits directly under the figure it qualifies. */}
        <p
          data-contrast="earn-disclosure"
          className="text-text-muted mt-5 max-w-[68ch] text-sm leading-relaxed"
        >
          This is MUSD actually realised in the past, not a rate and not a forecast. Maren does not
          display an APY for Earn because there is no reliable one to display.
        </p>
        <p className="text-text-subtle mt-3 max-w-[68ch] text-sm leading-relaxed">
          The MUSD Stability Pool has no token emissions. Its entire yield is the Bitcoin seized in
          liquidations, sold and compounded back into MUSD. Whether that happens at all depends on
          whether anyone gets liquidated, so returns arrive in lumps and can be zero for months.
        </p>

        {earn ? (
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <Metric
              label="Liquidation events"
              value={<Num size="lg">{earn.trailing.liquidationEvents}</Num>}
              caption="in this window"
            />
            <Metric
              label="Most recent gain"
              value={
                <Num size="lg">
                  {earn.trailing.lastGainAt ? timeAgo(earn.trailing.lastGainAt) : 'none yet'}
                </Num>
              }
              caption="gains are lumpy by construction"
            />
            <Metric
              label="Forward rate"
              value={<Num size="lg">—</Num>}
              caption="not shown, because we would be making it up"
            />
          </div>
        ) : null}
      </AppCard>

      {/* ------------------------------------------------------------- Actions */}
      <Segmented
        options={[
          { key: 'deposit' as const, label: 'Deposit' },
          { key: 'withdraw' as const, label: 'Withdraw' },
        ]}
        value={mode}
        onChange={setMode}
        label="Earn action"
      />

      <AppCard className="p-6 md:p-8">
        <CardTitle>{mode === 'deposit' ? 'Move into Earn' : 'Move back to spendable'}</CardTitle>

        <div className="mt-8 max-w-md">
          <AmountField
            value={amount}
            onChange={setAmount}
            unit="MUSD"
            label="Amount"
            max={<Musd wei={ceiling} size="sm" />}
            maxLabel={mode === 'deposit' ? 'Spendable MUSD' : 'In Earn'}
            onMax={() => setAmount(formatMusd(ceiling, { unit: false }).replace(/,/g, ''))}
            error={
              overCeiling
                ? mode === 'deposit'
                  ? 'More than your spendable MUSD.'
                  : 'More than you have in Earn.'
                : null
            }
          />
        </div>

        <p className="text-text-subtle mt-6 text-xs leading-relaxed">
          No gas. Maren’s relayer pays the Bitcoin network fee for Earn deposits and withdrawals.
          Deposits go straight into the Stability Pool; withdrawals come out of idle MUSD first,
          then the pool.
        </p>

        <div className="mt-7">
          <ActionButton
            onClick={() => runner.request(intent())}
            disabled={wei === 0n || overCeiling}
            icon={<ArrowRight className="size-4" />}
          >
            {mode === 'deposit' ? 'Deposit into Earn' : 'Withdraw from Earn'}
          </ActionButton>
        </div>
      </AppCard>

      <Note>
        Stability Pool deposits absorb liquidated debt. In exchange for the Bitcoin gains you take
        on the risk that your MUSD is used to close somebody else’s position — historically
        profitable, not guaranteed, and not principal-protected. The vault also holds Bitcoin it has
        not yet converted, so its share price moves with BTC until a swap route Maren has reviewed
        exists on Mezo.
      </Note>

      <TxSheet runner={runner} />
    </div>
  );
}
