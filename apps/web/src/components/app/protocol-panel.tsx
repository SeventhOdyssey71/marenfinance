'use client';

import { MAREN_POLICY, formatBtc, formatCollateralRatio, formatMusd, formatUsd } from '@maren/sdk';

import { Fact, FactGroup } from '@/components/app/facts';
import { Dash, Musd, Num } from '@/components/app/money';
import { Info, Note, Panel } from '@/components/app/primitives';
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
 * Restructured from a card with a headline and a paragraph into two groups of figures,
 * which lay out as rows on a phone and as metric strips when the panel is wide. The
 * paragraph said "Maren borrows against one shared trove on MUSD. These are its live
 * figures, readable by anyone with an RPC" — which the title and the "Everyone's, not
 * yours" tag already say between them.
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
      title="The social vault"
      meta={<span className="text-text-muted text-[0.8125rem]">Everyone’s, not yours</span>}
    >
      {/* The price leads, sized by the panel's own width: in a 312px column a 56px
          six-figure price would run out of the card. */}
      <div className="@container px-5 py-5">
        <p className="text-text-muted text-[0.8125rem]">BTC / USD</p>
        <div className="mt-1.5">
          {livePrice ? (
            <Num size="xl" className="@md:text-[2.75rem] @2xl:text-[3.25rem] text-[2.25rem]">
              {formatUsd(livePrice)}
            </Num>
          ) : (
            <Dash size="xl" />
          )}
        </div>
        <p className="text-text-muted mt-2 text-xs">
          {price.state === 'live'
            ? `From Mezo's oracle precompile, ${price.ageSeconds}s ago.`
            : price.state === 'stale'
              ? `Last observation is ${price.ageSeconds}s old, past the 60s the protocol accepts.`
              : 'No usable oracle observation.'}
        </p>
      </div>

      <div className="border-t border-[var(--border-hairline)]">
        <FactGroup>
          <Fact
            label="Vault collateral"
            value={
              stats ? (
                <Num title={`${formatBtc(stats.troveCollateralWei)} exactly`}>
                  {formatBtc(stats.troveCollateralWei)}
                </Num>
              ) : (
                <Dash />
              )
            }
            caption={collateralUsd !== null ? formatUsd(collateralUsd) : 'needs a live price'}
          />
          <Fact
            label="Vault debt"
            value={stats ? <Musd wei={stats.troveNetDebtWei} /> : <Dash />}
            caption="net of the liquidation reserve"
          />
          <Fact
            label="Vault health"
            value={
              stats ? (
                <Num className={belowFloor ? 'text-warning' : ''} tone="inherit">
                  {formatCollateralRatio(stats.troveIcrWei)}
                </Num>
              ) : (
                <Dash />
              )
            }
            // The figure turns amber under the floor; the caption says so in words, so
            // the state never rests on the colour.
            caption={
              belowFloor
                ? `under Maren's ${policyRatio(MAREN_POLICY.minHealthyCr)} floor`
                : `Maren's floor is ${policyRatio(MAREN_POLICY.minHealthyCr)}`
            }
          />
        </FactGroup>
      </div>

      <div className="border-t border-[var(--border-hairline)]">
        <FactGroup>
          <Fact
            label="Borrowing ceiling"
            value={stats ? <Musd wei={stats.troveMaxBorrowingCapacityWei} /> : <Dash />}
            caption="fixed when the trove opened"
          />
          <Fact
            label="MUSD in reserve"
            value={stats ? <Musd wei={stats.reserveMusdWei} /> : <Dash />}
            caption="served without new trove debt"
          />
        </FactGroup>
      </div>

      <div className="border-t border-[var(--border-hairline)] px-5 pb-4 pt-0.5">
        {/* The provenance of the ceiling, one click down. BRAND.md keeps contract internals
            out of the primary surface, but deleting the claim would leave the number
            unfalsifiable, and this is the figure people most often assume is derived from
            collateral when it is not. */}
        <Info summary="Why the ceiling does not move">
          Mezo fixes a per-trove ceiling at the price the trove opened at, and reports it from{' '}
          <span className="mono break-all">TroveManager.getTroveMaxBorrowingCapacity()</span> rather
          than deriving it from the collateral ratio. Adding collateral does not raise it: only a
          refinance does, which re-fixes the ceiling at today’s price for a fee and is blocked while
          the system is in Recovery Mode.
        </Info>

        {belowFloor ? (
          <div className="mt-4">
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
    <p className="text-text-muted text-xs leading-relaxed">
      Maren’s reserve holds {formatMusd(stats.reserveMusdWei)}.
    </p>
  );
}
