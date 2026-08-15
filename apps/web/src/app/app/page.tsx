'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  MAREN_POLICY,
  assessHealth,
  collateralValue,
  formatBtc,
  formatMusd,
  shortAddress,
} from '@maren/sdk';

import { HealthChip, HealthScale } from '@/components/app/health';
import {
  Btc,
  Dash,
  DropToLiquidation,
  LiquidationPrice,
  Musd,
  Ratio,
  Usd,
} from '@/components/app/money';
import { PriceBanner } from '@/components/app/price-banner';
import {
  ActionLink,
  AppCard,
  CardTitle,
  EmptyState,
  Info,
  Label,
  Metric,
  Note,
  StatRow,
} from '@/components/app/primitives';
import { LivePulseFrame } from '@/components/shaders/live-pulse';
import { ArrowRight, EarnIcon, PayIcon, VaultIcon } from '@/components/ui/icons';
import { activityTitle, statusLabel, timeAgo } from '@/lib/copy';
import { healthTone, policyRatio, toneShaderColors } from '@/lib/health';
import { borrowCeiling } from '@/lib/vault';
import {
  useActivity,
  useBalances,
  useDataSource,
  useEarn,
  usePosition,
  usePrice,
  usePrimaryHandle,
} from '@/lib/data/source';

/**
 * Portfolio — the home screen.
 *
 * Position health is the hero, not the balance. Everything above the fold answers one
 * question: how far can Bitcoin fall before this position is liquidated. The collateral
 * ratio, the liquidation price and the drop tolerance are all stated as numbers rather
 * than implied by a colour, and the only coloured element is the health chip.
 *
 * When the price feed is not live the health block is replaced by the price state. There
 * is no "last known health" rendering, because a health figure computed from a stale
 * price is a stale figure wearing a current label.
 *
 * When there is no position at all, none of that applies and none of it renders. An
 * empty account gets one card with one instruction instead of a health hero full of
 * dashes — see `NoPosition` below.
 */
export default function PortfolioPage() {
  const source = useDataSource();
  const price = usePrice();
  const { data: position } = usePosition();
  const { data: balances } = useBalances();
  const { data: earn } = useEarn();
  const { data: activity } = useActivity();
  const { data: handle } = usePrimaryHandle();

  const livePrice = price.state === 'live' ? price.priceWei : null;

  /**
   * The empty account. `debtWei === 0n && collateralWei === 0n` rather than
   * `route === 'none'`, because a user who has deposited but not yet borrowed also has
   * no health to show and must not be quoted a liquidation price.
   */
  const empty = position !== undefined && position.collateralWei === 0n && position.debtWei === 0n;

  const health =
    position && livePrice && !empty
      ? assessHealth(position.collateralWei, position.debtWei, livePrice)
      : null;

  const collateralUsd =
    position && livePrice ? collateralValue(position.collateralWei, livePrice) : null;

  if (empty) return <NoPosition handle={handle ?? null} account={source.account} price={price} />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Label>Account</Label>
          <h1 className="t-h2 mt-2">{handle ?? 'Your position'}</h1>
          <p className="num text-text-subtle mt-2 text-sm">{shortAddress(source.account, 10, 8)}</p>
        </div>
        {price.state === 'live' ? <PriceBanner feed={price} /> : null}
      </div>

      {/* ---------------------------------------------------------------- Hero */}
      {health && position ? (
        <LivePulseFrame colors={toneShaderColors[healthTone[health.status]]}>
          <AppCard className="p-6 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <CardTitle>Position health</CardTitle>
              <HealthChip status={health.status} />
            </div>

            <div className="mt-6 flex flex-wrap items-baseline gap-3">
              <Ratio cr={health.collateralRatio} size="xl" />
              <span className="text-text-subtle text-sm">collateral ratio</span>
            </div>

            <HealthScale collateralRatio={health.collateralRatio} status={health.status} />

            {/* Two derived figures, each in its own track. `Metric` clips rather than
                letting a long value set the column's minimum width — the failure that
                once rendered these two labels on top of one another. */}
            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
              <Metric
                label="Liquidation price"
                value={
                  <LiquidationPrice
                    wei={health.liquidationPrice}
                    debtWei={position.debtWei}
                    size="lg"
                  />
                }
                caption="protocol liquidates at 110%"
              />
              <Metric
                label="Bitcoin can fall"
                value={
                  <DropToLiquidation
                    bps={health.priceDropToLiquidationBps}
                    debtWei={position.debtWei}
                    size="lg"
                  />
                }
                caption="from today’s price"
              />
            </div>

            {!health.canBorrow ? (
              <div className="mt-6 border-t border-[var(--border-hairline)] pt-5">
                <p className="text-text-muted text-sm leading-relaxed" role="status">
                  Borrowing is closed below {policyRatio(MAREN_POLICY.minHealthyCr)}. Repay or add
                  collateral in the{' '}
                  <Link href="/app/vault" className="text-violet-400 hover:text-violet-400/80">
                    Vault
                  </Link>
                  .
                </p>
              </div>
            ) : null}
          </AppCard>
        </LivePulseFrame>
      ) : (
        <AppCard className="p-6 md:p-8">
          <CardTitle>Position health</CardTitle>
          <div className="mt-5">
            <PriceBanner feed={price} />
          </div>
          {position && price.state !== 'loading' ? (
            <p className="text-text-subtle mt-4 max-w-[68ch] text-sm leading-relaxed">
              Your collateral is {formatBtc(position.collateralWei)} against{' '}
              {formatMusd(position.debtWei)} of debt. Health is not shown because it would have to
              be computed from a price the protocol itself would refuse.
            </p>
          ) : null}
        </AppCard>
      )}

      {/* ------------------------------------------------------ Borrow capacity */}
      <BorrowingCapacity />

      {/* ------------------------------------------------------------ Balances */}
      <AppCard>
        <CardTitle>Balances</CardTitle>
        <div className="mt-2">
          <StatRow
            label="Bitcoin collateral"
            value={position ? <Btc wei={position.collateralWei} size="lg" /> : <Dash size="lg" />}
            sub={collateralUsd !== null ? <Usd wei={collateralUsd} size="sm" /> : null}
          />
          <StatRow
            label="MUSD"
            hint="spendable"
            value={balances ? <Musd wei={balances.musdWei} size="lg" /> : <Dash size="lg" />}
          />
          <StatRow
            label="In Earn"
            hint="valued in MUSD"
            value={earn ? <Musd wei={earn.assetsWei} size="lg" /> : <Dash size="lg" />}
          />
          <StatRow
            label="Outstanding debt"
            hint={
              position?.route === 'direct'
                ? 'includes the 200 MUSD liquidation reserve'
                : 'no reserve on the pooled route'
            }
            value={position ? <Musd wei={position.debtWei} size="lg" /> : <Dash size="lg" />}
            sub={
              position ? (
                <span className="text-text-subtle text-xs">
                  {formatMusd(position.interestWei)} interest
                </span>
              ) : null
            }
            last
          />
        </div>
      </AppCard>

      {/* -------------------------------------------------------------- Actions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <QuickLink
          href="/app/vault"
          label="Vault"
          detail="Deposit, borrow, repay, withdraw"
          icon={<VaultIcon className="size-5" />}
        />
        <QuickLink
          href="/app/pay"
          label="Pay"
          detail="Send, request, or share a link"
          icon={<PayIcon className="size-5" />}
        />
        <QuickLink
          href="/app/earn"
          label="Earn"
          detail="Put idle MUSD to work"
          icon={<EarnIcon className="size-5" />}
        />
      </div>

      {/* ------------------------------------------------------------ Gas truth */}
      {/* The claim and its exception, in two lines. The exception is not optional: a
          deposit carries BTC with the call and the relay hub refuses any request that
          does, so copy promising unconditional gasless would be a lie the contracts
          expose on the user's very first action. */}
      <AppCard>
        <CardTitle>Gas</CardTitle>
        <p
          data-contrast="gas-copy"
          className="text-text-muted mt-4 max-w-[68ch] text-sm leading-relaxed"
        >
          Maren pays the Bitcoin gas for payments, Earn, and pooled borrow, repay and withdraw.
        </p>
        <p className="text-text-muted mt-2 max-w-[68ch] text-sm leading-relaxed">
          <strong className="text-text font-medium">Your first deposit costs gas</strong> — it
          carries Bitcoin with the call, and the relayer cannot sponsor that.
        </p>
        <Info summary="After the free tier">
          Maren sponsors 25 actions per address per month. After that the fee is taken in MUSD
          inside the same transaction and shown before you sign — you are never blocked at the
          door.
        </Info>
      </AppCard>

      {/* ------------------------------------------------------------- Activity */}
      <AppCard>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>Recent activity</CardTitle>
          <Link
            href="/app/activity"
            className="text-text-muted hover:text-text rounded-[var(--radius-pill)] text-sm transition-colors duration-[120ms] ease-out"
          >
            All activity
          </Link>
        </div>
        <div className="mt-2">
          {(activity ?? []).slice(0, 4).map((item, index, list) => (
            <StatRow
              key={item.id}
              label={activityTitle(item.kind, item.counterparty)}
              hint={`${timeAgo(item.at)} · ${statusLabel(item.status)}`}
              value={
                item.musdWei !== undefined ? (
                  <Musd wei={item.musdWei} />
                ) : item.btcWei !== undefined ? (
                  <Btc wei={item.btcWei} />
                ) : (
                  <Dash />
                )
              }
              last={index === Math.min(3, list.length - 1)}
            />
          ))}
          {activity && activity.length === 0 ? (
            <p className="text-text-subtle py-3 text-sm">Nothing yet.</p>
          ) : null}
        </div>
      </AppCard>
    </div>
  );
}

/**
 * Borrowing capacity — the Mezo-specific trap, stated.
 *
 * MUSD fixes a per-trove borrowing ceiling at the price the trove opened at, and adding
 * collateral does NOT raise it; only `refinance()` does. So a user whose Bitcoin has
 * doubled sees better health and still cannot draw more. Showing an ICR-derived headroom
 * as "available to borrow" would be a number that fails on submission with an opaque
 * revert, which is why both figures are shown and the binding one is named.
 */
function BorrowingCapacity() {
  const { data: position } = usePosition();
  const price = usePrice();
  const livePrice = price.state === 'live' ? price.priceWei : null;

  if (!position) {
    return (
      <AppCard>
        <CardTitle>Borrowing capacity</CardTitle>
        <p className="text-text-subtle mt-4 text-sm">Reading your position.</p>
      </AppCard>
    );
  }

  const ceiling = position.maxBorrowingCapacityWei;
  const drawn = position.principalWei;

  // The same computation the Vault's slider is bounded by — one implementation, so the
  // two screens can never quote a user different limits.
  const limits = livePrice === null ? null : borrowCeiling(position, livePrice);
  const mezoHeadroom = limits?.mezoHeadroomWei ?? (ceiling > drawn ? ceiling - drawn : 0n);
  const available = limits?.amountWei ?? null;
  const binding = limits?.binding ?? null;

  return (
    <AppCard>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <CardTitle>Borrowing capacity</CardTitle>
        <span className="t-label text-text-subtle">
          {position.route === 'pooled' ? 'Pooled trove' : 'Direct trove'}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Metric
          label="Available to borrow"
          value={available === null ? <Dash size="lg" /> : <Musd wei={available} size="lg" />}
          caption={
            binding === null
              ? 'needs a live price'
              : binding === 'ceiling'
                ? 'capped by Mezo’s ceiling'
                : binding === 'ratio'
                  ? 'capped by the 180% floor'
                  : 'nothing to draw'
          }
        />
        <Metric
          label="Mezo’s ceiling"
          value={<Musd wei={ceiling} size="lg" />}
          caption="fixed when this trove opened"
        />
        <Metric
          label="Drawn"
          value={<Musd wei={drawn} size="lg" />}
          caption={`${formatMusd(mezoHeadroom)} under the ceiling`}
        />
      </div>

      {/* One clause on the surface. The mechanism — which contract call the ceiling
          comes from, and why adding collateral does not move it — is true, is the
          single most surprising thing about borrowing on Mezo, and is still three
          sentences long, so it sits behind the affordance rather than in the card. */}
      <Info summary="Why the ceiling does not move">
        {position.route === 'pooled' ? (
          <>
            This ceiling belongs to the pooled trove and is shared by everyone inside it. Your own
            limit is Maren’s 180% floor on your share — whichever binds first stops the
            transaction.
          </>
        ) : (
          <>
            Mezo fixes a per-trove ceiling at the price the trove opened at, and reports it from{' '}
            <span className="num">TroveManager.getTroveMaxBorrowingCapacity()</span> rather than
            deriving it from your collateral ratio. Adding collateral does not raise it — only a
            refinance does, which re-fixes the ceiling at today’s price for a fee and is blocked
            while the system is in Recovery Mode.
          </>
        )}
      </Info>

      {position.route === 'direct' && mezoHeadroom === 0n ? (
        <div className="mt-4">
          <Note>
            You are at Mezo’s ceiling: your ratio may look healthy and the next borrow will still
            revert. A refinance re-fixes it at today’s price.
          </Note>
        </div>
      ) : null}
    </AppCard>
  );
}

/**
 * The screen a brand-new wallet sees.
 *
 * This is the default state for everyone Mezo sends here, so it is the one that most has
 * to look deliberate. No health card, no borrowing capacity, no balance rows reading
 * 0.00 three times — none of those figures exist yet, and rendering their skeletons
 * would be a grid of dashes pretending to be a dashboard.
 *
 * What is left is one instruction and the three places to go.
 */
function NoPosition({
  handle,
  account,
  price,
}: {
  handle: string | null;
  account: string;
  price: ReturnType<typeof usePrice>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Label>Account</Label>
          <h1 className="t-h2 mt-2">{handle ?? 'Your position'}</h1>
          <p className="num text-text-subtle mt-2 text-sm">{shortAddress(account, 10, 8)}</p>
        </div>
        {price.state === 'live' ? <PriceBanner feed={price} /> : null}
      </div>

      <AppCard className="p-6 md:p-10">
        <EmptyState
          icon={<VaultIcon className="size-6" />}
          title="No position yet"
          action={
            <ActionLink href="/app/vault" icon={<ArrowRight className="size-4" />}>
              Deposit Bitcoin
            </ActionLink>
          }
        >
          Deposit Bitcoin and borrow MUSD against it. You keep the Bitcoin.
        </EmptyState>
      </AppCard>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <QuickLink
          href="/app/vault"
          label="Vault"
          detail="Deposit, borrow, repay, withdraw"
          icon={<VaultIcon className="size-5" />}
        />
        <QuickLink
          href="/app/pay"
          label="Pay"
          detail="Send, request, or share a link"
          icon={<PayIcon className="size-5" />}
        />
        <QuickLink
          href="/app/earn"
          label="Earn"
          detail="Put idle MUSD to work"
          icon={<EarnIcon className="size-5" />}
        />
      </div>

      {/* The gas disclosure belongs on this screen more than any other: the first
          deposit is the one action Maren cannot sponsor, and this user is about to
          make it. `data-contrast` is the hook verify-contrast measures. */}
      <AppCard>
        <CardTitle>Gas</CardTitle>
        <p
          data-contrast="gas-copy"
          className="text-text-muted mt-4 max-w-[68ch] text-sm leading-relaxed"
        >
          Maren pays the Bitcoin gas for payments, Earn, and pooled borrow, repay and withdraw.
        </p>
        <p className="text-text-muted mt-2 max-w-[68ch] text-sm leading-relaxed">
          <strong className="text-text font-medium">Your first deposit costs gas</strong> — it
          carries Bitcoin with the call, and the relayer cannot sponsor that.
        </p>
      </AppCard>
    </div>
  );
}

function QuickLink({
  href,
  label,
  detail,
  icon,
}: {
  href: string;
  label: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="card hover:bg-surface-raised group flex items-center gap-4 p-5 transition-colors duration-[120ms] ease-out"
    >
      <span className="bg-surface-raised grid size-10 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] text-violet-400">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="text-text block text-[0.9375rem]">{label}</span>
        <span className="text-text-subtle block truncate text-xs">{detail}</span>
      </span>
    </Link>
  );
}
