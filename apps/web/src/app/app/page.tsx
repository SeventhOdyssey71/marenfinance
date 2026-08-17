'use client';

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
  Metric,
  MetricStrip,
  Note,
  Panel,
  PanelBody,
  StatRow,
} from '@/components/app/primitives';
import { ConnectPrompt } from '@/components/app/connect-prompt';
import { ProtocolPanel } from '@/components/app/protocol-panel';
import { SocialVaultPanel } from '@/components/app/social-vault';
import { LivePulseFrame } from '@/components/shaders/live-pulse';
import { ArrowRight, VaultIcon } from '@/components/ui/icons';
import { healthTone, policyRatio, toneShaderColors } from '@/lib/health';
import {
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
 * WHAT CHANGED IN THIS PASS. This screen used to read like documentation with inputs in
 * it: five titled cards, each with an `h3`, a paragraph of prose, and a grid of figures
 * with two-line rows underneath. Every group of four numbers carried the visual weight of
 * a chapter heading, and the numbers were the smallest thing on their own card.
 *
 * It is now laid out the way a lending interface is laid out. Panels have a `t-label`
 * column-header bar rather than a headline. Facts sit in one-line rows with values
 * right-aligned in mono. The figures a user makes a decision from — ratio, liquidation
 * price, drop tolerance, capacity — sit in a divided strip across the top of the panel
 * they belong to, at the size that says they are the subject. Balances and capacity, which
 * are read together, sit side by side rather than one below the other.
 *
 * WHAT DID NOT CHANGE. Position health is still the hero, the only coloured element is
 * still the health chip (BRAND.md §2), every disclosure is still on the screen, and no
 * figure was invented to fill a column. What was cut is prose, not facts: the sentences
 * that explained why a card existed rather than what the number in it meant.
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

  // Disconnected is a first-class state now, not a gap filled with demo data.
  if (!source.connected) return <NotConnected />;

  /**
   * The empty account. `debtWei === 0n && collateralWei === 0n` rather than
   * `route === 'none'`, because a user who has deposited but not yet borrowed also has
   * no health to show and must not be quoted a liquidation price.
   */
  const empty = position !== undefined && position.collateralWei === 0n && position.debtWei === 0n;

  /**
   * Deposited but not yet borrowed. This account has collateral and zero debt, which
   * means it has NO health figure: no ratio (it would be infinite), no liquidation
   * price (nothing can be liquidated), no distance-to-anything. Rendering the gauge
   * here produced an infinity symbol, two dashes, and a marker pinned to the end of a
   * scale that measures nothing — a dashboard of placeholders where the only real fact
   * is "you have Bitcoin deposited and you could borrow against it".
   */
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

      {/* ---------------------------------------------------------------- Hero */}
      {debtFree && position ? (
        <Panel title="Position" meta={<span className="t-label text-text-subtle">No debt</span>}>
          <div className="px-5 py-5">
            <div className="flex flex-wrap items-baseline gap-3">
              <Btc wei={position.collateralWei} size="xl" />
              <span className="text-text-subtle text-sm">
                deposited
                {collateralUsd !== null ? (
                  <>
                    {' '}
                    · worth <Usd wei={collateralUsd} size="sm" />
                  </>
                ) : null}
              </span>
            </div>

            <p className="text-text-muted mt-3 max-w-[64ch] text-sm leading-relaxed">
              Nothing borrowed, so there is no collateral ratio and no liquidation price. Your
              Bitcoin cannot be liquidated while your debt is zero.
            </p>
          </div>

          <div className="border-t border-[var(--border-hairline)] px-5 py-3">
            <ActionLink href="/app/vault" icon={<ArrowRight className="size-4" />}>
              Borrow MUSD against it
            </ActionLink>
          </div>
        </Panel>
      ) : health && position ? (
        <LivePulseFrame colors={toneShaderColors[healthTone[health.status]]}>
          <Panel
            title="Position"
            labelledBy="position-health"
            meta={<HealthChip status={health.status} />}
          >
            <div className="px-5 pb-5 pt-5">
              <div className="flex flex-wrap items-baseline gap-3">
                <Ratio cr={health.collateralRatio} size="xl" />
                <span className="text-text-subtle text-sm">collateral ratio</span>
              </div>
              <HealthScale collateralRatio={health.collateralRatio} status={health.status} />
            </div>

            {/* The three derived figures, on a rule. `Metric` clips rather than letting a
                long value set the column's minimum width — the failure that once rendered
                two of these labels on top of one another. */}
            <div className="border-t border-[var(--border-hairline)]">
              <MetricStrip>
                <Metric
                  className="px-5 py-4"
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
                  className="px-5 py-4"
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
                <Metric
                  className="px-5 py-4"
                  label="Outstanding debt"
                  value={<Musd wei={position.debtWei} size="lg" />}
                  caption={`${formatMusd(position.interestWei)} interest`}
                />
              </MetricStrip>
            </div>

            {!health.canBorrow ? (
              <p
                className="text-text-muted border-t border-[var(--border-hairline)] px-5 py-3 text-sm"
                role="status"
              >
                Borrowing is closed below {policyRatio(MAREN_POLICY.minHealthyCr)}. Repay or add
                collateral in the{' '}
                <Link href="/app/vault" className="text-violet-400 hover:text-violet-400/80">
                  Vault
                </Link>
                .
              </p>
            ) : null}
          </Panel>
        </LivePulseFrame>
      ) : (
        <Panel title="Position" labelledBy="position-health">
          <div className="p-5">
            <PriceBanner feed={price} />
            {position && price.state !== 'loading' ? (
              <p className="text-text-subtle mt-4 max-w-[68ch] text-sm leading-relaxed">
                You hold {formatBtc(position.collateralWei)} against {formatMusd(position.debtWei)}{' '}
                of debt. Health is not shown because it would have to be computed from a price the
                protocol itself would refuse.
              </p>
            ) : null}
          </div>
        </Panel>
      )}

      {/* WHERE THIS POSITION ACTUALLY LIVES, said in the product's own words rather than
          left to the reader to infer from a "pooled route" tag. Only for an account that
          is in the vault: a user with a trove of their own shares nothing and has nothing
          to be told here. */}
      {position?.route === 'pooled' ? <SocialVaultPanel variant="compact" /> : null}

      {/* Read together, so laid out together, at equal height. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Balances"
          meta={
            <Link
              href="/app/vault"
              className="text-text-muted hover:text-text text-xs transition-colors duration-[120ms] ease-out"
            >
              Manage
            </Link>
          }
        >
          <PanelBody>
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
              label="Debt"
              hint={
                position?.route === 'direct'
                  ? 'includes the 200 MUSD reserve'
                  : 'no reserve, social vault'
              }
              value={position ? <Musd wei={position.debtWei} size="lg" /> : <Dash size="lg" />}
              last
            />
          </PanelBody>
        </Panel>

        <BorrowingCapacity />
      </div>
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
      <Panel title="Borrowing capacity">
        <p className="text-text-subtle px-5 py-4 text-sm">Reading your position.</p>
      </Panel>
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
    <Panel
      title="Borrowing capacity"
      meta={
        <span className="t-label text-text-subtle">
          {position.route === 'pooled' ? 'In the social vault' : 'Your own trove'}
        </span>
      }
    >
      <MetricStrip>
        <Metric
          className="px-5 py-4"
          label="Available"
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
          className="px-5 py-4"
          label="Mezo’s ceiling"
          value={<Musd wei={ceiling} size="lg" />}
          caption="fixed when this trove opened"
        />
        <Metric
          className="px-5 py-4"
          label="Drawn"
          value={<Musd wei={drawn} size="lg" />}
          caption={`${formatMusd(mezoHeadroom)} under the ceiling`}
        />
      </MetricStrip>

      <div className="border-t border-[var(--border-hairline)] px-5 py-3">
        {/* Nothing on the surface. The mechanism — which contract call the ceiling comes
            from, and why adding collateral does not move it — is true, is the single most
            surprising thing about borrowing on Mezo, and is three sentences long, so it
            sits behind the affordance rather than in the panel. */}
        <Info summary="Why the ceiling does not move">
          {position.route === 'pooled' ? (
            <>
              This ceiling belongs to the social vault’s trove and is shared by everyone in it. Your
              own limit is Maren’s 180% floor on your share; whichever binds first stops the
              transaction.
            </>
          ) : (
            <>
              Mezo fixes a per-trove ceiling at the price the trove opened at, and reports it from{' '}
              <span className="num">TroveManager.getTroveMaxBorrowingCapacity()</span> rather than
              deriving it from your collateral ratio. Adding collateral does not raise it: only a
              refinance does, which re-fixes the ceiling at today’s price for a fee and is blocked
              while the system is in Recovery Mode.
            </>
          )}
        </Info>

        {position.route === 'direct' && mezoHeadroom === 0n ? (
          <div className="mt-3">
            <Note>
              You are at Mezo’s ceiling. Your ratio may look healthy and the next borrow will still
              revert; a refinance re-fixes it at today’s price.
            </Note>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * The screen a brand-new wallet sees.
 *
 * This is the default state for everyone Mezo sends here, so it is the one that most has
 * to look deliberate. No health panel, no capacity strip, no balance rows reading 0.00
 * three times — none of those figures exist yet, and rendering their skeletons would be a
 * grid of dashes pretending to be a dashboard.
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
    <div className="flex flex-col gap-4">
      <AccountHeader handle={handle} account={account} price={price} />

      <AppCard className="p-5">
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
    </div>
  );
}

/**
 * The screen with no wallet attached.
 *
 * Previously this state did not exist: `source.ts` fell back to a demo account, so an
 * anonymous visitor saw a full portfolio belonging to nobody — a health ratio, a
 * liquidation price, a history of payments to invented people. Removing that leaves a
 * hole, and the hole is filled with things that are actually true and actually public:
 * the oracle price and the pooled trove, straight from the contracts.
 */
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
