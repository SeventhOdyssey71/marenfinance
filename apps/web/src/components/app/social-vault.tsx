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

import { Fact, FactGroup } from '@/components/app/facts';
import { HealthChip, HealthScale } from '@/components/app/health';
import { Btc, Dash, Musd, Num } from '@/components/app/money';
import { Info, Note, Panel } from '@/components/app/primitives';
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
        <p className="text-text-muted px-5 py-4 text-sm" role="status">
          Reading the vault.
        </p>
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

  if (variant === 'compact') {
    return (
      <Panel
        title="The social vault"
        meta={
          <Link
            href="/app/vault"
            className="-my-2 inline-flex min-h-[44px] items-center text-[0.8125rem] text-violet-400 transition-colors duration-150 ease-out hover:text-violet-600"
          >
            Open the vault
          </Link>
        }
      >
        <FactGroup>
          <Fact
            label="Vault health"
            value={
              stats.troveOpen ? <Num>{formatCollateralRatio(stats.troveIcrWei)}</Num> : <Dash />
            }
            caption={`floor ${policyRatio(MAREN_VAULT.minTroveCr)}, target ${policyRatio(
              MAREN_POLICY.targetCr,
            )}`}
          />
          <Fact
            label="Your share"
            value={position ? <Btc wei={position.collateralWei} /> : <Dash />}
            caption={
              inVault
                ? `${formatPercentTenths(shareTenths)} of ${formatBtc(stats.totalCollateralWei)}`
                : 'nothing of yours is pooled'
            }
          />
          <Fact
            label="Capacity used"
            value={<Num>{formatPercentTenths(capacity.filledTenths)}</Num>}
            caption={`${formatBtc(capacity.usedWei)} of ${formatBtc(capacity.capWei)}`}
          />
        </FactGroup>

        <div className="border-t border-[var(--border-hairline)] px-5 py-4">
          <SharedMeaning />
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="The social vault"
      meta={<span className="text-text-muted text-[0.8125rem]">One trove, shared</span>}
    >
      {/* The vault's health leads. Before the trove is seeded `troveStatus()` reports an
          ICR of `type(uint256).max`, and a health chip on a vault that does not exist yet
          would be the most confident lie on the screen, so `troveOpen` gates it. */}
      <div className="px-5 pb-5 pt-5">
        {stats.troveOpen ? (
          <>
            <p className="text-text-muted text-[0.8125rem]">Vault health</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-2">
              <Num size="xl">{formatCollateralRatio(stats.troveIcrWei)}</Num>
              <HealthChip status={status} />
            </div>
            <HealthScale collateralRatio={stats.troveIcrWei} status={status} />
          </>
        ) : (
          <p className="text-text-muted max-w-[64ch] text-sm leading-relaxed">
            The shared trove has not been opened yet, so there is no vault health to report and
            borrowing is closed. Deposits are unaffected.
          </p>
        )}
      </div>

      {/* EVERYTHING BELOW IS ABOUT THE PROTOCOL, NOT ABOUT YOU, and it is visible rather
          than one click down. It used to sit behind a "How the shared vault works" toggle
          because this panel led the Vault screen and twelve figures about a shared trove
          met someone checking their own money first. The panel now follows the user's own
          position and the controls, so it no longer leads, and the figures and the pooling
          risk can be read without opening anything. */}
      <div className="border-t border-[var(--border-hairline)]">
        <FactGroup>
          <Fact
            label="Vault collateral"
            value={<Btc wei={stats.troveCollateralWei} />}
            caption={collateralUsd !== null ? formatUsd(collateralUsd) : 'needs a live price'}
          />
          <Fact
            label="Vault debt"
            value={<Musd wei={stats.troveNetDebtWei} />}
            caption="drawn by everyone in it"
          />
          <Fact
            label="Capacity used"
            value={<Num>{formatPercentTenths(capacity.filledTenths)}</Num>}
            caption={`of a ${formatBtc(capacity.capWei)} cap`}
          />
        </FactGroup>
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
              The vault is at its cap. Deposits reopen when the cap is raised or someone withdraws.
              Repaying and withdrawing are unaffected.
            </Note>
          </div>
        ) : null}
      </div>

      {inVault && position ? (
        <div className="border-t border-[var(--border-hairline)]">
          <FactGroup>
            <Fact
              label="Your collateral in it"
              value={<Btc wei={position.collateralWei} />}
              caption={`${formatPercentTenths(shareTenths)} of the vault`}
            />
            <Fact
              label="Your debt in it"
              value={<Musd wei={position.debtWei} />}
              caption="yours alone, not the vault's"
            />
          </FactGroup>
        </div>
      ) : null}

      <div className="border-t border-[var(--border-hairline)] px-5 py-4">
        <SharedMeaning />
        <Info summary="How Maren limits that risk">
          Maren liquidates a pooled position internally at{' '}
          {policyRatio(MAREN_POLICY.vaultLiquidationCr)}, far above the protocol’s 110%, and backs
          that with a {formatBtc(MAREN_VAULT.minDeposit)} floor, per-block keeper checks and an
          insurance buffer funded from vault fees. These are mitigations, not a guarantee. Nobody
          can borrow at all while the vault sits under {policyRatio(MAREN_VAULT.minTroveCr)}, which
          is checked on every borrow whether or not it adds any trove debt.
        </Info>
      </div>
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
    <p
      data-contrast="route-body"
      className="text-text-muted max-w-[68ch] text-pretty text-sm leading-relaxed"
    >
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
        className="bg-surface-inset relative h-1.5 overflow-hidden"
        role="img"
        aria-label={`${formatPercentTenths(filledTenths)} of the vault's ${formatBtc(
          capWei,
        )} deposit cap is used. ${formatBtc(headroomWei)} of room is left.`}
      >
        <div
          aria-hidden
          className="bg-text/70 h-1.5"
          style={{ width: `${filledTenths / 10}%`, minWidth: usedWei > 0n ? '2px' : '0' }}
        />
      </div>
      <div className="text-text-muted mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
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
