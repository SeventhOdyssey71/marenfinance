'use client';

import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import {
  MAREN_POLICY,
  previewBorrow,
  collateralValue,
  formatBtc,
  formatMusd,
  shortAddress,
} from '@maren/sdk';
import type { Address } from 'viem';

import { Fact, FactGroup } from '@/components/app/facts';
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
  AppLoading,
  Info,
  Note,
  PageHeader,
  Refreshing,
  SectionHeader,
  Skeleton,
} from '@/components/app/primitives';
import { ProtocolPanel } from '@/components/app/protocol-panel';
import { SignIn } from '@/components/app/sign-in';
import { PillButton } from '@/components/ui/pill-button';
import { ArrowRight, ArrowUpRight, EarnIcon, PayIcon, VaultIcon } from '@/components/ui/icons';
import { activityDirection, activityTitle, statusLabel, timeAgo } from '@/lib/copy';
import { VALUE_PROPS } from '@/lib/copy/value-props';
import { policyRatio } from '@/lib/health';
import {
  useActivity,
  useBalances,
  useCounterpartyHandles,
  useDataSource,
  useEarn,
  usePosition,
  usePrice,
  usePrimaryHandle,
  useProtocolStats,
} from '@/lib/data/source';
import type { ActivityItem } from '@/lib/data/types';
import { preflightBorrow } from '@/lib/chain/preflight';

/**
 * Home: the position at a glance, then what you can do about it.
 *
 * THE SHAPE. One centred column, read top to bottom: a greeting and a one-line summary of
 * the two figures people open the app for (what they can spend, what they can still
 * borrow), the four things you launch from here, then the position, the recent ledger,
 * Earn, and the public vault as the quiet last section. Everything that used to be on
 * this screen is still on it; the order says what matters.
 *
 * WHAT CHANGED IN AN EARLIER PASS, AND STILL HOLDS. This screen had drifted into a
 * lending terminal: the collateral ratio was the hero, a six-mark gauge sat under it, and
 * three more panels carried equal weight below. It now leads with plain language: a
 * one-line safety statement, then three facts anyone reads without a glossary (what is
 * locked, what is borrowed, what is left to borrow). The ratio, the liquidation price,
 * the interest, the ceiling mechanics and the shared-vault risk sit one tap down in
 * "Position details". Nothing was deleted; a screen that hides a real risk would be worse
 * than a dense one.
 *
 * When the price feed is not live the health block is replaced by the price state. There
 * is no "last known health" rendering, because a health figure computed from a stale price
 * is a stale figure wearing a current label.
 */
export default function PortfolioPage() {
  const source = useDataSource();
  const price = usePrice();
  const positionQ = usePosition();
  const balancesQ = useBalances();
  const earnQ = useEarn();
  const { data: stats } = useProtocolStats();
  const { data: handle } = usePrimaryHandle();

  const position = positionQ.data;
  const balances = balancesQ.data;
  const earn = earnQ.data;

  const livePrice = price.state === 'live' ? price.priceWei : null;

  if (!source.connected) return <NotConnected />;

  // Nothing on chain has arrived yet: stand in with skeletons that hold the layout, never
  // with zeroes that would read as a real, empty position.
  const firstLoad = source.ready && (positionQ.isLoading || balancesQ.isLoading || earnQ.isLoading);
  // Figures are on screen and being re-read (a background refetch, or the refetch a
  // confirmed write triggers). Say so quietly; do not blank the numbers.
  const refreshing =
    source.ready &&
    !firstLoad &&
    (positionQ.isFetching || balancesQ.isFetching || earnQ.isFetching);

  // The summary line's "Refresh": the same three reads a confirmed write re-runs, asked
  // for on demand. Reads only; nothing here can send anything.
  const refresh = () => {
    void positionQ.refetch();
    void balancesQ.refetch();
    void earnQ.refetch();
  };

  const account = source.account ?? '';

  if (firstLoad) {
    return (
      <>
        <Greeting
          handle={handle ?? null}
          account={account}
          summary={<Skeleton className="mx-auto h-4 w-64 max-w-full" />}
        />
        <QuickActions />
        <Section id="position-loading" title="Position">
          <AppLoading panels={[3, 2]} />
        </Section>
      </>
    );
  }

  const empty = position !== undefined && position.collateralWei === 0n && position.debtWei === 0n;
  const debtFree = position !== undefined && !empty && position.debtWei === 0n;

  const health =
    position && livePrice && !empty && !debtFree
      ? previewBorrow(position, livePrice, 0n).health
      : null;

  const collateralUsd =
    position && livePrice ? collateralValue(position.collateralWei, livePrice) : null;

  // The same ceiling-aware figure the Vault slider is bounded by, so Home never quotes a
  // number a borrow would reject. Only meaningful while a health figure exists.
  const available =
    health && position && stats
      ? preflightBorrow({ position, balances, price, stats }, 0n).maxWei
      : null;

  const summary = (
    <SummaryLine
      balances={balances}
      available={available}
      refreshing={refreshing}
      onRefresh={refresh}
      // A brand-new wallet's next move is the Deposit button in its Position section;
      // repeating it here would put two of the same call on one screen.
      vaultLink={!empty}
    />
  );

  if (empty)
    return (
      <>
        <Greeting handle={handle ?? null} account={account} summary={summary} />
        <QuickActions />
        <NoPosition />
        <RecentActivity />
        <SocialVault />
      </>
    );

  return (
    <>
      <Greeting handle={handle ?? null} account={account} summary={summary} />

      <QuickActions />

      {debtFree && position ? (
        <Section
          id="position-health"
          title="Position"
          action={<span className="text-text-muted">No debt</span>}
        >
          <div className="card p-5 md:p-6">
            <p className="t-label">Bitcoin locked</p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Btc wei={position.collateralWei} size="xl" />
              {collateralUsd !== null ? (
                <span className="text-text-muted text-sm">
                  worth <Usd wei={collateralUsd} size="sm" />
                </span>
              ) : null}
            </div>
            <p className="text-text-muted mt-4 max-w-[60ch] text-pretty text-[0.9375rem] leading-relaxed">
              You have not borrowed anything, so there is nothing at risk. Your Bitcoin cannot be
              liquidated while your debt is zero.
            </p>
            <div className="mt-6">
              <PillButton href="/app/vault" icon={<ArrowRight className="size-4" />}>
                Borrow MUSD against it
              </PillButton>
            </div>
          </div>
        </Section>
      ) : health && position && livePrice ? (
        <PositionCard
          position={position}
          health={health}
          balances={balances}
          earn={earn}
          collateralUsd={collateralUsd}
          available={available}
        />
      ) : (
        <Section id="position-health" title="Position">
          {!position ? (
            // The read failed or has not run. Say which, and never let the price banner
            // below stand in for a position that was never read.
            <QuietLine>
              {positionQ.isError
                ? 'Could not read your position from Mezo. Refresh to try again.'
                : 'Your position has not been read yet.'}
            </QuietLine>
          ) : (
            <div className="card p-5 md:p-6">
              <PriceBanner feed={price} />
              {position && price.state !== 'loading' ? (
                <p className="text-text-muted mt-4 max-w-[64ch] text-pretty text-sm leading-relaxed">
                  You hold {formatBtc(position.collateralWei)} against{' '}
                  {formatMusd(position.debtWei)} of debt. Safety is not shown because it would have
                  to be computed from a price the protocol itself would refuse.
                </p>
              ) : null}
            </div>
          )}
        </Section>
      )}

      <RecentActivity />

      <EarnSnapshot earn={earn} balances={balances} failed={earnQ.isError} />

      <SocialVault />
    </>
  );
}

// ── layout ───────────────────────────────────────────────────────────────────

/**
 * One group on the page: a bracketed label, an optional trailing link, and its card.
 * Groups sit 48px apart, three times the gap inside one, so the page reads as a list of
 * sections rather than a stack of boxes.
 */
function Section({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <SectionHeader id={id} title={title} action={action} />
      {children}
    </section>
  );
}

/** A greeting by the local clock. Client-only: this branch never renders on the server. */
function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The top of Home: hello, the account it is about, and the one-line summary.
 *
 * The full short address stays visible under the greeting. It is the account every figure
 * below is read for, and a handle on its own would hide which wallet that is.
 */
function Greeting({
  handle,
  account,
  summary,
}: {
  handle: string | null;
  account: string;
  summary: ReactNode;
}) {
  const hello = greetingFor(new Date());
  return (
    <PageHeader
      align="center"
      title={handle ? `${hello}, ${handle}` : hello}
      description={
        <>
          <div>{summary}</div>
          <p className="mono text-text-muted mt-3 text-xs">{shortAddress(account, 10, 8)}</p>
        </>
      }
    />
  );
}

/**
 * The two figures people open Home for, in one line, with the next move beside them.
 *
 * Each figure appears only when its read has landed: a missing balance drops out of the
 * sentence rather than standing in as a zero or a dash mid-prose. "Left to borrow" is the
 * preflight's ceiling-aware maximum, the number the Vault slider stops at.
 */
function SummaryLine({
  balances,
  available,
  refreshing,
  onRefresh,
  vaultLink,
}: {
  balances: ReturnType<typeof useBalances>['data'];
  available: bigint | null;
  refreshing: boolean;
  onRefresh: () => void;
  vaultLink: boolean;
}) {
  // Each clause holds together on one line; the sentence breaks between them.
  const spend = balances ? (
    <span className="whitespace-nowrap">
      <Musd wei={balances.musdWei} /> to spend
    </span>
  ) : null;
  const borrow =
    available !== null ? (
      <span className="whitespace-nowrap">
        <Musd wei={available} /> left to borrow
      </span>
    ) : null;

  // A sentence rather than a row of figures between dots, so it wraps like prose on a
  // phone instead of starting a line with a separator.
  const sentence =
    spend && borrow ? (
      <>
        {spend} and {borrow}.
      </>
    ) : spend ? (
      <>{spend}.</>
    ) : borrow ? (
      <>{borrow}.</>
    ) : null;

  // Inline actions: violet words with a 44px tall hit area that does not change the line.
  const link =
    '-my-3 inline-flex min-h-11 items-center px-1 text-violet-400 transition-colors duration-150 ease-out hover:text-violet-600';

  return (
    <>
      {sentence ? <p className="text-pretty">{sentence}</p> : null}
      <p className={`flex flex-wrap items-center justify-center gap-x-2 ${sentence ? 'mt-1' : ''}`}>
        {vaultLink ? (
          <>
            <Link href="/app/finance" className={link}>
              Open Vault
            </Link>
            <span aria-hidden className="text-text-subtle">
              ·
            </span>
          </>
        ) : null}
        {refreshing ? (
          <span className="-my-3 inline-flex min-h-11 items-center px-1">
            <Refreshing />
          </span>
        ) : (
          <button type="button" onClick={onRefresh} className={link}>
            Refresh
          </button>
        )}
      </p>
    </>
  );
}

// ── the four actions ─────────────────────────────────────────────────────────

const ACTIONS = [
  { href: '/app/pay', label: 'Send', hint: 'MUSD to a handle or address', Icon: PayIcon },
  { href: '/app/pay#receive', label: 'Receive', hint: 'Scan or share to be paid', Icon: Incoming },
  { href: '/app/finance', label: 'Borrow', hint: 'MUSD against your Bitcoin', Icon: VaultIcon },
  { href: '/app/finance?section=earn', label: 'Earn', hint: 'Put MUSD to work', Icon: EarnIcon },
] as const;

/** Money arriving: the outbound arrow, turned to point in. */
function Incoming({ className = '', ...props }: ComponentProps<typeof ArrowUpRight>) {
  return <ArrowUpRight {...props} className={`rotate-180 ${className}`} />;
}

/**
 * The four things you launch from Home, as one block of four cells.
 *
 * Two by two on a phone, one row of four from `sm`. The hairlines between cells are real
 * borders, chosen per position so the grid draws one line between neighbours and none on
 * the card's own edge.
 */
function QuickActions() {
  const edges = [
    'border-b border-r sm:border-b-0',
    'border-b sm:border-b-0 sm:border-r',
    'border-r',
    '',
  ];
  return (
    <nav aria-label="Quick actions" className="card grid grid-cols-2 sm:grid-cols-4">
      {ACTIONS.map(({ href, label, hint, Icon }, i) => (
        <Link
          key={label}
          href={href}
          className={`hover:bg-surface-inset group flex flex-col gap-6 border-[var(--border-hairline)] p-4 transition-colors duration-150 ease-out sm:gap-8 sm:p-5 ${edges[i]}`}
        >
          <Icon
            aria-hidden
            className="text-text-muted size-5 transition-colors duration-150 ease-out group-hover:text-violet-500"
          />
          <span className="min-w-0">
            <span className="text-text block text-[0.9375rem]">{label}</span>
            <span className="text-text-muted mt-0.5 block text-pretty text-[0.8125rem] leading-snug">
              {hint}
            </span>
          </span>
        </Link>
      ))}
    </nav>
  );
}

// ── the position ─────────────────────────────────────────────────────────────

/**
 * The position, in plain language, with the expert detail one tap down.
 *
 * The lead is a sentence, not a ratio: "your Bitcoin can fall X% before it could be
 * liquidated" is the thing a borrower actually wants to know, and the health chip carries
 * the healthy/caution/danger state as a dot and a word. Three facts follow (locked,
 * borrowed, left to borrow), the last being the real, ceiling-aware number the Vault
 * slider is bounded by. `Position details` holds everything the old dense layout showed.
 */
function PositionCard({
  position,
  health,
  balances,
  earn,
  collateralUsd,
  available,
}: {
  position: NonNullable<ReturnType<typeof usePosition>['data']>;
  health: ReturnType<typeof previewBorrow>['health'];
  balances: ReturnType<typeof useBalances>['data'];
  earn: ReturnType<typeof useEarn>['data'];
  collateralUsd: bigint | null;
  available: bigint | null;
}) {
  const ceiling = position.maxBorrowingCapacityWei;
  const pooled = position.route === 'pooled';

  return (
    <Section id="position-health" title="Position" action={<HealthChip status={health.status} />}>
      <div className="card">
        {/* Plain-language safety line: the one thing a borrower is here to check. */}
        <p className="text-text max-w-[46ch] text-pretty px-5 py-5 text-[1.125rem] leading-snug tracking-[-0.012em] md:py-6 md:text-[1.25rem]">
          Your Bitcoin can fall{' '}
          <DropToLiquidation
            bps={health.priceDropToLiquidationBps}
            debtWei={position.debtWei}
            size="lg"
          />{' '}
          before it could be liquidated.
        </p>

        {/* The three facts anyone reads without a glossary. */}
        <div className="border-t border-[var(--border-hairline)]">
          {/* `content-start` keeps the three figures on one baseline when only the first
              carries a caption; the cells would otherwise stretch their rows apart. */}
          <FactGroup className="[&_dl>div]:content-start">
            <Fact
              label="Bitcoin locked"
              value={<Btc wei={position.collateralWei} />}
              caption={collateralUsd !== null ? <Usd wei={collateralUsd} size="sm" /> : undefined}
            />
            <Fact label="Borrowed" value={<Musd wei={position.debtWei} />} />
            <Fact
              label="Left to borrow"
              value={available === null ? <Dash /> : <Musd wei={available} />}
            />
          </FactGroup>
        </div>

        <div className="border-t border-[var(--border-hairline)] px-5 pb-4 pt-0.5">
          {!health.canBorrow ? (
            <div className="mt-4">
              <Note tone="warning" role="status">
                Borrowing is closed below {policyRatio(MAREN_POLICY.minHealthyCr)}. Repay or add
                collateral on{' '}
                <Link href="/app/finance" className="text-violet-400 hover:text-violet-600">
                  Finance
                </Link>
                .
              </Note>
            </div>
          ) : null}

          {/* Everything the old dense layout showed, kept and demoted, never deleted. */}
          <Info summary="Position details">
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex items-baseline gap-2">
                  <Ratio cr={health.collateralRatio} size="md" />
                  <span className="text-text-muted">collateral ratio</span>
                </div>
                <div className="mt-2">
                  <HealthScale collateralRatio={health.collateralRatio} status={health.status} />
                </div>
              </div>

              <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
                <DetailRow label="Liquidation price">
                  <LiquidationPrice
                    wei={health.liquidationPrice}
                    debtWei={position.debtWei}
                    size="sm"
                  />
                  <span className="text-text-muted">
                    {position.route === 'pooled'
                      ? ' · pooled positions liquidate at 140%'
                      : ' · protocol liquidates at 110%'}
                  </span>
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
                  <span className="text-text-muted"> · fixed when the trove opened</span>
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
                    could socialise losses. Adding collateral does not raise the shared
                    ceiling.{' '}
                  </>
                ) : (
                  <>
                    Mezo fixes this trove’s borrowing ceiling at the price it opened at. Adding
                    collateral does not raise it; only a refinance does, at today’s price for a
                    fee.{' '}
                  </>
                )}
                <Link href="/app/finance" className="text-violet-400 hover:text-violet-600">
                  Manage on Finance
                </Link>
              </p>
            </div>
          </Info>
        </div>
      </div>
    </Section>
  );
}

/** A label/value pair inside the details disclosure. */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border-hairline)] py-1.5">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-text text-right">{children}</dd>
    </div>
  );
}

/**
 * The screen a brand-new wallet sees: one instruction and where to go.
 */
function NoPosition() {
  return (
    <Section id="position-empty" title="Position">
      <div className="card flex flex-col items-start gap-5 p-5 md:flex-row md:items-center md:justify-between md:p-6">
        <div className="min-w-0">
          <h3 className="text-text text-[0.9375rem]">No position yet</h3>
          <p className="text-text-muted mt-1 max-w-[52ch] text-pretty text-sm leading-relaxed">
            Deposit Bitcoin and borrow MUSD against it. You keep the Bitcoin.
          </p>
        </div>
        <PillButton href="/app/finance" icon={<ArrowRight className="size-4" />}>
          Deposit Bitcoin
        </PillButton>
      </div>
    </Section>
  );
}

// ── Earn ─────────────────────────────────────────────────────────────────────

/**
 * What your MUSD is doing in Earn, honestly: the ERC-4626 value, a real read.
 * Stability-Pool yield is liquidation gains only: lumpy, sometimes zero for months, and
 * never an APY we may quote, so the line under it states what was realised over the
 * observed window and nothing more. When there is neither Earn nor spendable MUSD it is
 * an empty line pointing at Earn, never a zero dressed up as a number.
 */
function EarnSnapshot({
  earn,
  balances,
  failed,
}: {
  earn: ReturnType<typeof useEarn>['data'];
  balances: ReturnType<typeof useBalances>['data'];
  /** The Earn read errored: say so, rather than "reading" forever beside a dash. */
  failed: boolean;
}) {
  const loaded = earn !== undefined && balances !== undefined;
  const empty = loaded && earn.assetsWei === 0n && balances.musdWei === 0n;

  if (empty)
    return (
      <Section id="earn-heading" title="Earn">
        <div className="card p-5 md:p-6">
          <p className="text-text text-[0.9375rem]">Nothing set aside yet.</p>
          <p className="text-text-muted mt-1 max-w-[60ch] text-pretty text-sm leading-relaxed">
            Deposit MUSD into the Stability Pool to earn from liquidations. The return is not
            guaranteed and can be zero for long stretches.{' '}
            <Link
              href="/app/finance?section=earn"
              className="text-violet-400 transition-colors duration-150 ease-out hover:text-violet-600"
            >
              Put MUSD to work
            </Link>
          </p>
        </div>
      </Section>
    );

  return (
    <Section
      id="earn-heading"
      title="Earn"
      action={
        <Link
          href="/app/finance?section=earn"
          className="-my-3 inline-flex min-h-11 items-center gap-1"
        >
          Open Earn
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      }
    >
      {earn ? (
        <div className="card">
          <FactGroup layout="rows">
            <Fact label="In Earn" value={<Musd wei={earn.assetsWei} tone="musd" />} />
          </FactGroup>
          <div className="border-t border-[var(--border-hairline)] px-5 py-3">
            <EarnTrailingNote earn={earn} />
          </div>
        </div>
      ) : (
        <QuietLine>
          {failed
            ? 'Could not read your Earn position from Mezo. Refresh to try again.'
            : 'Your Earn position has not been read yet.'}
        </QuietLine>
      )}
    </Section>
  );
}

/** The backward-looking yield line: realised gains only, labelled as such, never an APY. */
function EarnTrailingNote({ earn }: { earn: NonNullable<ReturnType<typeof useEarn>['data']> }) {
  const { realisedWei, windowDays, liquidationEvents } = earn.trailing;

  if (realisedWei === 0n)
    return (
      <p className="text-text-muted text-xs leading-relaxed">
        No liquidation gains in the last {windowDays} days. Stability-Pool yield is lumpy and can be
        zero for long stretches.
      </p>
    );

  return (
    <p className="text-text-muted text-xs leading-relaxed">
      Realised <Musd wei={realisedWei} size="sm" tone="musd" /> over the last {windowDays} days,
      from {liquidationEvents} liquidation{liquidationEvents === 1 ? '' : 's'}. Backward-looking,
      not a forecast.
    </p>
  );
}

// ── recent activity ──────────────────────────────────────────────────────────

/**
 * A short window on the ledger, so Home answers "what just happened" without a trip to
 * Activity. Real decoded logs only, capped at four, with the full history one tap away.
 *
 * The empty line says exactly what the scan supports: "nothing yet" only when it read
 * every block since deployment, a narrower sentence when it read a recent stretch, and a
 * plain "could not read" when it failed. A failed scan is never an empty history.
 */
function RecentActivity() {
  const { data: window, isPending, error } = useActivity();
  const items = window?.items ?? [];
  const shown = items.slice(0, 4);
  // The same registry fallback Activity uses, for the four rows shown here only, so a
  // row reads "Sent to @sele" on both screens rather than a name on one and hex on the
  // other. Called unconditionally; it does nothing when the list is empty.
  const handles = useCounterpartyHandles(
    shown
      .filter((item) => item.counterpartyAddress && !item.counterparty?.startsWith('@'))
      .map((item) => item.counterpartyAddress as Address),
  );

  const viewAll = (
    <Link href="/app/activity" className="-my-3 inline-flex min-h-11 items-center gap-1">
      View all
      <ArrowUpRight aria-hidden className="size-3.5" />
    </Link>
  );

  let body: ReactNode;
  if (items.length > 0) {
    body = (
      <ul className="card divide-y divide-[var(--border-hairline)]">
        {shown.map((item) => (
          <RecentRow key={item.id} item={item} handles={handles} />
        ))}
      </ul>
    );
  } else if (error) {
    body = (
      <QuietLine>
        Could not read your history from Mezo. Your transactions are unaffected.
      </QuietLine>
    );
  } else if (!window && isPending) {
    body = <QuietLine status>Reading your history from Mezo…</QuietLine>;
  } else if (window?.complete) {
    body = <QuietLine>Nothing yet. Payments and vault moves show up here.</QuietLine>;
  } else {
    body = <QuietLine>Nothing in the recent blocks we could read.</QuietLine>;
  }

  return (
    <Section id="recent-heading" title="Recent" action={viewAll}>
      {body}
    </Section>
  );
}

/** An empty or in-flight state: one quiet line in a hairline box. */
function QuietLine({ children, status = false }: { children: ReactNode; status?: boolean }) {
  return (
    <p
      {...(status ? { role: 'status' } : {})}
      className="text-text-muted border border-[var(--border-hairline)] px-5 py-4 text-sm"
    >
      {children}
    </p>
  );
}

function RecentRow({ item, handles }: { item: ActivityItem; handles: Map<string, string> }) {
  const direction = activityDirection(item.kind);
  const isMusd = item.musdWei !== undefined;
  const wei = isMusd ? item.musdWei : item.btcWei;
  const sign = direction === 'out' ? '−' : direction === 'in' ? '+' : '';
  // Green for money in, red for money out, matching the native app; a directionless
  // move keeps the asset tone. Always paired with the sign, never colour alone.
  // The sign takes the amount's colour, so "−10.00 MUSD" reads as one figure, the same
  // way the Activity ledger draws it.
  const amountTone =
    direction === 'in'
      ? 'text-[color:var(--color-money-in)]'
      : direction === 'out'
        ? 'text-[color:var(--color-money-out)]'
        : isMusd
          ? 'text-musd'
          : 'text-btc';
  const statusTone =
    item.status === 'failed' ? 'text-danger' : item.status === 'pending' ? 'text-warning' : '';
  // The handle the payer typed on chain, then the registry's handle for the address, then
  // the short address: the same order of honesty as the Activity ledger.
  const counterparty = item.counterparty?.startsWith('@')
    ? item.counterparty
    : item.counterpartyAddress
      ? (handles.get(item.counterpartyAddress.toLowerCase()) ??
        shortAddress(item.counterpartyAddress))
      : undefined;

  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3.5">
      <div className="min-w-0">
        <p className="text-text truncate text-[0.9375rem]">
          {activityTitle(item.kind, counterparty)}
        </p>
        <p className="text-text-muted mt-0.5 text-xs">
          {item.at > 0 ? timeAgo(item.at) : 'time unknown'}
          {item.status !== 'confirmed' ? (
            <>
              {' · '}
              <span className={statusTone}>{statusLabel(item.status)}</span>
            </>
          ) : null}
        </p>
      </div>
      {wei !== undefined ? (
        <span className={`num shrink-0 text-[0.9375rem] ${amountTone}`}>
          {sign}
          {isMusd ? <Musd wei={wei} tone="inherit" /> : <Btc wei={wei} tone="inherit" />}
        </span>
      ) : null}
    </li>
  );
}

// ── the public vault ─────────────────────────────────────────────────────────

/** The protocol as anyone can read it. Last on the page, and labelled as not yours. */
function SocialVault() {
  return (
    <div className="mt-12">
      <ProtocolPanel />
    </div>
  );
}

// ── no wallet ────────────────────────────────────────────────────────────────

const SPEND = VALUE_PROPS.find((prop) => prop.key === 'spend');
// The two promises that hold for every visitor whatever is configured. "Gasless" is left
// out here: on a client without a relayer its own subhead says the opposite of its headline.
const PROMISES = VALUE_PROPS.filter((prop) => prop.key === 'honest' || prop.key === 'keys');

/**
 * The screen with no wallet attached, which is the screen most visitors see.
 *
 * It asks the question the product answers, says the honest version of the answer (the
 * liquidation risk is in the same sentence as the promise), and offers the connect. Below
 * it, the same four actions a connected account gets, so the shape of the app is visible
 * before anything is asked of the visitor, and then the live public vault: the one set of
 * figures that is true for everyone.
 */
function NotConnected() {
  return (
    <>
      <PageHeader
        align="center"
        title="What do you want to do with your Bitcoin?"
        description={<p className="mx-auto max-w-[46ch]">{SPEND?.subhead}</p>}
        actions={
          // SignIn lays itself out left-aligned for a card. Here it sits under a centred
          // headline, so its column and its helper line are centred from outside.
          <div className="text-center [&>div]:items-center">
            <SignIn />
          </div>
        }
      />

      <QuickActions />

      <section aria-labelledby="why-heading" className="mt-12">
        <SectionHeader id="why-heading" title="Why Maren" />
        <ul className="card grid grid-cols-1 sm:grid-cols-2">
          {PROMISES.map((prop, i) => (
            <li
              key={prop.key}
              className={`border-[var(--border-hairline)] p-5 ${
                i > 0 ? 'border-t sm:border-l sm:border-t-0' : ''
              }`}
            >
              <h3 className="text-text text-[0.9375rem]">{prop.headline}</h3>
              <p className="text-text-muted mt-1.5 text-pretty text-sm leading-relaxed">
                {prop.subhead}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <SocialVault />
    </>
  );
}
