'use client';

import { MAREN_POLICY, formatBtc, formatCollateralRatio, formatMusd, formatUsd } from '@maren/sdk';

import { Dash, Musd, Num } from '@/components/app/money';
import { Info, Metric, MetricStrip, Note, Panel } from '@/components/app/primitives';
import { policyRatio } from '@/lib/health';
import { usePrice, useProtocolStats } from '@/lib/data/source';

/**
 * The protocol, as anyone can read it — no wallet required.
 *
 * This panel is what makes a disconnected visit worth anything now that there is no demo
 * portfolio to show. Every figure is a public contract read against the addresses in
 * `@maren/sdk`: the BTC/USD oracle precompile, `MarenVault.troveStatus()`, and the vault's
 * MUSD balance. None of it is about the visitor, and the header says so rather than letting
 * a number be mistaken for theirs.
 *
 * The pooled trove's ratio is the most useful thing on it, and today it is also the least
 * flattering — the trove sits below Maren's own borrow floor, so borrowing is genuinely
 * closed. Showing that is the point. A product that hides its own binding constraint is
 * the same product that fabricates a transaction history.
 *
 * Restructured in this pass from a card with a headline and a paragraph into two divided
 * strips of figures. The paragraph said "Maren borrows against one shared trove on MUSD.
 * These are its live figures, readable by anyone with an RPC" — which the title and the
 * "Everyone's, not yours" tag already say between them.
 */
export function ProtocolPanel() {
  const { data: stats } = useProtocolStats();
  const price = usePrice();
  const livePrice = price.state === 'live' ? price.priceWei : null;

  const collateralUsd =
    stats && livePrice ? (stats.troveCollateralWei * livePrice) / 10n ** 18n : null;

  // Below Maren's floor the pooled trove cannot serve a new borrow at all. Derived from
  // the two numbers beside it rather than asserted, so it cannot drift out of agreement
  // with what the contract will actually do.
  const belowFloor = stats ? stats.troveIcrWei < MAREN_POLICY.minHealthyCr : false;

  return (
    <Panel
      title="The pooled trove"
      meta={<span className="t-label text-text-subtle">Everyone’s, not yours</span>}
    >
      <div className="px-5 py-5">
        <div className="flex flex-wrap items-baseline gap-3">
          {livePrice ? <Num size="xl">{formatUsd(livePrice)}</Num> : <Dash size="xl" />}
          <span className="t-h3 text-text-muted">BTC / USD</span>
        </div>
        <p className="text-text-subtle mt-2 text-xs">
          {price.state === 'live'
            ? `From Mezo's oracle precompile, ${price.ageSeconds}s ago.`
            : price.state === 'stale'
              ? `Last observation is ${price.ageSeconds}s old, past the 60s the protocol accepts.`
              : 'No usable oracle observation.'}
        </p>
      </div>

      <div className="border-t border-[var(--border-hairline)]">
        <MetricStrip>
          <Metric
            className="px-5 py-4"
            label="Trove collateral"
            value={
              stats ? (
                <Num size="lg" title={`${formatBtc(stats.troveCollateralWei)} exactly`}>
                  {formatBtc(stats.troveCollateralWei)}
                </Num>
              ) : (
                <Dash size="lg" />
              )
            }
            caption={collateralUsd !== null ? formatUsd(collateralUsd) : 'needs a live price'}
          />
          <Metric
            className="px-5 py-4"
            label="Trove debt"
            value={stats ? <Musd wei={stats.troveNetDebtWei} size="lg" /> : <Dash size="lg" />}
            caption="net of the liquidation reserve"
          />
          <Metric
            className="px-5 py-4"
            label="Trove ratio"
            value={
              stats ? (
                <Num size="lg" className={belowFloor ? 'text-warning' : ''} tone="inherit">
                  {formatCollateralRatio(stats.troveIcrWei)}
                </Num>
              ) : (
                <Dash size="lg" />
              )
            }
            caption={`Maren's floor is ${policyRatio(MAREN_POLICY.minHealthyCr)}`}
          />
        </MetricStrip>
      </div>

      <div className="border-t border-[var(--border-hairline)]">
        <MetricStrip>
          <Metric
            className="px-5 py-4"
            label="Borrowing ceiling"
            value={
              stats ? (
                <Musd wei={stats.troveMaxBorrowingCapacityWei} size="lg" />
              ) : (
                <Dash size="lg" />
              )
            }
            caption="fixed when the trove opened"
          />
          <Metric
            className="px-5 py-4"
            label="MUSD in reserve"
            value={stats ? <Musd wei={stats.reserveMusdWei} size="lg" /> : <Dash size="lg" />}
            caption="served without new trove debt"
          />
        </MetricStrip>
      </div>

      <div className="border-t border-[var(--border-hairline)] px-5 py-3">
        {/* The provenance of the ceiling, one click down. BRAND.md keeps contract internals
            out of the primary surface, but deleting the claim would leave the number
            unfalsifiable — and this is the figure people most often assume is derived from
            collateral when it is not. */}
        <Info summary="Why the ceiling does not move">
          Mezo fixes a per-trove ceiling at the price the trove opened at, and reports it from{' '}
          <span className="num">TroveManager.getTroveMaxBorrowingCapacity()</span> rather than
          deriving it from the collateral ratio. Adding collateral does not raise it: only a
          refinance does, which re-fixes the ceiling at today’s price for a fee and is blocked
          while the system is in Recovery Mode.
        </Info>

        {belowFloor ? (
          <div className="mt-3">
            <Note tone="warning" role="status">
              The shared trove is at {stats ? formatCollateralRatio(stats.troveIcrWei) : ''}, under
              the {policyRatio(MAREN_POLICY.minHealthyCr)} floor Maren keeps. New borrowing reverts
              until someone deposits more Bitcoin or repays. Deposits, repayments and withdrawals
              are unaffected.
            </Note>
          </div>
        ) : null}

        {stats && (stats.depositsPaused || stats.borrowingPaused) ? (
          <div className="mt-3">
            <Note tone="warning" role="status">
              {stats.depositsPaused ? 'Deposits are paused. ' : ''}
              {stats.borrowingPaused ? 'Borrowing is paused. ' : ''}
              Repay and withdraw are never pausable.
            </Note>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/** The reserve figure on its own, for screens that want one number rather than the panel. */
export function ReserveLine() {
  const { data: stats } = useProtocolStats();
  if (!stats) return null;
  return (
    <p className="text-text-subtle text-xs leading-relaxed">
      Maren’s reserve holds {formatMusd(stats.reserveMusdWei)}.
    </p>
  );
}
