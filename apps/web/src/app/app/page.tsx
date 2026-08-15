'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  MAREN_POLICY,
  assessHealth,
  borrowCeiling,
  collateralValue,
  formatBtc,
  formatMusd,
  formatUsd,
  shortAddress,
} from '@maren/sdk';

import { HealthChip, HealthScale } from '@/components/app/health';
import { Btc, Dash, Musd, Num, Ratio, Usd } from '@/components/app/money';
import { PriceBanner } from '@/components/app/price-banner';
import { AppCard, CardTitle, Label, Metric, Note, StatRow } from '@/components/app/primitives';
import { LivePulseFrame } from '@/components/shaders/live-pulse';
import { EarnIcon, PayIcon, VaultIcon } from '@/components/ui/icons';
import { activityTitle, bufferTitle, statusLabel, timeAgo } from '@/lib/copy';
import { healthTone, policyRatio, toneShaderColors } from '@/lib/health';
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

  const health =
    position && livePrice
      ? assessHealth(position.collateralWei, position.debtWei, livePrice)
      : null;

  const collateralUsd =
    position && livePrice ? collateralValue(position.collateralWei, livePrice) : null;

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

            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
              <Metric
                label="Liquidation price"
                value={<Num size="lg">{formatUsd(health.liquidationPrice)}</Num>}
                caption="the protocol liquidates below 110%"
              />
              <Metric
                label="Bitcoin can fall"
                value={
                  <Num size="lg">
                    {health.priceDropToLiquidationBps <= 0
                      ? '0%'
                      : `${Math.floor(health.priceDropToLiquidationBps / 100)}%`}
                  </Num>
                }
                caption={
                  health.priceDropToLiquidationBps <= 0
                    ? 'at or below liquidation'
                    : `from today’s price · ${bufferTitle(health.priceDropToLiquidationBps)}`
                }
              />
            </div>

            {!health.canBorrow ? (
              <div className="mt-6 border-t border-[var(--border-hairline)] pt-5">
                <p className="text-text-muted text-sm leading-relaxed" role="status">
                  Below {policyRatio(MAREN_POLICY.minHealthyCr)} Maren does not let you borrow more.
                  Repay or add collateral to reopen borrowing —{' '}
                  <Link href="/app/vault" className="text-violet-400 hover:text-violet-400/80">
                    open the Vault
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
            hint="ERC-4626 shares, valued in MUSD"
            value={earn ? <Musd wei={earn.assetsWei} size="lg" /> : <Dash size="lg" />}
          />
          <StatRow
            label="Outstanding debt"
            hint={
              position?.route === 'direct'
                ? 'principal + interest + the 200 MUSD liquidation reserve, at 1.00% APR simple and fixed'
                : 'principal + interest — a pooled position escrows no reserve of its own'
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
      <AppCard>
        <CardTitle>What gasless means here</CardTitle>
        <p
          data-contrast="gas-copy"
          className="text-text-muted mt-4 max-w-[68ch] text-sm leading-relaxed"
        >
          Mezo charges gas in BTC. Maren’s relayer pays it for payments, Earn, and pooled borrow,
          repay and withdraw — you sign an EIP-712 message and hold no Bitcoin for gas.
        </p>
        <p className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed">
          <strong className="text-text font-medium">Your first deposit is the exception.</strong>{' '}
          Depositing sends Bitcoin with the call, and the relay hub refuses any request carrying
          value — sponsoring one would mean Maren funding your deposit. So your first deposit costs
          gas, and everything after it is free.
        </p>
        <p className="text-text-subtle mt-3 text-xs">
          After the free tier the relayer fee is taken in MUSD inside the same transaction, and
          shown before you sign.
        </p>
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
                ? 'capped by Mezo’s per-trove ceiling'
                : binding === 'ratio'
                  ? 'capped by Maren’s 180% floor'
                  : 'nothing available to draw'
          }
        />
        <Metric
          label="Mezo’s ceiling"
          value={<Musd wei={ceiling} size="lg" />}
          caption="fixed at the price this trove opened at"
        />
        <Metric
          label="Drawn"
          value={<Musd wei={drawn} size="lg" />}
          caption={`${formatMusd(mezoHeadroom)} left under the ceiling`}
        />
      </div>

      <p className="text-text-muted mt-6 max-w-[68ch] text-sm leading-relaxed">
        {position.route === 'pooled'
          ? 'The ceiling above belongs to the pooled trove and is shared by everyone inside it. Your own limit is the 180% floor on your share, whichever binds first.'
          : 'This ceiling comes from TroveManager.getTroveMaxBorrowingCapacity(), not from your collateral ratio. Mezo fixes it at the price your trove opened at, and adding collateral does not raise it — only a refinance does.'}
      </p>

      {position.route === 'direct' && mezoHeadroom === 0n ? (
        <div className="mt-4">
          <Note>
            You are at Mezo’s ceiling. Your ratio may look healthy and the next borrow will still
            revert. A refinance re-fixes the ceiling at today’s price; it costs a refinancing fee
            and is blocked while the system is in Recovery Mode.
          </Note>
        </div>
      ) : null}
    </AppCard>
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
