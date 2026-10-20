'use client';

import Link from 'next/link';
import {
  MAREN_POLICY,
  MAREN_VAULT,
  classifyRatio,
  collateralValue,
  formatBtc,
  formatCollateralRatio,
  formatPercentTenths,
  formatUsd,
  vaultCapacity,
  vaultShareTenths,
} from '@maren/sdk';

import { ArrowDown } from '@/components/ui/icons';
import { HealthChip, HealthScale } from '@/components/app/health';
import { Btc, Dash, Musd, Num } from '@/components/app/money';
import { Info, Metric, MetricStrip, Note, Panel } from '@/components/app/primitives';
import { policyRatio } from '@/lib/health';
import { usePosition, usePrice, useProtocolStats } from '@/lib/data/source';

/**
 * THE SOCIAL VAULT, AS A THING RATHER THAN AS A ROUTING FOOTNOTE.
 *
 * One MUSD trove, shared. It is the only reason anybody can borrow against 0.001 BTC on a
 * protocol whose own minimum loan is 1,800 MUSD, and until this pass the app mentioned it
 * as a tag on a metric strip ("Pooled trove") and a paragraph a user reached only after
 * being routed into it. A reviewer reading the product could not tell that the pooled
 * position was the invention.
 *
 * So it gets a panel of its own, and the panel is figures rather than claims. Every one of
 * them is a public contract read anybody can repeat against
 * `MarenVault` and MUSD's `TroveManager`:
 *
 *   vault health   `MarenVault.troveStatus().icr`, classified by the SDK's own thresholds
 *   collateral     `troveStatus().coll`
 *   debt           `troveStatus().netDebt`
 *   capacity       `totalCollateral()` against `depositCap()`
 *   your share     `collateral(you)` against `totalCollateral()`
 *
 * THE RISK LINE IS NOT OPTIONAL AND IS NOT BEHIND THE AFFORDANCE. Pooling is the thing
 * that makes the product work and the thing that can cost a user money, and a panel that
 * sold the first without stating the second would be marketing. The mitigations are one
 * click down, because they are three sentences and they are not the headline.
 */
export function SocialVaultPanel({
  variant = 'full',
}: {
  /** `compact` is the portfolio's version: the same figures, no scale, no capacity bar. */
  variant?: 'full' | 'compact';
}) {
  const { data: stats } = useProtocolStats();
  const { data: position } = usePosition();
  const price = usePrice();
  const livePrice = price.state === 'live' ? price.priceWei : null;

  if (!stats) {
    return (
      <Panel title="The social vault">
        <p className="text-text-subtle px-5 py-4 text-sm">Reading the vault.</p>
      </Panel>
    );
  }

  const status = classifyRatio(stats.troveIcrWei);
  const capacity = vaultCapacity(stats.totalCollateralWei, stats.depositCapWei);
  const inVault = position !== undefined && position.route === 'pooled';
  const shareTenths = inVault
    ? vaultShareTenths(position.collateralWei, stats.totalCollateralWei)
    : 0;
  const collateralUsd = livePrice ? collateralValue(stats.troveCollateralWei, livePrice) : null;

  /**
   * Before the trove is seeded `troveStatus()` reports an ICR of `type(uint256).max`, and
   * a health chip on a vault that does not exist yet would be the most confident lie on
   * the screen. `troveOpen` is carried separately for exactly this reason.
   */
  const health = stats.troveOpen ? (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <Num size="xl">{formatCollateralRatio(stats.troveIcrWei)}</Num>
          <span className="text-text-subtle text-sm">vault health</span>
        </div>
        <HealthChip status={status} />
      </div>
      <HealthScale collateralRatio={stats.troveIcrWei} status={status} />
    </>
  ) : (
    <p className="text-text-muted max-w-[64ch] text-sm leading-relaxed">
      The shared trove has not been opened yet, so there is no vault health to report and borrowing
      is closed. Deposits are unaffected.
    </p>
  );

  if (variant === 'compact') {
    return (
      <Panel
        title="The social vault"
        meta={
          <Link
            href="/app/vault"
            className="text-text-muted hover:text-text text-xs transition-colors duration-[120ms] ease-out"
          >
            Open the vault
          </Link>
        }
      >
        <MetricStrip>
          <Metric
            className="px-5 py-4"
            label="Vault health"
            value={
              stats.troveOpen ? (
                <Num size="lg">{formatCollateralRatio(stats.troveIcrWei)}</Num>
              ) : (
                <Dash size="lg" />
              )
            }
            caption={`floor ${policyRatio(MAREN_VAULT.minTroveCr)}, target ${policyRatio(
              MAREN_POLICY.targetCr,
            )}`}
          />
          <Metric
            className="px-5 py-4"
            label="Your share"
            value={position ? <Btc wei={position.collateralWei} size="lg" /> : <Dash size="lg" />}
            caption={
              inVault
                ? `${formatPercentTenths(shareTenths)} of ${formatBtc(stats.totalCollateralWei)}`
                : 'nothing of yours is pooled'
            }
          />
          <Metric
            className="px-5 py-4"
            label="Capacity used"
            value={<Num size="lg">{formatPercentTenths(capacity.filledTenths)}</Num>}
            caption={`${formatBtc(capacity.usedWei)} of ${formatBtc(capacity.capWei)}`}
          />
        </MetricStrip>

        <div className="border-t border-[var(--border-hairline)] px-5 py-4">
          <SharedMeaning />
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="The social vault"
      meta={<span className="t-label text-text-subtle">One trove, shared</span>}
    >
      <div className="px-5 py-5">{health}</div>

      {/* EVERYTHING BELOW IS ABOUT THE PROTOCOL, NOT ABOUT YOU.
          It used to be the screen's subject — vault collateral, vault debt, capacity used,
          a fill bar, your share of the pool, then two paragraphs — so someone opening
          Finance to check their own money met twelve figures about a shared trove first.
          It is all still here and still one click away, because the pooling is the part
          that can cost someone money and hiding it would be worse. It is just no longer
          what the screen opens with. The health figure above stays visible: that one is
          worth interrupting for. */}
      <details className="group border-t border-[var(--border-hairline)]">
        <summary className="text-text-muted hover:text-text flex min-h-[44px] cursor-pointer list-none items-center justify-between px-5 py-3 text-sm transition-colors duration-[120ms] ease-out [&::-webkit-details-marker]:hidden">
          <span>How the shared vault works</span>
          <ArrowDown
            className="size-4 transition-transform duration-200 ease-out group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
        </summary>

        <div className="border-t border-[var(--border-hairline)]">
          <MetricStrip>
            <Metric
              className="px-5 py-4"
              label="Vault collateral"
              value={<Btc wei={stats.troveCollateralWei} size="lg" />}
              caption={collateralUsd !== null ? formatUsd(collateralUsd) : 'needs a live price'}
            />
            <Metric
              className="px-5 py-4"
              label="Vault debt"
              value={<Musd wei={stats.troveNetDebtWei} size="lg" />}
              caption="drawn by everyone in it"
            />
            <Metric
              className="px-5 py-4"
              label="Capacity used"
              value={<Num size="lg">{formatPercentTenths(capacity.filledTenths)}</Num>}
              caption={`of a ${formatBtc(capacity.capWei)} cap`}
            />
          </MetricStrip>
        </div>

        <div className="border-t border-[var(--border-hairline)] px-5 py-4">
          <CapacityBar
            filledTenths={capacity.filledTenths}
            usedWei={capacity.usedWei}
            capWei={capacity.capWei}
            headroomWei={capacity.headroomWei}
          />
          {capacity.full ? (
            <div className="mt-4">
              <Note tone="warning" role="status">
                The vault is at its cap. Deposits reopen when the cap is raised or someone
                withdraws. Repaying and withdrawing are unaffected.
              </Note>
            </div>
          ) : null}
        </div>

        {inVault && position ? (
          <div className="border-t border-[var(--border-hairline)]">
            <MetricStrip>
              <Metric
                className="px-5 py-4"
                label="Your collateral in it"
                value={<Btc wei={position.collateralWei} size="lg" />}
                caption={`${formatPercentTenths(shareTenths)} of the vault`}
              />
              <Metric
                className="px-5 py-4"
                label="Your debt in it"
                value={<Musd wei={position.debtWei} size="lg" />}
                caption="yours alone, not the vault's"
              />
            </MetricStrip>
          </div>
        ) : null}

        <div className="border-t border-[var(--border-hairline)] px-5 py-4">
          <SharedMeaning />
          <Info summary="How Maren limits that risk">
            Maren liquidates a pooled position internally at{' '}
            {policyRatio(MAREN_POLICY.vaultLiquidationCr)}, far above the protocol’s 110%, and backs
            that with a {formatBtc(MAREN_VAULT.minDeposit)} floor, per-block keeper checks and an
            insurance buffer funded from vault fees. These are mitigations, not a guarantee. Nobody
            can borrow at all while the vault sits under {policyRatio(MAREN_VAULT.minTroveCr)},
            which is checked on every borrow whether or not it adds any trove debt.
          </Info>
        </div>
      </details>
    </Panel>
  );
}

/**
 * What "shared" means, in one sentence, with the part that can cost money in it.
 *
 * Shared by both variants so the disclosure cannot survive on one screen and quietly go
 * missing on the other.
 */
function SharedMeaning() {
  return (
    <p data-contrast="route-body" className="text-text-muted max-w-[68ch] text-sm leading-relaxed">
      Everyone here shares one trove on MUSD: your Bitcoin is segregated in{' '}
      <em className="text-text not-italic">accounting, not custody</em>, so a fall faster than the
      keeper can act could socialise losses.
    </p>
  );
}

/**
 * How full the vault is, as a bar.
 *
 * The fill is the truncated figure from the SDK, so the bar and the percentage beside it
 * can never disagree. A non-empty vault gets a 2px minimum so the bar is not mistaken for
 * an empty one; that is a hairline, not a proportion, and the exact BTC figures sit
 * underneath it either way.
 */
function CapacityBar({
  filledTenths,
  usedWei,
  capWei,
  headroomWei,
}: {
  filledTenths: number;
  usedWei: bigint;
  capWei: bigint;
  headroomWei: bigint;
}) {
  return (
    <div>
      <div
        className="bg-surface-inset relative h-2 overflow-hidden rounded-[var(--radius-pill)]"
        role="img"
        aria-label={`${formatPercentTenths(filledTenths)} of the vault's ${formatBtc(
          capWei,
        )} deposit cap is used. ${formatBtc(headroomWei)} of room is left.`}
      >
        <div
          aria-hidden
          className="h-2 rounded-[var(--radius-pill)] bg-violet-400"
          style={{ width: `${filledTenths / 10}%`, minWidth: usedWei > 0n ? '2px' : '0' }}
        />
      </div>
      <div className="text-text-subtle mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
        <span>
          <Btc wei={usedWei} size="sm" tone="muted" /> deposited
        </span>
        <span>
          <Btc wei={headroomWei} size="sm" tone="muted" /> of room left
        </span>
      </div>
    </div>
  );
}
