'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  MAREN_POLICY,
  assessHealth,
  borrowCeiling,
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
  EmptyState,
  Info,
  Label,
  Note,
  Panel,
  PanelBody,
  StatRow,
} from '@/components/app/primitives';
import { ConnectPrompt } from '@/components/app/connect-prompt';
import { ProtocolPanel } from '@/components/app/protocol-panel';
import { LivePulseFrame } from '@/components/shaders/live-pulse';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  EarnIcon,
  PayIcon,
  VaultIcon,
} from '@/components/ui/icons';
import { activityDirection, activityTitle, timeAgo } from '@/lib/copy';
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
import type { ActivityItem } from '@/lib/data/types';

/**
 * Home — the position at a glance.
 *
 * WHAT CHANGED IN THIS PASS. This screen had drifted into a lending terminal: the
 * collateral ratio was the hero, a six-mark gauge sat under it, and three more panels —
 * liquidation math, the social-vault mechanics, and a borrowing-capacity table naming
 * "Mezo's ceiling" and "drawn" — carried equal weight below. Every expert figure shouted
 * at once, which is fine for a trader and wrong for someone who just wants to know what
 * they have and whether it is safe.
 *
 * It now leads with plain language: a one-line safety statement, then three facts anyone
 * reads without a glossary — what is locked, what is borrowed, what is left to borrow.
 * Everything the old screen showed is still here and still exact; the ratio, the
 * liquidation price, the interest, the ceiling mechanics and the shared-vault risk have
 * moved one tap down into "Position details". Nothing was deleted — a screen that hides a
 * real risk would be worse than a dense one — it was demoted, and the risk stays prominent
 * on Finance, where you actually borrow.
 *
 * When the price feed is not live the health block is replaced by the price state. There
 * is no "last known health" rendering, because a health figure computed from a stale price
 * is a stale figure wearing a current label.
 */
export default function PortfolioPage() {
  const source = useDataSource();
  const price = usePrice();
  const { data: position } = usePosition();
  const { data: balances } = useBalances();
  const { data: earn } = useEarn();
  const { data: handle } = usePrimaryHandle();

  const livePrice = price.state === 'live' ? price.priceWei : null;

  if (!source.connected) return <NotConnected />;

  const empty = position !== undefined && position.collateralWei === 0n && position.debtWei === 0n;
  const debtFree = position !== undefined && !empty && position.debtWei === 0n;

  const health =
    position && livePrice && !empty && !debtFree
      ? assessHealth(position.collateralWei, position.debtWei, livePrice)
      : null;

  const collateralUsd =
    position && livePrice ? collateralValue(position.collateralWei, livePrice) : null;

  if (empty)
    return <NoPosition handle={handle ?? null} account={source.account ?? ''} price={price} />;

  return (
    <div className="flex flex-col gap-4">
      <AccountHeader handle={handle ?? null} account={source.account ?? ''} price={price} />

      <ActionPills />

      {debtFree && position ? (
        <Panel title="Your position" meta={<span className="t-label text-text-subtle">No debt</span>}>
          <div className="px-5 py-5">
            <div className="flex flex-wrap items-baseline gap-3">
              <Btc wei={position.collateralWei} size="xl" />
              <span className="text-text-subtle text-sm">
                locked
                {collateralUsd !== null ? (
                  <>
                    {' '}
                    · worth <Usd wei={collateralUsd} size="sm" />
                  </>
                ) : null}
              </span>
            </div>
            <p className="text-text-muted mt-3 max-w-[64ch] text-sm leading-relaxed">
              You have not borrowed anything, so there is nothing at risk. Your Bitcoin cannot be
              liquidated while your debt is zero.
            </p>
          </div>
          <div className="border-t border-[var(--border-hairline)] px-5 py-3">
            <ActionLink href="/app/vault" icon={<ArrowRight className="size-4" />}>
              Borrow MUSD against it
            </ActionLink>
          </div>
        </Panel>
      ) : health && position && livePrice ? (
        <PositionCard
          position={position}
          health={health}
          balances={balances}
          earn={earn}
          collateralUsd={collateralUsd}
          livePrice={livePrice}
        />
      ) : (
        <Panel title="Your position" labelledBy="position-health">
          <div className="p-5">
            <PriceBanner feed={price} />
            {position && price.state !== 'loading' ? (
              <p className="text-text-subtle mt-4 max-w-[68ch] text-sm leading-relaxed">
                You hold {formatBtc(position.collateralWei)} against {formatMusd(position.debtWei)}{' '}
                of debt. Safety is not shown because it would have to be computed from a price the
                protocol itself would refuse.
              </p>
            ) : null}
          </div>
        </Panel>
      )}

      <RecentActivity />
    </div>
  );
}

/**
 * The position, in plain language, with the expert detail one tap down.
 *
 * The hero is a sentence, not a ratio: "your Bitcoin can fall X% before it could be
 * liquidated" is the thing a borrower actually wants to know, and the health chip carries
 * the healthy/caution/danger state as the only coloured element (BRAND.md §2). Three rows
 * follow — locked, borrowed, left to borrow — the last being the real, ceiling-aware
 * number the Vault slider is bounded by, so Home never quotes a figure a borrow would
 * reject. `Position details` holds everything the old dense layout showed.
 */
function PositionCard({
  position,
  health,
  balances,
  earn,
  collateralUsd,
  livePrice,
}: {
  position: NonNullable<ReturnType<typeof usePosition>['data']>;
  health: NonNullable<ReturnType<typeof assessHealth>>;
  balances: ReturnType<typeof useBalances>['data'];
  earn: ReturnType<typeof useEarn>['data'];
  collateralUsd: bigint | null;
  livePrice: bigint;
}) {
  const limits = borrowCeiling(position, livePrice);
  const available = limits?.amountWei ?? null;
  const ceiling = position.maxBorrowingCapacityWei;
  const pooled = position.route === 'pooled';

  return (
    <LivePulseFrame colors={toneShaderColors[healthTone[health.status]]}>
      <Panel
        title="Your position"
        labelledBy="position-health"
        meta={<HealthChip status={health.status} />}
      >
        {/* Plain-language safety line — the one thing a borrower is here to check. */}
        <div className="px-5 pt-5">
          <p className="text-text max-w-[52ch] text-[1.0625rem] leading-snug">
            Your Bitcoin can fall{' '}
            <DropToLiquidation
              bps={health.priceDropToLiquidationBps}
              debtWei={position.debtWei}
              size="md"
            />{' '}
            before it could be liquidated.
          </p>
        </div>

        {/* The three facts anyone reads without a glossary. */}
        <PanelBody className="mt-3">
          <StatRow
            label="Bitcoin locked"
            value={<Btc wei={position.collateralWei} size="lg" />}
            sub={collateralUsd !== null ? <Usd wei={collateralUsd} size="sm" /> : null}
          />
          <StatRow label="Borrowed" value={<Musd wei={position.debtWei} size="lg" />} />
          <StatRow
            label="Left to borrow"
            value={available === null ? <Dash size="lg" /> : <Musd wei={available} size="lg" />}
            last
          />
        </PanelBody>

        <div className="border-t border-[var(--border-hairline)] px-5 py-3">
          {!health.canBorrow ? (
            <div className="mb-3">
              <Note tone="warning" role="status">
                Borrowing is closed below {policyRatio(MAREN_POLICY.minHealthyCr)}. Repay or add
                collateral on{' '}
                <Link href="/app/finance" className="text-violet-400 hover:text-violet-400/80">
                  Finance
                </Link>
                .
              </Note>
            </div>
          ) : null}

          {/* Everything the old dense layout showed, kept and demoted — never deleted. */}
          <Info summary="Position details">
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex items-baseline gap-2">
                  <Ratio cr={health.collateralRatio} size="md" />
                  <span className="text-text-subtle">collateral ratio</span>
                </div>
                <div className="mt-2">
                  <HealthScale collateralRatio={health.collateralRatio} status={health.status} />
                </div>
              </div>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                <DetailRow label="Liquidation price">
                  <LiquidationPrice
                    wei={health.liquidationPrice}
                    debtWei={position.debtWei}
                    size="sm"
                  />
                  <span className="text-text-subtle"> · protocol liquidates at 110%</span>
                </DetailRow>
                <DetailRow label="Interest owed">
                  <Musd wei={position.interestWei} size="sm" />
                </DetailRow>
                <DetailRow label="Spendable MUSD">
                  {balances ? <Musd wei={balances.musdWei} size="sm" /> : <Dash size="sm" />}
                </DetailRow>
                <DetailRow label="In Earn">
                  {earn ? <Musd wei={earn.assetsWei} size="sm" /> : <Dash size="sm" />}
                </DetailRow>
                <DetailRow label="Borrowing ceiling">
                  <Musd wei={ceiling} size="sm" />
                  <span className="text-text-subtle"> · fixed when the trove opened</span>
                </DetailRow>
                <DetailRow label="Route">
                  {pooled ? 'Shared social vault' : 'Your own trove'}
                </DetailRow>
              </dl>

              <p className="leading-relaxed">
                {pooled ? (
                  <>
                    You share one trove with everyone else in the social vault. Your Bitcoin is
                    segregated in accounting, not custody, so a fall faster than the keeper can act
                    could socialise losses. Adding collateral does not raise the shared ceiling.{' '}
                  </>
                ) : (
                  <>
                    Mezo fixes this trove’s borrowing ceiling at the price it opened at. Adding
                    collateral does not raise it — only a refinance does, at today’s price for a
                    fee.{' '}
                  </>
                )}
                <Link href="/app/finance" className="text-violet-400 hover:text-violet-400/80">
                  Manage on Finance
                </Link>
              </p>
            </div>
          </Info>
        </div>
      </Panel>
    </LivePulseFrame>
  );
}

/** A label/value pair inside the details disclosure. */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="text-text-subtle">{label}</dt>
      <dd className="text-text-muted text-right">{children}</dd>
    </div>
  );
}

/**
 * The four things you launch from Home — the Talise pattern, adapted.
 */
function ActionPills() {
  const actions = [
    { href: '/app/pay', label: 'Send', Icon: PayIcon },
    { href: '/app/pay#receive', label: 'Receive', Icon: ArrowDown },
    { href: '/app/finance', label: 'Borrow', Icon: VaultIcon },
    { href: '/app/finance?section=earn', label: 'Earn', Icon: EarnIcon },
  ] as const;

  return (
    <nav aria-label="Quick actions" className="grid grid-cols-4 gap-2 sm:gap-3">
      {actions.map(({ href, label, Icon }) => (
        <Link
          key={label}
          href={href}
          className="card group flex flex-col items-center gap-2 px-2 py-4 transition-shadow duration-[120ms] ease-out hover:shadow-[0_2px_4px_rgba(16,16,19,0.05),0_18px_40px_-18px_rgba(16,16,19,0.22)]"
        >
          <span
            aria-hidden
            className="bg-surface-inset grid size-10 place-items-center rounded-[var(--radius-pill)] text-violet-500 transition-transform duration-[120ms] ease-out group-hover:-translate-y-0.5"
          >
            <Icon className="size-[18px]" />
          </span>
          <span className="text-text text-xs font-medium sm:text-sm">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

/**
 * A short window on the ledger, so Home answers "what just happened" without a trip to
 * Activity. Real decoded logs only, capped at four, with the full history one tap away.
 * Renders nothing when there is nothing honest to show.
 */
function RecentActivity() {
  const { data: window } = useActivity();
  const items = window?.items ?? [];
  if (items.length === 0) return null;

  return (
    <Panel
      title="Recent activity"
      meta={
        <Link
          href="/app/activity"
          className="text-text-muted hover:text-text inline-flex items-center gap-1 text-xs transition-colors duration-[120ms] ease-out"
        >
          View all
          <ArrowUpRight className="size-3.5" />
        </Link>
      }
    >
      <PanelBody>
        {items.slice(0, 4).map((item, index) => (
          <RecentRow key={item.id} item={item} last={index === Math.min(items.length, 4) - 1} />
        ))}
      </PanelBody>
    </Panel>
  );
}

function RecentRow({ item, last }: { item: ActivityItem; last: boolean }) {
  const direction = activityDirection(item.kind);
  const isMusd = item.musdWei !== undefined;
  const wei = isMusd ? item.musdWei : item.btcWei;
  const sign = direction === 'out' ? '−' : direction === 'in' ? '+' : '';

  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-2.5 ${
        last ? '' : 'border-b border-[var(--border-hairline)]'
      }`}
    >
      <span className="text-text min-w-0 truncate text-sm">{activityTitle(item.kind)}</span>
      <span className="flex shrink-0 items-baseline gap-3 text-right">
        <span className="text-text-subtle text-xs">
          {item.at > 0 ? timeAgo(item.at) : 'time unknown'}
        </span>
        {wei !== undefined ? (
          <span className="flex items-baseline gap-0.5">
            {sign ? <span className="text-text-subtle text-sm">{sign}</span> : null}
            {isMusd ? (
              <Musd wei={wei} size="sm" tone="musd" />
            ) : (
              <Btc wei={wei} size="sm" tone="btc" />
            )}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** Account identity and the price it is all measured against, on one line. */
function AccountHeader({
  handle,
  account,
  price,
}: {
  handle: string | null;
  account: string;
  price: ReturnType<typeof usePrice>;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <Label>Account</Label>
        <h1 className="t-h3 mt-1.5 truncate">{handle ?? 'Your position'}</h1>
        <p className="num text-text-subtle mt-1 text-xs">{shortAddress(account, 10, 8)}</p>
      </div>
      {price.state === 'live' ? <PriceBanner feed={price} /> : null}
    </div>
  );
}

/**
 * The screen a brand-new wallet sees: one instruction and where to go.
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
    <div className="flex flex-col gap-4">
      <AccountHeader handle={handle} account={account} price={price} />
      <ActionPills />
      <AppCard className="p-5">
        <EmptyState
          icon={<VaultIcon className="size-6" />}
          title="No position yet"
          action={
            <ActionLink href="/app/finance" icon={<ArrowRight className="size-4" />}>
              Deposit Bitcoin
            </ActionLink>
          }
        >
          Deposit Bitcoin and borrow MUSD against it. You keep the Bitcoin.
        </EmptyState>
      </AppCard>
    </div>
  );
}

/** The screen with no wallet attached. */
function NotConnected() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>Account</Label>
        <h1 className="t-h3 mt-1.5">Your position</h1>
      </div>
      <ConnectPrompt icon={<VaultIcon className="size-6" />} title="No wallet connected">
        Maren shows you your own position and nothing else. Connect and every figure on this screen
        becomes a contract read you can check on the explorer.
      </ConnectPrompt>
      <ProtocolPanel />
    </div>
  );
}
