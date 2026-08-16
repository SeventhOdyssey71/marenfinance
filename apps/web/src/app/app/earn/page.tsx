'use client';

import { useState } from 'react';
import { formatMusd } from '@maren/sdk';

import { AmountField, Segmented } from '@/components/app/controls';
import { Dash, Musd, Num } from '@/components/app/money';
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
import { ArrowRight } from '@/components/ui/icons';
import { ConnectPrompt } from '@/components/app/connect-prompt';
import { EarnIcon } from '@/components/ui/icons';
import { BlockedNote } from '@/components/app/blocked';
import { parseUnitsSafe, timeAgo } from '@/lib/copy';
import { preflightEarnWithdraw, preflightMusdSpend } from '@/lib/chain/preflight';
import { gasNote, SPENDERS, useMarenWrites, useMusdAllowance } from '@/lib/chain/write';
import { useBalances, useDataSource, useEarn } from '@/lib/data/source';

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
  const source = useDataSource();
  const { data: earn } = useEarn();
  const { data: balances } = useBalances();
  const runner = useTxRunner();
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('500');

  const wei = parseUnitsSafe(amount);
  const spendable = balances?.musdWei ?? 0n;
  const inEarn = earn?.assetsWei ?? 0n;

  /**
   * Both directions are preflighted, and today the deposit side is closed for everyone:
   * Earn takes MUSD, MUSD comes from borrowing, and the pooled trove is under its floor so
   * nobody can borrow. That is a chain of three facts a user has no way to assemble from a
   * failed `transferFrom`, so the button is disabled and the first link in the chain is
   * stated where the button is.
   */
  const pre =
    mode === 'deposit'
      ? preflightMusdSpend(balances, wei, { verb: 'deposit', noun: 'Deposit' })
      : preflightEarnWithdraw(earn, wei);
  const ceiling = pre.maxWei;

  /**
   * Depositing into an ERC-4626 pulls the asset with `transferFrom`, so MarenEarn needs an
   * MUSD allowance first. Surfaced as its own step for the same reason the Vault does it:
   * one press must not produce two signatures, only one of which anybody checks a receipt
   * for. Withdrawing burns the caller's own shares and needs no allowance.
   */
  const {
    allowanceWei,
    needed: needsApproval,
    refetch: refetchAllowance,
  } = useMusdAllowance(SPENDERS.earn, mode === 'deposit' ? wei : 0n);

  const approvalIntent = (): TxIntent => ({
    title: `Approve ${formatMusd(wei)} for Earn`,
    successTitle: `Approved ${formatMusd(wei)}`,
    changes: [
      {
        label: 'Earn allowance',
        before: <Musd wei={allowanceWei ?? 0n} />,
        after: <Musd wei={wei} />,
      },
    ],
    details: [
      { label: 'Token', value: <span className="text-text-muted">MUSD</span> },
      { label: 'Amount', value: <Musd wei={wei} /> },
      {
        label: 'Spender',
        value: <span className="num text-text-subtle break-all text-xs">{SPENDERS.earn}</span>,
      },
    ],
    gas: {
      sponsored: false,
      note: 'An ERC-20 approval is a transaction on MUSD itself, not on Maren, so it could never be relayed through Maren’s hub. It approves exactly this amount, not an unlimited allowance.',
    },
    confirmLabel: 'Approve',
    submit: writes.ready
      ? async () => {
          const hash = await writes.approveMusd(SPENDERS.earn, wei);
          refetchAllowance();
          return hash;
        }
      : undefined,
  });

  const intent = (): TxIntent => ({
    title:
      mode === 'deposit' ? `Deposit ${formatMusd(wei)} into Earn` : `Withdraw ${formatMusd(wei)}`,
    successTitle:
      mode === 'deposit'
        ? `Deposited ${formatMusd(wei)} into Earn`
        : `Withdrew ${formatMusd(wei)} from Earn`,
    changes: [
      {
        label: 'In Earn',
        before: <Musd wei={inEarn} />,
        after: <Musd wei={mode === 'deposit' ? inEarn + wei : inEarn > wei ? inEarn - wei : 0n} />,
      },
      {
        label: 'Spendable MUSD',
        before: <Musd wei={spendable} />,
        after: (
          <Musd
            wei={mode === 'deposit' ? (spendable > wei ? spendable - wei : 0n) : spendable + wei}
          />
        ),
      },
    ],
    details: [
      { label: 'Amount', value: <Musd wei={wei} /> },
      {
        label: mode === 'deposit' ? 'In Earn after' : 'Spendable after',
        value: <Musd wei={mode === 'deposit' ? inEarn + wei : spendable + wei} />,
      },
      {
        label: 'Return',
        value: <span className="text-text-muted">liquidation gains only, no fixed rate</span>,
      },
    ],
    gas: gasNote(true, 'Moves MUSD between your wallet and the Stability Pool.'),
    confirmLabel: mode === 'deposit' ? 'Deposit' : 'Withdraw',
    submit: writes.ready
      ? () => (mode === 'deposit' ? writes.earnDeposit(wei) : writes.earnWithdraw(wei))
      : undefined,
  });

  if (!source.connected) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <Label>Earn</Label>
          <h1 className="t-h2 mt-2">Idle MUSD</h1>
          <p className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed">
            MUSD you are not spending goes into the Stability Pool. Returns come from liquidations,
            which are irregular.
          </p>
        </div>

        <ConnectPrompt icon={<EarnIcon className="size-6" />} title="Connect to use Earn">
          {/* Carries the contrast hook while disconnected, so the muted-on-card worst case
              is still measured on this route. The connected screen has its own. */}
          <span data-contrast="earn-disclosure">
            Earn holds your MUSD in the MUSD Stability Pool through an ERC-4626 vault. Maren does
            not display an APY for Earn because there is no reliable one to display. The yield is
            liquidation gains, which can be zero for months.
          </span>
        </ConnectPrompt>

        <Note>
          <p>
            Your MUSD absorbs liquidated debt. It is not principal-protected, and not guaranteed.
          </p>
        </Note>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Label>Earn</Label>
        <h1 className="t-h2 mt-2">Idle MUSD</h1>
        <p className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed">
          MUSD you are not spending goes into the Stability Pool. Returns come from liquidations,
          which are irregular.
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
        {/* Only once there is something to compare the balance against. Repeating
            "0.00 MUSD" directly beneath a 0.00 MUSD headline is a row that carries no
            information. */}
        {!earn || earn.depositedWei > 0n ? (
          <div className="mt-6">
            <StatRow
              label="Deposited"
              hint="everything you have put in"
              value={earn ? <Musd wei={earn.depositedWei} /> : <Dash />}
              last
            />
          </div>
        ) : null}
      </AppCard>

      {/* --------------------------------------------- Trailing realised yield */}
      {/* A window of zero days is not a window. Reporting "0.00 MUSD realised over 0
          days" to someone who has never deposited states the result of an experiment
          they did not run, which is the same dishonesty as a forward APY, backdated. */}
      {earn && earn.trailing.windowDays === 0 ? (
        <AppCard className="p-6 md:p-8">
          <EmptyState title="No return to report yet">
            Returns appear here once you have deposited and a liquidation has been absorbed.
          </EmptyState>
        </AppCard>
      ) : (
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
            it sits directly under the figure it qualifies. One sentence; the mechanism
            behind it sits one click down rather than being deleted. */}
          <p
            data-contrast="earn-disclosure"
            className="text-text-muted mt-5 max-w-[68ch] text-sm leading-relaxed"
          >
            Realised in the past, not a forecast. Maren does not display an APY for Earn because
            there is no reliable one to display.
          </p>
          <Info summary="Why there is no rate">
            The MUSD Stability Pool has no token emissions. Its entire yield is the Bitcoin seized
            in liquidations, sold and compounded back into MUSD, so whether it pays at all depends
            on whether anyone gets liquidated. Returns arrive in lumps and can be zero for months,
            and annualising three events in ninety days would be a lie with a percent sign on it.
          </Info>

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
                caption="gains are lumpy"
              />
              <Metric
                label="Forward rate"
                value={<Dash size="lg" />}
                caption="we would be making it up"
              />
            </div>
          ) : null}
        </AppCard>
      )}

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
              pre.blocker && pre.blocker.scope !== 'loading' && !pre.rangeDead && wei > 0n
                ? pre.blocker.title
                : null
            }
          />
        </div>

        <p className="text-text-subtle mt-6 text-xs leading-relaxed">
          Costs BTC gas. Maren’s relayer is not deployed, so your own wallet submits this.
        </p>

        {pre.blocker && !(pre.blocker.scope === 'input' && wei === 0n) ? (
          <div className="mt-6">
            <BlockedNote
              blocker={pre.blocker}
              id="earn-blocked"
              role={pre.rangeDead ? 'status' : 'alert'}
            />
          </div>
        ) : null}

        {pre.ok && needsApproval ? (
          <div className="mt-6">
            <Note>
              Earn has to be allowed to take {formatMusd(wei)} of your MUSD before it can be
              deposited. That is one approval transaction, and it is shown to you rather than
              slipped in behind the deposit.
            </Note>
          </div>
        ) : null}

        <div className="mt-7 flex flex-wrap gap-3">
          {needsApproval ? (
            <ActionButton
              onClick={() => runner.request(approvalIntent())}
              disabled={!pre.ok || !writes.ready}
              aria-describedby="earn-blocked"
              icon={<ArrowRight className="size-4" />}
            >
              Approve {formatMusd(wei)}
            </ActionButton>
          ) : null}
          <ActionButton
            variant={needsApproval ? 'secondary' : 'primary'}
            onClick={() => runner.request(intent())}
            disabled={!pre.ok || needsApproval || !writes.ready}
            aria-describedby="earn-blocked"
            icon={<ArrowRight className="size-4" />}
          >
            {mode === 'deposit' ? 'Deposit into Earn' : 'Withdraw from Earn'}
          </ActionButton>
        </div>
      </AppCard>

      {/* The risk statement stays. It is the one thing a depositor cannot infer from the
          screen: this is not a savings account, and the principal is at risk. */}
      <Note>
        <p>Your MUSD absorbs liquidated debt. It is not principal-protected, and not guaranteed.</p>
        <Info summary="What that means in practice">
          Stability Pool deposits are spent closing other people’s positions, and you are paid in
          the Bitcoin seized doing it. Historically profitable, but not guaranteed. The vault also
          holds Bitcoin it has not yet converted, so its share price moves with BTC until a swap
          route Maren has reviewed exists on Mezo.
        </Info>
      </Note>

      <TxSheet runner={runner} />
    </div>
  );
}
