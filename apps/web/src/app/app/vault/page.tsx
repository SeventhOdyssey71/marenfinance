'use client';

import { useMemo, useState } from 'react';
import {
  BORROWING_RATE,
  LIQUIDATION_RESERVE,
  MAREN_POLICY,
  MAREN_VAULT,
  MIN_NET_DEBT,
  assessBorrowRoute,
  borrowCeiling,
  directTroveThreshold,
  formatApr,
  formatBtc,
  formatCollateralRatio,
  formatMusd,
  formatUsd,
  INTEREST_RATE_BPS,
  previewBorrow,
  recommendedBorrow,
} from '@maren/sdk';

import { BlockedNote } from '@/components/app/blocked';
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
import { TxSheet, useTxRunner, type TxIntent, type TxRunner } from '@/components/app/tx';
import { ArrowRight, VaultIcon } from '@/components/ui/icons';
import { ConnectPrompt } from '@/components/app/connect-prompt';
import { ProtocolPanel } from '@/components/app/protocol-panel';
import {
  preflightBorrow,
  preflightDeposit,
  preflightRepay,
  preflightWithdraw,
  type Preflight,
  type VaultState,
} from '@/lib/chain/preflight';
import { gasNote, SPENDERS, useMarenWrites, useMusdAllowance } from '@/lib/chain/write';
import {
  useBalances,
  useDataSource,
  usePosition,
  usePrice,
  useProtocolStats,
} from '@/lib/data/source';
import { parseUnitsSafe } from '@/lib/copy';
import { healthLabel, healthTone, policyRatio, toneClasses } from '@/lib/health';

type Mode = 'deposit' | 'borrow' | 'repay' | 'withdraw';

const MODES = [
  { key: 'deposit' as const, label: 'Deposit' },
  { key: 'borrow' as const, label: 'Borrow' },
  { key: 'repay' as const, label: 'Repay' },
  { key: 'withdraw' as const, label: 'Withdraw' },
];

/**
 * Vault — deposit BTC, draw MUSD, repay, withdraw.
 *
 * EVERY CONTROL ON THIS SCREEN IS PREFLIGHTED. Before a button is enabled or a slider is
 * given a range, `lib/chain/preflight.ts` evaluates the same conditions `MarenVault.sol`
 * will evaluate, against state read from the chain: the pause flags, the deposit cap, the
 * price feed's staleness, this account's collateral ratio, its borrow ceiling, its wallet
 * balances — and the SHARED trove's ratio, which is the one that matters today and the one
 * no amount of user-side arithmetic finds.
 *
 * The failure that produced this pass: the borrow slider offered a 0–35 MUSD range while
 * the pooled trove sat at 151.05% against the vault's 180% `MIN_TROVE_CR`, so every value
 * on that range reverted. A user dragged it to 17.95, pressed Borrow, paid the gas, and
 * got the refusal. The refusal was already readable, for free, from a contract this page
 * had already called.
 *
 * Every figure in the live preview comes from `@maren/sdk` — `borrowCeiling`,
 * `recommendedBorrow`, `previewBorrow`, `maxWithdrawable`. There is no arithmetic in this
 * file that touches a user's risk.
 */
export default function VaultPage() {
  const [chosen, setChosen] = useState<Mode | null>(null);
  const source = useDataSource();
  const price = usePrice();
  const { data: position } = usePosition();
  const { data: balances } = useBalances();
  const { data: stats } = useProtocolStats();
  const runner = useTxRunner();

  const livePrice = price.state === 'live' ? price.priceWei : null;

  /**
   * Everything the preflight needs, gathered once.
   *
   * Passed down rather than re-read per panel so that all four controls are judging the
   * same block. Two panels disagreeing about whether the oracle is live — because one
   * re-read a second later — is a class of bug worth designing out.
   */
  const chain: VaultState = { price, position, balances, stats };

  /**
   * No wallet, no vault screen.
   *
   * Everything below — the position card, the borrow slider, the withdrawal ceiling — is a
   * function of an account. There used to be a demo account standing in for one, which
   * meant a visitor could drag a borrow slider that was attached to nothing. What they get
   * instead is the reason to connect, and the shared trove's real numbers underneath it.
   */
  if (!source.connected) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <Label>Vault</Label>
          <h1 className="t-h2 mt-2">Bitcoin credit</h1>
          <p className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed">
            Borrow MUSD against Bitcoin without selling it.
          </p>
        </div>

        <ConnectPrompt icon={<VaultIcon className="size-6" />} title="Connect to open a position">
          {/* `data-contrast` is verify-contrast's hook for muted body copy on a card
              surface, which is this token's worst case. It lives on whichever copy is
              actually on screen — here while disconnected, and on the borrow panel once
              a position exists — so the measurement never silently stops happening. */}
          <span data-contrast="route-body">
            Deposit Bitcoin as collateral and draw MUSD against it at {formatApr(INTEREST_RATE_BPS)}
            , fixed. The minimum deposit is {formatBtc(MAREN_VAULT.minDeposit)}.
          </span>
        </ConnectPrompt>

        <ProtocolPanel />
      </div>
    );
  }

  const empty = position !== undefined && position.collateralWei === 0n && position.debtWei === 0n;

  /**
   * A wallet with nothing in it can only do one thing here, so that is the tab it lands
   * on. Deriving the default rather than seeding `useState` means it settles correctly
   * once the position arrives, while an explicit choice still wins.
   */
  const mode: Mode = chosen ?? (empty ? 'deposit' : 'borrow');

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
        <BorrowPanel runner={runner} chain={chain} onDeposit={() => setChosen('deposit')} />
      ) : null}
      {mode === 'deposit' ? <DepositPanel runner={runner} chain={chain} /> : null}
      {mode === 'repay' ? <RepayPanel runner={runner} chain={chain} /> : null}
      {mode === 'withdraw' ? <WithdrawPanel runner={runner} chain={chain} /> : null}

      <TxSheet runner={runner} />
    </div>
  );
}

/**
 * Whether a blocker is worth putting on screen.
 *
 * An empty amount field is not a refusal, it is a form nobody has filled in yet. Saying
 * "Amount is zero" under a blank input is noise, and noise is how a genuinely important
 * refusal — the pooled trove being under its floor — gets skimmed past. The button stays
 * disabled either way.
 */
function worthStating(pre: Preflight, amountWei: bigint): boolean {
  if (!pre.blocker) return false;
  return !(pre.blocker.scope === 'input' && amountWei === 0n);
}

/** The short form for the amount field itself, when the problem is the amount. */
function fieldError(pre: Preflight, amountWei: bigint): string | null {
  if (!pre.blocker || amountWei === 0n) return null;
  return pre.blocker.scope === 'input' || pre.blocker.scope === 'wallet' ? pre.blocker.title : null;
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
  chain,
  onDeposit,
}: {
  runner: TxRunner;
  chain: VaultState;
  onDeposit: () => void;
}) {
  const { position, price, stats } = chain;
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const livePrice = price.state === 'live' ? price.priceWei : null;

  const ceiling = useMemo(
    () => (position && livePrice ? borrowCeiling(position, livePrice) : null),
    [position, livePrice],
  );
  const recommended = useMemo(
    () =>
      position && livePrice && ceiling
        ? recommendedBorrow(position, livePrice, ceiling.amountWei)
        : 0n,
    [position, livePrice, ceiling],
  );

  const [amount, setAmount] = useState<bigint | null>(null);

  /**
   * The whole-range check runs FIRST, with a zero amount, because its answer decides
   * whether an amount is a meaningful thing to have at all. When the pooled trove is under
   * its floor there is no borrow to preview, no ratio to colour and no slider to drag, and
   * seeding the control from `recommendedBorrow` would put a number on screen that cannot
   * be borrowed.
   */
  const range = preflightBorrow(chain, 0n);
  const value = range.rangeDead ? 0n : (amount ?? recommended);
  const pre = range.rangeDead ? range : preflightBorrow(chain, value);

  const preview = useMemo(
    () =>
      position && livePrice && !range.rangeDead ? previewBorrow(position, livePrice, value) : null,
    [position, livePrice, value, range.rangeDead],
  );

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
    successTitle: `Borrowed ${formatMusd(value)}`,
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
    changes:
      position && preview
        ? [
            {
              label: 'Total debt',
              before: <Musd wei={position.debtWei} />,
              after: <Musd wei={preview.debtWei} />,
            },
            {
              label: 'Collateral ratio',
              before: (
                <RatioOrDash
                  cr={
                    livePrice && position.debtWei > 0n
                      ? (position.collateralWei * livePrice) / position.debtWei
                      : 0n
                  }
                  debtWei={position.debtWei}
                />
              ),
              after: <RatioOrDash cr={preview.collateralRatio} debtWei={preview.debtWei} />,
            },
          ]
        : undefined,
    gas:
      position?.route === 'pooled'
        ? gasNote(true, 'Draws MUSD against Maren’s pooled trove.')
        : {
            sponsored: false,
            note: 'Costs BTC gas. Maren does not sponsor direct-trove operations.',
          },
    caution: belowRecommendation
      ? `Bitcoin would only need to fall ${dropPercent}% to liquidate this position.`
      : undefined,
    confirmLabel: `Borrow ${formatMusd(value)}`,
    submit: writes.ready ? () => writes.borrowMusd(value) : undefined,
  });

  /**
   * Nothing to borrow against. The slider, the preview and the fee breakdown are all
   * functions of a position that does not exist, so none of them render.
   *
   * BOTH facts are stated, not just the nearer one. `preflightBorrow` reports the pooled
   * trove's floor before it reports an empty position, deliberately — it is the constraint
   * that survives whatever the user does next — and it would be a poor trade to send
   * someone off to deposit Bitcoin without mentioning that borrowing is closed anyway when
   * they get back.
   */
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
        {range.blocker && range.blocker.scope === 'pool' ? (
          <div className="mt-2">
            <BlockedNote blocker={range.blocker} />
          </div>
        ) : null}
      </AppCard>
    );
  }

  return (
    <AppCard className="p-6 md:p-8">
      <CardTitle>Borrow MUSD</CardTitle>
      {/* `data-contrast` is verify-contrast's hook for muted body copy on a card surface,
          which is the worst case for this token. */}
      <p
        data-contrast="route-body"
        className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed"
      >
        {formatApr(INTEREST_RATE_BPS)}, fixed for the life of this loan.
      </p>

      {/*
        THE REFUSAL COMES FIRST WHEN NOTHING CAN SUCCEED.

        This copy used to live in a modal, after the user had paid for the revert that
        produced it. When the whole range is unreachable it belongs here — above the
        slider, before anything has been touched — because its entire content is "do not
        bother touching this, and here is why it is not your fault". `role="status"`
        rather than `alert`: it is present on first paint, and an alert that fires the
        instant a screen reader lands on the Vault is an interruption, not information.
      */}
      {range.blocker && range.rangeDead ? (
        <div className="mt-6">
          <BlockedNote blocker={range.blocker} id="borrow-blocked" />
        </div>
      ) : null}

      <div className="mt-8">
        <Label>You borrow</Label>
        <div className="mt-3 flex items-baseline gap-3">
          <Num size="xl" tone={range.rangeDead ? 'subtle' : 'default'}>
            {formatMusd(value, { unit: false })}
          </Num>
          <span className="t-h3 text-text-muted">MUSD</span>
        </div>
      </div>

      <div className="mt-6">
        <AmountSlider
          value={value}
          /* Zero, not the ratio headroom, when nothing can be borrowed. A track that can
             be dragged to 35 MUSD while every value on it reverts is a control that lies
             about what the product can do. */
          max={range.rangeDead ? 0n : (ceiling?.amountWei ?? 0n)}
          onChange={setAmount}
          disabled={range.rangeDead}
          describedBy={range.rangeDead ? 'borrow-blocked' : undefined}
          label="Amount to borrow"
          describeValue={(v) =>
            range.rangeDead
              ? `Borrowing is unavailable: ${range.blocker?.title ?? 'no amount can succeed'}`
              : `${formatMusd(v)} of a maximum ${formatMusd(ceiling?.amountWei ?? 0n)}`
          }
          marker={
            range.rangeDead
              ? undefined
              : {
                  at: recommended,
                  label: `Recommended · ${policyRatio(MAREN_POLICY.targetCr)}`,
                  onSelect: () => setAmount(recommended),
                }
          }
          endLabels={{
            start: '0 MUSD',
            end: range.rangeDead ? '0 MUSD' : formatMusd(ceiling?.amountWei ?? 0n, { unit: false }),
          }}
        />
      </div>

      {ceiling && ceiling.amountWei > 0n && !range.rangeDead ? (
        <p className="text-text-subtle mt-4 text-xs leading-relaxed">
          {ceiling.binding === 'ceiling'
            ? `Capped by Mezo’s per-trove ceiling — ${formatMusd(ceiling.mezoHeadroomWei)} of it is unused. Your ratio would allow ${formatMusd(ceiling.ratioHeadroomWei)}.`
            : `Capped by Maren’s ${policyRatio(MAREN_POLICY.minHealthyCr)} floor. Mezo’s ceiling would allow ${formatMusd(ceiling.mezoHeadroomWei)}.`}
        </p>
      ) : null}

      {/* The shared trove's own figure, stated beside the refusal it causes. Without it
          the explanation above is an assertion; with it, anyone can check it. */}
      {range.rangeDead && stats ? (
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
          <Metric
            label="Shared trove ratio"
            value={
              <Num size="lg" className="text-warning" tone="inherit">
                {formatCollateralRatio(stats.troveIcrWei)}
              </Num>
            }
            caption={`must be at or above ${policyRatio(MAREN_VAULT.minTroveCr)} for anyone to borrow`}
          />
          <Metric
            label="Your collateral"
            value={position ? <Btc wei={position.collateralWei} size="lg" /> : <Dash size="lg" />}
            caption="untouched, and withdrawable"
          />
          <Metric
            label="Your debt"
            value={position ? <Musd wei={position.debtWei} size="lg" /> : <Dash size="lg" />}
            caption="unaffected by the pool’s ratio"
          />
        </div>
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

      {/* The gas claim, kept true. Maren's relay hub is deployed but no relayer service
          is running, so "no gas" would be a promise the product cannot currently keep. */}
      <p className="text-text-subtle mt-6 text-xs leading-relaxed">
        Costs BTC gas — Maren’s relayer is not running yet, so your own wallet submits this.
      </p>

      {/* A blocker that is about THIS amount rather than the whole range sits by the
          button, which is where the user is looking when they find out. */}
      {!range.rangeDead && worthStating(pre, value) && pre.blocker ? (
        <div className="mt-5">
          <BlockedNote blocker={pre.blocker} id="borrow-amount-blocked" role="alert" />
        </div>
      ) : null}

      <div className="mt-7">
        <ActionButton
          onClick={() => runner.request(intent())}
          disabled={!pre.ok || !writes.ready}
          aria-describedby={range.rangeDead ? 'borrow-blocked' : 'borrow-amount-blocked'}
          icon={<ArrowRight className="size-4" />}
        >
          {value > 0n ? `Borrow ${formatMusd(value)}` : 'Borrow'}
        </ActionButton>
      </div>
    </AppCard>
  );
}

function DepositPanel({ runner, chain }: { runner: TxRunner; chain: VaultState }) {
  const { position, price } = chain;
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const [input, setInput] = useState('0.05');
  const wei = parseUnitsSafe(input);
  const livePrice = price.state === 'live' ? price.priceWei : null;

  const pre = preflightDeposit(chain, wei);

  const routeAfter =
    livePrice && position
      ? assessBorrowRoute(
          position.collateralWei + wei,
          livePrice,
          MAREN_POLICY.targetCr,
          BORROWING_RATE,
        )
      : null;

  const intent = (): TxIntent => ({
    title: `Deposit ${formatBtc(wei)}`,
    successTitle: `Deposited ${formatBtc(wei)}`,
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
    changes: position
      ? [
          {
            label: 'Your collateral',
            before: <Btc wei={position.collateralWei} />,
            after: <Btc wei={position.collateralWei + wei} />,
          },
          ...(livePrice
            ? [
                {
                  label: 'Collateral value',
                  before: <Num>{formatUsd((position.collateralWei * livePrice) / 10n ** 18n)}</Num>,
                  after: (
                    <Num>
                      {formatUsd(((position.collateralWei + wei) * livePrice) / 10n ** 18n)}
                    </Num>
                  ),
                },
              ]
            : []),
        ]
      : undefined,
    gas: {
      // Not routed through `gasNote`: a deposit is unsponsorable by construction, not by
      // the accident of the relayer being down. It carries BTC with the call and
      // MarenRelayHub reverts with ValueNotRelayable() on any request with value.
      sponsored: false,
      note: 'A deposit carries Bitcoin with the call, which the relay hub refuses by design. You pay the BTC gas for this one.',
    },
    confirmLabel: `Deposit ${formatBtc(wei)}`,
    submit: writes.ready ? () => writes.depositBtc(wei) : undefined,
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
          max={pre.maxWei > 0n ? <Btc wei={pre.maxWei} size="sm" /> : undefined}
          maxLabel="Most you can deposit"
          onMax={() => setInput(formatBtc(pre.maxWei, { unit: false }).replace(/,/g, ''))}
          presets={[
            { label: '0.001 BTC', value: '0.001' },
            { label: '0.01 BTC', value: '0.01' },
            { label: '0.05 BTC', value: '0.05' },
            { label: '0.1 BTC', value: '0.1' },
          ]}
          error={fieldError(pre, wei)}
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

      {worthStating(pre, wei) && pre.blocker ? (
        <div className="mt-5">
          <BlockedNote
            blocker={pre.blocker}
            id="deposit-blocked"
            role={pre.rangeDead ? 'status' : 'alert'}
          />
        </div>
      ) : null}

      <div className="mt-7">
        <ActionButton
          onClick={() => runner.request(intent())}
          disabled={!pre.ok || !writes.ready}
          aria-describedby="deposit-blocked"
          icon={<ArrowRight className="size-4" />}
        >
          Deposit {wei > 0n ? formatBtc(wei) : ''}
        </ActionButton>
      </div>
    </AppCard>
  );
}

function RepayPanel({ runner, chain }: { runner: TxRunner; chain: VaultState }) {
  const { position, balances } = chain;
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const [input, setInput] = useState('500');
  const wei = parseUnitsSafe(input);

  const balance = balances?.musdWei ?? 0n;
  const pre = preflightRepay(chain, wei);

  /**
   * Repaying pulls MUSD with `transferFrom`, so the vault needs an allowance first.
   *
   * That approval is its own transaction and is shown as its own step. Folding it into
   * the repay would mean one press produced two wallet prompts, and the second one would
   * be the only one anybody checked a receipt for.
   */
  const {
    allowanceWei,
    needed: needsApproval,
    refetch: refetchAllowance,
  } = useMusdAllowance(SPENDERS.vault, wei);

  const approvalIntent = (): TxIntent => ({
    title: `Approve ${formatMusd(wei)} for the vault`,
    successTitle: `Approved ${formatMusd(wei)}`,
    details: [
      { label: 'Token', value: <span className="text-text-muted">MUSD</span> },
      { label: 'Amount', value: <Musd wei={wei} /> },
      {
        label: 'Spender',
        value: <span className="num text-text-subtle break-all text-xs">{SPENDERS.vault}</span>,
      },
    ],
    changes: [
      {
        label: 'Vault allowance',
        before: <Musd wei={allowanceWei ?? 0n} />,
        after: <Musd wei={wei} />,
      },
    ],
    gas: {
      sponsored: false,
      note: 'An ERC-20 approval is a transaction on MUSD itself, not on Maren, so it cannot be relayed through Maren’s hub. It approves exactly this amount, not an unlimited allowance.',
    },
    confirmLabel: 'Approve',
    submit: writes.ready
      ? async () => {
          const hash = await writes.approveMusd(SPENDERS.vault, wei);
          refetchAllowance();
          return hash;
        }
      : undefined,
  });

  const debtAfter = position ? (position.debtWei > wei ? position.debtWei - wei : 0n) : 0n;

  const intent = (): TxIntent => ({
    title: `Repay ${formatMusd(wei)}`,
    successTitle: `Repaid ${formatMusd(wei)}`,
    details: [
      { label: 'Repaying', value: <Musd wei={wei} /> },
      {
        label: 'Debt after',
        value: position ? <Musd wei={debtAfter} /> : <Dash />,
      },
    ],
    changes: position
      ? [
          {
            label: 'Your debt',
            before: <Musd wei={position.debtWei} />,
            after: <Musd wei={debtAfter} />,
          },
          {
            label: 'MUSD in your wallet',
            before: <Musd wei={balance} />,
            after: <Musd wei={balance > wei ? balance - wei : 0n} />,
          },
        ]
      : undefined,
    gas: gasNote(
      true,
      'Repaying is never paused and never gated on the oracle — an exit must always be open.',
    ),
    confirmLabel: `Repay ${formatMusd(wei)}`,
    submit: writes.ready ? () => writes.repayMusd(wei) : undefined,
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
          error={fieldError(pre, wei)}
        />
      </div>

      <p className="text-text-subtle mt-6 text-xs leading-relaxed">
        Repay needs no price, so it stays open when the oracle is stale.
      </p>

      {worthStating(pre, wei) && pre.blocker ? (
        <div className="mt-5">
          <BlockedNote
            blocker={pre.blocker}
            id="repay-blocked"
            role={pre.rangeDead ? 'status' : 'alert'}
          />
        </div>
      ) : null}

      {pre.ok && needsApproval ? (
        <div className="mt-6">
          <Note>
            The vault has to be allowed to take {formatMusd(wei)} of your MUSD before it can be
            repaid. That is one approval transaction, and it is shown to you rather than slipped in
            behind the repay.
          </Note>
        </div>
      ) : null}

      <div className="mt-7 flex flex-wrap gap-3">
        {needsApproval ? (
          <ActionButton
            onClick={() => runner.request(approvalIntent())}
            disabled={!pre.ok || !writes.ready}
            aria-describedby="repay-blocked"
            icon={<ArrowRight className="size-4" />}
          >
            Approve {formatMusd(wei)}
          </ActionButton>
        ) : null}
        <ActionButton
          variant={needsApproval ? 'secondary' : 'primary'}
          onClick={() => runner.request(intent())}
          disabled={!pre.ok || needsApproval || !writes.ready}
          aria-describedby="repay-blocked"
          icon={<ArrowRight className="size-4" />}
        >
          Repay {wei > 0n ? formatMusd(wei) : ''}
        </ActionButton>
      </div>
    </AppCard>
  );
}

function WithdrawPanel({ runner, chain }: { runner: TxRunner; chain: VaultState }) {
  const { position } = chain;
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  /**
   * Empty, not `0.01`.
   *
   * A seeded default is a guess about how much of their own Bitcoin someone wants back,
   * and this one guessed ten times the collateral the live test account holds — so the
   * panel opened with a red "More than your collateral" error against an action that was
   * perfectly available. A withdrawal is the one number on this screen nobody should be
   * nudged toward; the "Available to withdraw" figure beside the field is one press away
   * and is computed from the position rather than assumed.
   */
  const [input, setInput] = useState('');
  const wei = parseUnitsSafe(input);

  const pre = preflightWithdraw(chain, wei);
  const collateralAfter = position
    ? position.collateralWei > wei
      ? position.collateralWei - wei
      : 0n
    : 0n;

  const intent = (): TxIntent => ({
    title: `Withdraw ${formatBtc(wei)}`,
    successTitle: `Withdrew ${formatBtc(wei)}`,
    details: [
      { label: 'Collateral out', value: <Btc wei={wei} /> },
      {
        label: 'Collateral after',
        value: position ? <Btc wei={collateralAfter} /> : <Dash />,
      },
    ],
    changes: position
      ? [
          {
            label: 'Your collateral',
            before: <Btc wei={position.collateralWei} />,
            after: <Btc wei={collateralAfter} />,
          },
        ]
      : undefined,
    gas: gasNote(
      true,
      'Withdrawal is never paused: if Maren halts the vault, entries close and exits stay open.',
    ),
    confirmLabel: `Withdraw ${formatBtc(wei)}`,
    submit: writes.ready ? () => writes.withdrawBtc(wei) : undefined,
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
          max={<Btc wei={pre.maxWei} size="sm" />}
          maxLabel="Available to withdraw"
          onMax={() => setInput(formatBtc(pre.maxWei, { unit: false }).replace(/,/g, ''))}
          error={fieldError(pre, wei)}
        />
      </div>

      {worthStating(pre, wei) && pre.blocker ? (
        <div className="mt-6">
          <BlockedNote
            blocker={pre.blocker}
            id="withdraw-blocked"
            role={pre.rangeDead ? 'status' : 'alert'}
          />
        </div>
      ) : (
        <p className="text-text-subtle mt-6 text-xs leading-relaxed">
          Withdrawal is never paused. If Maren halts the vault, exits stay open.
        </p>
      )}

      <div className="mt-7">
        <ActionButton
          onClick={() => runner.request(intent())}
          disabled={!pre.ok || !writes.ready}
          aria-describedby="withdraw-blocked"
          icon={<ArrowRight className="size-4" />}
        >
          Withdraw {wei > 0n ? formatBtc(wei) : ''}
        </ActionButton>
      </div>
    </AppCard>
  );
}
