'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { formatMusd } from '@maren/sdk';

import { AmountField, Segmented } from '@/components/app/controls';
import { Fact, FactGroup } from '@/components/app/facts';
import { Btc, Dash, Musd, Num } from '@/components/app/money';
import {
  ActionButton,
  AppLoading,
  EmptyState,
  Info,
  Note,
  PageHeader,
  Panel,
  Refreshing,
} from '@/components/app/primitives';
import { TxSheet, useTxRunner, type TxIntent } from '@/components/app/tx';
import { ArrowRight } from '@/components/ui/icons';
import { ConnectPrompt } from '@/components/app/connect-prompt';
import { EarnIcon } from '@/components/ui/icons';
import { BlockedNote } from '@/components/app/blocked';
import { parseUnitsSafe, timeAgo } from '@/lib/copy';
import { preflightEarnWithdraw, preflightMusdSpend } from '@/lib/chain/preflight';
import { actionIsRelayable } from '@/lib/chain/relay';
import {
  gasLine,
  gasNote,
  SPENDERS,
  useMarenWrites,
  useMusdAllowance,
  useRelayerStatus,
} from '@/lib/chain/write';
import { useBalances, useDataSource, useEarn } from '@/lib/data/source';
import type { EarnPosition } from '@/lib/data/types';

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
  const earnQ = useEarn();
  const balancesQ = useBalances();
  const earn = earnQ.data;
  const balances = balancesQ.data;
  const runner = useTxRunner();
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const relayer = useRelayerStatus();
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
        value: <span className="mono text-text-muted break-all text-xs">{SPENDERS.earn}</span>,
      },
    ],
    gas: {
      sponsored: false,
      note: 'Approves exactly this amount, not an unlimited allowance. You pay the Bitcoin gas.',
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
    gas: gasNote(
      actionIsRelayable(mode === 'deposit' ? 'earnDeposit' : 'earnWithdraw'),
      'Moves MUSD between your wallet and the Stability Pool.',
      relayer,
    ),
    confirmLabel: mode === 'deposit' ? 'Deposit' : 'Withdraw',
    submit: writes.ready
      ? () => (mode === 'deposit' ? writes.earnDeposit(wei) : writes.earnWithdraw(wei))
      : undefined,
  });

  /**
   * At `/app/earn` this is a screen with its own title. Inside Finance's tab panel the
   * Finance header and the tab already name it, and a second `h1` would give the page two
   * titles. A page module cannot take props, so the route says which of the two it is.
   */
  const standalone = usePathname() === '/app/earn';
  const header = standalone ? <PageHeader eyebrow="[ Earn ]" title="Idle MUSD" /> : null;

  if (!source.connected) {
    return (
      <Screen header={header}>
        <Group>
          <ConnectPrompt icon={<EarnIcon className="size-6" />} title="Connect to use Earn">
            {/* Carries the contrast hook while disconnected, so the muted-on-card worst case
              is still measured on this route. The connected screen has its own. */}
            <span data-contrast="earn-disclosure">
              Your MUSD sits in the Stability Pool and is paid in the Bitcoin seized when somebody
              else is liquidated. Maren does not display an APY for Earn, because that return can be
              zero for months.
            </span>
          </ConnectPrompt>

          <RiskNote />
        </Group>
      </Screen>
    );
  }

  // Earn's own figures have not landed yet: hold the layout with skeletons rather than a
  // 0.00 MUSD balance that reads as a real, empty position.
  const firstLoad = source.ready && (earnQ.isLoading || balancesQ.isLoading);
  const refreshing = source.ready && !firstLoad && (earnQ.isFetching || balancesQ.isFetching);

  if (firstLoad) {
    return (
      <Screen header={header}>
        <AppLoading panels={[2, 3, 3]} />
      </Screen>
    );
  }

  return (
    <Screen header={header}>
      <Panel title="Your balance in Earn" meta={refreshing ? <Refreshing /> : null}>
        <div className="px-5 py-5">
          <div className="flex flex-wrap items-baseline gap-2.5">
            {earn ? (
              <Num size="xl">{formatMusd(earn.assetsWei, { unit: false })}</Num>
            ) : (
              <Dash size="xl" />
            )}
            <span className="text-text-muted text-lg">MUSD</span>
          </div>
        </div>
        {/* Only once there is something to compare the balance against. Repeating
            "0.00 MUSD" directly beneath a 0.00 MUSD headline is a row that carries no
            information. */}
        {!earn || earn.depositedWei > 0n ? (
          <div className="border-t border-[var(--border-hairline)]">
            <FactGroup layout="rows">
              <Fact
                label="Deposited"
                caption="everything you have put in"
                value={earn ? <Musd wei={earn.depositedWei} /> : <Dash />}
              />
            </FactGroup>
          </div>
        ) : null}
      </Panel>

      {/* ------------------------------------------------------------- Actions */}
      <Group>
        <div>
          <Segmented
            options={[
              { key: 'deposit' as const, label: 'Deposit' },
              { key: 'withdraw' as const, label: 'Withdraw' },
            ]}
            value={mode}
            onChange={setMode}
            label="Earn action"
          />

          <div className="mt-3">
            <Panel title={mode === 'deposit' ? 'Move into Earn' : 'Move back to spendable'}>
              <div className="px-5 py-5">
                <div className="max-w-[520px]">
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
              </div>

              <div className="border-t border-[var(--border-hairline)]">
                <FactGroup layout="rows">
                  <Fact
                    label={mode === 'deposit' ? 'In Earn after' : 'Spendable after'}
                    value={<Musd wei={mode === 'deposit' ? inEarn + wei : spendable + wei} />}
                  />
                </FactGroup>
              </div>

              <div className="flex flex-col gap-4 border-t border-[var(--border-hairline)] px-5 py-5">
                {/* The preflight's refusal, beside the button it disables. `rangeDead` means
                  no amount can work, which is a status rather than an error about this
                  input. */}
                {pre.blocker && !(pre.blocker.scope === 'input' && wei === 0n) ? (
                  <BlockedNote
                    blocker={pre.blocker}
                    id="earn-blocked"
                    role={pre.rangeDead ? 'status' : 'alert'}
                  />
                ) : null}

                {pre.ok && needsApproval ? (
                  <Note>
                    Earn needs an allowance for {formatMusd(wei)} first. That is a separate
                    transaction, shown here rather than slipped in behind the deposit.
                  </Note>
                ) : null}

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
                  {needsApproval ? (
                    <ActionButton
                      onClick={() => runner.request(approvalIntent())}
                      disabled={!pre.ok || !writes.ready}
                      aria-describedby="earn-blocked"
                      icon={<ArrowRight className="size-4" />}
                      className="w-full sm:w-auto"
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
                    className="w-full sm:w-auto"
                  >
                    {mode === 'deposit' ? 'Deposit into Earn' : 'Withdraw from Earn'}
                  </ActionButton>
                  {/* MarenEarn is not on MarenRelayHub's allowlist, so this line does not
                    change when a relayer comes up. Said in those words rather than borrowed
                    from the "no relayer yet" sentence, which would imply it will. */}
                  <span className="text-text-muted max-w-[52ch] text-xs leading-relaxed">
                    {gasLine(
                      actionIsRelayable(mode === 'deposit' ? 'earnDeposit' : 'earnWithdraw'),
                      relayer,
                    )}
                  </span>
                </div>
              </div>
            </Panel>
          </div>
        </div>

        {/* The risk statement stays, directly under the control it qualifies. It is the one
          thing a depositor cannot infer from the screen: this is not a savings account,
          and the principal is at risk. */}
        <RiskNote detail />
      </Group>

      {/* --------------------------------------------- Trailing realised yield */}
      {/* A window of zero days is not a window. Reporting "0.00 MUSD realised over 0
          days" to someone who has never deposited states the result of an experiment
          they did not run, which is the same dishonesty as a forward APY, backdated. */}
      <Group>
        {earn && earn.trailing.windowDays === 0 ? (
          <Panel title="Realised return">
            <div className="px-5 py-6">
              <EmptyState title="No return to report yet">
                Returns appear here once you have deposited and a liquidation has been absorbed.
              </EmptyState>
            </div>
          </Panel>
        ) : (
          <Panel
            title={`Realised over the last ${earn?.trailing.windowDays ?? 90} days`}
            meta={<span className="text-text-muted text-[0.8125rem]">Backward-looking</span>}
          >
            <div className="px-5 py-5">
              <div className="flex flex-wrap items-baseline gap-2.5">
                {earn ? (
                  <Num size="xl">{formatMusd(earn.trailing.realisedWei, { unit: false })}</Num>
                ) : (
                  <Dash size="xl" />
                )}
                <span className="text-text-muted text-lg">MUSD</span>
              </div>

              {/* The disclosure that makes the number honest. Not a footnote, not a
                  tooltip: it sits directly under the figure it qualifies. One sentence;
                  the mechanism behind it sits one click down rather than being deleted. */}
              <p
                data-contrast="earn-disclosure"
                className="text-text-muted mt-4 max-w-[68ch] text-pretty text-sm leading-relaxed"
              >
                Realised in the past, not a forecast, and this is the whole vault’s gain rather than
                your slice of it. Maren does not display an APY for Earn because there is no
                reliable one to display.
              </p>
              <Info summary="Why there is no rate">
                The MUSD Stability Pool has no token emissions. Its entire yield is the Bitcoin
                seized in liquidations, sold and compounded back into MUSD, so whether it pays at
                all depends on whether anyone gets liquidated. Returns arrive in lumps and can be
                zero for months, and annualising three events in ninety days would be a lie with a
                percent sign on it.
              </Info>
            </div>

            {earn ? (
              <div className="border-t border-[var(--border-hairline)]">
                <FactGroup>
                  <Fact
                    label="Liquidation events"
                    value={<Num>{earn.trailing.liquidationEvents}</Num>}
                    caption="in this window"
                  />
                  <Fact
                    label="Most recent gain"
                    value={
                      <Num>
                        {earn.trailing.lastGainAt ? timeAgo(earn.trailing.lastGainAt) : 'none yet'}
                      </Num>
                    }
                    caption="gains are lumpy"
                  />
                  <Fact label="Forward rate" value={<Dash />} caption="we would be making it up" />
                </FactGroup>
              </div>
            ) : null}
          </Panel>
        )}

        {/* ----------------------------------------------------- What backs Earn */}
        {/* The vault's live composition from assetBreakdown(). It exists because a
            Stability-Pool share is not always MUSD: liquidations pay in Bitcoin, and the
            vault holds that Bitcoin until a reviewed swap route exists. Showing the split
            is the honest version of "your deposit is safe": most of it is MUSD in the
            pool, some of it may be seized Bitcoin whose dollar value moves. */}
        {earn ? <EarnBacking earn={earn} /> : null}
      </Group>

      <TxSheet runner={runner} />
    </Screen>
  );
}

/**
 * The screen's single column: your balance, the controls with their risk statement, then
 * how Earn pays and what backs it. Groups sit 40px apart, cards inside a group 16px.
 */
function Screen({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div>
      {header}
      <div className="flex flex-col gap-10">{children}</div>
    </div>
  );
}

/** Cards that belong together inside one group. */
function Group({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

/**
 * Earn's risk statement. The same sentence disconnected and connected, so it cannot be on
 * one and quietly missing from the other; connected, the mechanism sits one click down.
 */
function RiskNote({ detail = false }: { detail?: boolean }) {
  return (
    <Note>
      <p>Your MUSD absorbs liquidated debt. It is not principal-protected, and not guaranteed.</p>
      {detail ? (
        <Info summary="What that means in practice">
          Stability Pool deposits are spent closing other people’s positions, and you are paid in
          the Bitcoin seized doing it. Historically profitable, but not guaranteed. The vault also
          holds Bitcoin it has not yet converted, so its share price moves with BTC until a swap
          route Maren has reviewed exists on Mezo.
        </Info>
      ) : null}
    </Note>
  );
}

/**
 * What backs Earn — the vault's real composition, read live from `assetBreakdown()`.
 *
 * Vault-wide, and it says so: this is what stands behind every share, not the caller's
 * personal slice. The Stability-Pool MUSD is the calm majority; the seized Bitcoin is the
 * honest asterisk, because it is the one asset here whose dollar value moves and whose
 * dollar value the vault cannot always price. When `isUsingStalePrice()` is true the
 * exact Bitcoin amount is still shown, since that number does not depend on the oracle,
 * but no MUSD figure is presented as authoritative for it.
 */
function EarnBacking({ earn }: { earn: EarnPosition }) {
  const b = earn.breakdown;
  const btcTotal = b.btcHeldWei + b.btcPendingWei;
  const seized = btcTotal > 0n || b.btcValuedWei > 0n;

  return (
    <Panel title="What backs Earn">
      <div className="px-5 py-5">
        <p className="text-text-muted max-w-[68ch] text-pretty text-sm leading-relaxed">
          Your MUSD sits in the MUSD Stability Pool, which closes other people’s positions and is
          paid in the Bitcoin seized doing it. This is the vault’s live composition, not your slice
          of it.
        </p>
      </div>

      <div className="border-t border-[var(--border-hairline)]">
        <FactGroup layout="rows">
          <Fact
            label="Backing the pool"
            caption="MUSD absorbing liquidated debt"
            value={<Musd wei={b.musdInPoolWei} />}
          />
          {b.musdIdleWei > 0n ? (
            <Fact
              label="Idle MUSD"
              caption="held by the vault, not yet in the pool"
              value={<Musd wei={b.musdIdleWei} />}
            />
          ) : null}
          {seized ? (
            <Fact
              label="Bitcoin seized at liquidation"
              value={<Btc wei={btcTotal} tone="btc" />}
              caption={
                earn.stalePrice ? (
                  'dollar value withheld while the oracle price is stale'
                ) : (
                  <span className="inline-flex items-baseline gap-1">
                    worth about <Musd wei={b.btcValuedWei} size="sm" tone="muted" />
                  </span>
                )
              }
            />
          ) : null}
        </FactGroup>
      </div>

      {/* Only when the value could mislead. A precise dollar figure off a stale price is
          exactly the kind of authoritative-looking number this product refuses. */}
      {earn.stalePrice ? (
        <div className="border-t border-[var(--border-hairline)] px-5 py-5">
          <Note tone="warning" role="status">
            The oracle price is stale, so any dollar value for that Bitcoin would be understated.
            Maren shows the Bitcoin amount, which is exact, and holds back a dollar figure until a
            fresh price is available.
          </Note>
        </div>
      ) : null}
    </Panel>
  );
}
