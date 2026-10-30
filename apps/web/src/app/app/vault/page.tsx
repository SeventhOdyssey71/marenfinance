'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  LIQUIDATION_RESERVE,
  MAREN_POLICY,
  MAREN_VAULT,
  borrowCeiling,
  formatApr,
  formatBtc,
  formatCollateralRatio,
  formatMusd,
  formatUsd,
  getChain,
  getMarenAddresses,
  INTEREST_RATE_BPS,
  isDeployed,
  marenAutoKeeperAbi,
  previewBorrow,
  recommendedBorrow,
} from '@maren/sdk';
import { useReadContract } from 'wagmi';

import { BlockedNote } from '@/components/app/blocked';
import { AmountField, AmountSlider, Segmented } from '@/components/app/controls';
import { Fact, FactGroup } from '@/components/app/facts';
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
  AppLoading,
  EmptyState,
  Note,
  PageHeader,
  Panel,
  Refreshing,
} from '@/components/app/primitives';
import { TxSheet, useTxRunner, type TxIntent, type TxRunner } from '@/components/app/tx';
import { ArrowRight, VaultIcon } from '@/components/ui/icons';
import { ConnectPrompt } from '@/components/app/connect-prompt';
import { RouteChoice } from '@/components/app/route-choice';
import { SocialVaultPanel } from '@/components/app/social-vault';
import {
  preflightBorrow,
  preflightDeposit,
  preflightRepay,
  preflightWithdraw,
  type Preflight,
  type VaultState,
} from '@/lib/chain/preflight';
import { actionIsRelayable } from '@/lib/chain/relay';
import { borrowPosition } from '@/lib/chain/borrow-position';
import {
  gasLine,
  gasNote,
  SPENDERS,
  useMarenWrites,
  useMusdAllowance,
  useRelayerStatus,
} from '@/lib/chain/write';
import {
  NETWORK,
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
 * WHAT CHANGED IN THIS PASS: THE SOCIAL VAULT IS THE SCREEN'S SUBJECT.
 *
 * Maren's one invention is that many people share a single MUSD trove, which is the only
 * reason a 0.001 BTC position can exist against a protocol whose minimum loan is 1,800
 * MUSD. The app described that as a tag reading "Pooled trove" and a paragraph shown only
 * to whoever had already been routed into it, below the controls. A reviewer could use the
 * whole product without learning that the pooled position was the point.
 *
 * It is now `SocialVaultPanel`, a full panel with the vault's own health on the same
 * scale a user's position is judged on, its collateral and debt, and how full it is
 * against `depositCap()`. The pooling risk is in the panel body rather than behind the
 * info affordance. `RouteCard` is gone: it said the same thing to a smaller audience.
 *
 * LAYOUT. One column, three groups: your position, the controls (tabs over the panel they
 * switch), then the shared vault. The vault panel used to sit above the tabs; it now
 * follows them, so someone checking their own money meets their own figures first, and
 * every vault figure is visible in it rather than one toggle down.
 *
 * And the routing is now a decision the user watches being made. `RouteChoice` sits above
 * the deposit amount with both routes, the live threshold that separates them, and the
 * recommendation as a sentence. It also corrects a claim that was never true: the old
 * "Route after: Direct trove" row implied a large enough deposit would open a trove of
 * your own, and `MarenVault.deposit()` has no such branch. Every deposit is pooled, and
 * the row now says where the Bitcoin actually goes.
 *
 * WHAT CHANGED IN THIS PASS. Every panel opened with an `h3` and a sentence describing
 * what the panel was for: "Adds collateral and raises your ratio immediately", "Reduces
 * your principal and raises your ratio", "The amount available is already capped at
 * Maren's 180% floor". A user who has pressed the Deposit tab knows they are depositing.
 * The panels now carry a bracketed header bar, and the space those sentences occupied is
 * occupied by the numbers the action changes, immediately next to the control that changes
 * them.
 *
 * WHAT DID NOT CHANGE. The borrow slider is still bounded by the exact amount that lands
 * the position on Maren's 180% floor, so the control cannot be dragged into a state we
 * would refuse. Every figure in the live preview still comes from `@maren/sdk` —
 * `borrowCeiling`, `recommendedBorrow`, `previewBorrow`, `maxWithdrawable` — and there is
 * still no arithmetic in this file that touches a user's risk. Every gas and route
 * disclosure is still here, at one sentence each.
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
  const positionQ = usePosition();
  const balancesQ = useBalances();
  const statsQ = useProtocolStats();
  const runner = useTxRunner();

  const position = positionQ.data;
  const balances = balancesQ.data;
  const stats = statsQ.data;

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
   * Rendered at `/app/vault` this is a screen, with its own title. Inside Finance's tab
   * panel, Finance's header and the tab already name it, and a second `h1` would give the
   * page two titles. A page module cannot take props or export a variant, so the route is
   * what says which of the two this is.
   */
  const standalone = usePathname() === '/app/vault';
  const header = standalone ? <PageHeader eyebrow="[ Vault ]" title="Bitcoin credit" /> : null;

  /**
   * No wallet, no vault screen.
   *
   * Everything below — the position strip, the borrow slider, the withdrawal ceiling — is
   * a function of an account. There used to be a demo account standing in for one, which
   * meant a visitor could drag a borrow slider that was attached to nothing. What they get
   * instead is the reason to connect, and the shared trove's real numbers underneath it.
   */
  if (!source.connected) {
    return (
      <Screen header={header}>
        <ConnectPrompt icon={<VaultIcon className="size-6" />} title="Connect to open a position">
          {/* `data-contrast` is verify-contrast's hook for muted body copy on a card
              surface, which is this token's worst case. It lives on whichever copy is
              actually on screen — here while disconnected, and on the borrow panel once
              a position exists — so the measurement never silently stops happening. */}
          <span data-contrast="route-body">
            Draw MUSD against Bitcoin at {formatApr(INTEREST_RATE_BPS)}, fixed. Minimum deposit{' '}
            {formatBtc(MAREN_VAULT.minDeposit)}.
          </span>
        </ConnectPrompt>

        {/* The vault itself is public, so a visitor with no wallet still gets the thing
            the product is built around rather than a locked door. */}
        <SocialVaultPanel />
      </Screen>
    );
  }

  // The account's own figures have not arrived yet: skeletons hold the layout rather than
  // a slider bound to a position that is not loaded.
  const firstLoad = source.ready && (positionQ.isLoading || balancesQ.isLoading);
  // Figures are up and being re-read — after a confirmed deposit, borrow, repay or
  // withdraw the shared invalidation refetches these, and this is where the user sees it.
  const refreshing =
    source.ready &&
    !firstLoad &&
    (positionQ.isFetching || balancesQ.isFetching || statsQ.isFetching);

  if (firstLoad) {
    return (
      <Screen header={header}>
        <AppLoading panels={[3, 4, 4]} />
      </Screen>
    );
  }

  if (position?.route === 'direct') {
    return (
      <Screen header={header}>
        <Group>
          <PositionStrip livePrice={livePrice} refreshing={refreshing} />
          <Note>
            This wallet has a direct Mezo trove. Manage it through Mezo’s direct-trove interface.
            Maren’s deposit, borrow, repay and withdrawal controls act on its shared vault and
            cannot change this separate position.
          </Note>
        </Group>
      </Screen>
    );
  }

  const empty = position !== undefined && position.collateralWei === 0n && position.debtWei === 0n;

  /**
   * A wallet with nothing in it can only do one thing here, so that is the tab it lands
   * on. Deriving the default rather than seeding `useState` means it settles correctly
   * once the position arrives, while an explicit choice still wins.
   */
  const mode: Mode = chosen ?? (empty ? 'deposit' : 'borrow');

  /**
   * One refreshing mark, on the panel whose figures are being re-read: the position, or,
   * for an account with no position panel yet, the action panel below the tabs.
   */
  const actionRefreshing = empty && refreshing;

  return (
    <Screen header={header}>
      {/* Your own money first. No position panel when there is no position: an empty
          account lands on the Deposit tab, and the deposit form IS this screen's empty
          state. */}
      {price.state !== 'live' || !empty ? (
        <Group>
          {price.state !== 'live' ? <PriceBanner feed={price} /> : null}
          {empty ? null : <PositionStrip livePrice={livePrice} refreshing={refreshing} />}
        </Group>
      ) : null}

      {/* The controls, as tabs over the panel they switch. */}
      <div>
        <Segmented options={MODES} value={mode} onChange={setChosen} label="Vault action" />
        <div className="mt-3">
          {mode === 'borrow' ? (
            <BorrowPanel
              runner={runner}
              chain={chain}
              onDeposit={() => setChosen('deposit')}
              refreshing={actionRefreshing}
            />
          ) : null}
          {mode === 'deposit' ? (
            <DepositPanel runner={runner} chain={chain} refreshing={actionRefreshing} />
          ) : null}
          {mode === 'repay' ? (
            <RepayPanel runner={runner} chain={chain} refreshing={actionRefreshing} />
          ) : null}
          {mode === 'withdraw' ? (
            <WithdrawPanel runner={runner} chain={chain} refreshing={actionRefreshing} />
          ) : null}
        </div>
      </div>

      {/* The shared trove every position here sits in. It is the product, so it is on the
          screen in full, and it comes after the user's own money and the controls that act
          on it rather than in front of them. */}
      <SocialVaultPanel />

      <TxSheet runner={runner} />
    </Screen>
  );
}

/**
 * The screen's single column. Groups (your position, the controls, the shared vault) sit
 * 40px apart; anything inside a group sits 16px apart, so the eye reads three things, not
 * nine.
 */
function Screen({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div>
      {header}
      <div className="flex flex-col gap-10">{children}</div>
    </div>
  );
}

/** Cards that belong together inside one group. */
function Group({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

/** The position, as three readings on a rule rather than three stacked rows. */
function PositionStrip({
  livePrice,
  refreshing = false,
}: {
  livePrice: bigint | null;
  refreshing?: boolean;
}) {
  const { data: position } = usePosition();

  /**
   * The position's own health, classified by the SDK the same way Home classifies it: a
   * zero-amount preview of the position as read. Only when there is debt to be healthy
   * against and a live price to judge it by; otherwise there is no chip rather than a
   * guess.
   */
  const health =
    position && livePrice && position.debtWei > 0n
      ? previewBorrow(position, livePrice, 0n).health
      : null;

  return (
    <Panel
      title="Your position"
      meta={
        <>
          {refreshing ? <Refreshing /> : null}
          <span className="text-text-muted text-[0.8125rem]">
            {position && position.route !== 'pooled' ? 'Your own trove' : 'In the social vault'}
          </span>
          {health ? <HealthChip status={health.status} /> : null}
        </>
      }
    >
      <FactGroup>
        <Fact
          label="Collateral"
          value={position ? <Btc wei={position.collateralWei} /> : <Dash />}
          caption={
            position && livePrice
              ? formatUsd((position.collateralWei * livePrice) / 10n ** 18n)
              : 'needs a live price'
          }
        />
        <Fact
          label="Total debt"
          value={position ? <Musd wei={position.debtWei} /> : <Dash />}
          caption={
            position?.route === 'direct'
              ? 'includes the 200 MUSD reserve'
              : 'no reserve, social vault'
          }
        />
        <Fact
          label="Borrow limit"
          value={position ? <Musd wei={position.maxBorrowingCapacityWei} /> : <Dash />}
          caption="fixed when this trove opened"
        />
      </FactGroup>
    </Panel>
  );
}

/**
 * The foot of every action panel: the reason a control is disabled, then the control,
 * then the one sentence about what it costs. In that order because that is the order
 * someone reads them in before pressing.
 */
function ActionFooter({ notes, children }: { notes?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-t border-[var(--border-hairline)] px-5 py-5">
      {notes}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
        {children}
      </div>
    </div>
  );
}

/** The cost line beside an action button. A sentence people read, so it is not subtle. */
function CostLine({ children }: { children: ReactNode }) {
  return <span className="text-text-muted max-w-[52ch] text-xs leading-relaxed">{children}</span>;
}

/** Full width on a phone, where the thumb is; its own size beside the cost line above. */
const BUTTON = 'w-full sm:w-auto';

/** An amount is a short number. The field stops at a flow's width, not the column's. */
const FIELD = 'max-w-[520px]';

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
 * The repair anyone can run, offered exactly where borrowing is refused.
 *
 * When the shared trove is under its floor because collateral sits idle in the vault, the
 * fix used to wait for a person with the keeper key. MarenAutoKeeper made it public: the
 * contract decides how much idle BTC to push and refuses when nothing is needed, so this
 * renders only when the contract itself says a push would help, and says what it moves.
 * Self-paid and never relayed, so it works with the relayer down.
 */
function RestoreBorrowing({ runner }: { runner: TxRunner }) {
  const keeper = getMarenAddresses(NETWORK).marenAutoKeeper;
  const deployed = isDeployed(keeper);
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const amount = useReadContract({
    address: keeper,
    abi: marenAutoKeeperAbi,
    functionName: 'rebalanceAmount',
    chainId: getChain(NETWORK).id,
    query: { enabled: deployed, refetchInterval: 30_000 },
  });
  const wei = typeof amount.data === 'bigint' ? amount.data : 0n;
  if (!deployed || wei === 0n) return null;

  const intent = (): TxIntent => ({
    title: 'Move idle collateral into the shared trove',
    successTitle: 'Moved idle collateral into the trove',
    details: [
      { label: 'Amount', value: <Btc wei={wei} /> },
      { label: 'From', value: <span>The vault’s idle collateral</span> },
      { label: 'To', value: <span>The shared Mezo trove</span> },
      {
        label: 'Your position',
        value: <span className="text-text-muted">unchanged</span>,
      },
    ],
    gas: { sponsored: false, note: 'You pay the BTC gas, a fraction of a cent. Not relayed.' },
    submit: () => writes.rebalanceVault(),
    confirmLabel: 'Move collateral',
  });

  return (
    <div className="mt-3 flex flex-col gap-3 border border-[var(--border-hairline)] p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-text-muted max-w-[52ch] text-sm leading-relaxed">
        <span className="text-text">Anyone can fix this.</span> <Btc wei={wei} /> of the vault’s own
        collateral is sitting idle beside the trove. Moving it in brings borrowing back for
        everyone. The contract decides the amount and cannot touch any position.
      </p>
      <ActionButton
        variant="secondary"
        onClick={() => runner.request(intent())}
        disabled={!writes.ready}
      >
        Restore borrowing
      </ActionButton>
    </div>
  );
}

function BorrowPanel({
  runner,
  chain,
  onDeposit,
  refreshing,
}: {
  runner: TxRunner;
  chain: VaultState;
  onDeposit: () => void;
  refreshing: boolean;
}) {
  const { position: accountPosition, price, stats } = chain;
  const position = useMemo(
    () => (accountPosition ? borrowPosition(accountPosition, stats) : undefined),
    [accountPosition, stats],
  );
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const relayer = useRelayerStatus();
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
   * Below the 250% we recommend, the resulting ratio shifts from neutral to amber. Above
   * it, the figure is neutral like every other figure on the screen — BRAND.md §2's
   * one-accent rule holds either way, because only ONE figure here ever takes a colour.
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
        label: 'Origination fee on new pool debt',
        value: preview ? <Musd wei={preview.originationFeeWei} /> : <Dash />,
      },
      {
        label: 'Liquidation reserve',
        value:
          position?.route === 'direct' ? (
            <span className="text-text-muted">
              <Musd wei={LIQUIDATION_RESERVE} />, refunded on close
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
        ? gasNote(
            actionIsRelayable('borrowMusd'),
            'Draws MUSD against the social vault’s shared trove.',
            relayer,
          )
        : {
            sponsored: false,
            note: 'Costs BTC gas. Maren does not sponsor direct-trove operations.',
          },
    caution: belowRecommendation
      ? `Bitcoin would only need to fall ${dropPercent}% to liquidate this position.`
      : undefined,
    confirmLabel: `Borrow ${formatMusd(value)}`,
    submit: writes.ready
      ? () => writes.borrowMusd(value, { sponsorable: position?.route === 'pooled' })
      : undefined,
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
      <Panel title="Borrow MUSD" meta={refreshing ? <Refreshing /> : null}>
        <div className="px-5 py-6">
          <EmptyState
            icon={<VaultIcon className="size-6" />}
            title="Deposit first"
            action={
              <ActionButton
                onClick={onDeposit}
                icon={<ArrowRight className="size-4" />}
                className={BUTTON}
              >
                Deposit Bitcoin
              </ActionButton>
            }
          >
            Borrowing needs collateral. {formatApr(INTEREST_RATE_BPS)}, fixed.
          </EmptyState>
          {range.blocker && range.blocker.scope === 'pool' ? (
            <div className="mt-5">
              <BlockedNote blocker={range.blocker} />
            </div>
          ) : null}
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Borrow MUSD"
      meta={
        <>
          {refreshing ? <Refreshing /> : null}
          <span data-contrast="route-body" className="text-text-muted text-[0.8125rem]">
            {formatApr(INTEREST_RATE_BPS)}, fixed for the life of this loan
          </span>
        </>
      }
    >
      {/*
        THE REFUSAL COMES FIRST WHEN NOTHING CAN SUCCEED.

        This copy used to live in a modal, after the user had paid for the revert that
        produced it. When the whole range is unreachable it belongs here, above the
        slider, before anything has been touched, because its entire content is "do not
        bother touching this, and here is why it is not your fault". `role="status"`
        rather than `alert`: it is present on first paint, and an alert that fires the
        instant a screen reader lands on the Vault is an interruption, not information.
      */}
      {range.blocker && range.rangeDead ? (
        <div className="px-5 pt-5">
          <BlockedNote blocker={range.blocker} id="borrow-blocked" />
          {range.blocker.name === 'TroveCollateralRatioTooLow' ? (
            <RestoreBorrowing runner={runner} />
          ) : null}
        </div>
      ) : null}

      {/* The control, and the amount it sets, adjacent. */}
      <div className="px-5 pb-5 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2.5">
            <Num size="xl" tone={range.rangeDead ? 'subtle' : 'default'}>
              {formatMusd(value, { unit: false })}
            </Num>
            <span className="text-text-muted text-lg">MUSD</span>
          </div>
          {preview ? <HealthChip status={preview.health.status} /> : null}
        </div>

        <div className="mt-5">
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
              end: range.rangeDead
                ? '0 MUSD'
                : formatMusd(ceiling?.amountWei ?? 0n, { unit: false }),
            }}
          />
        </div>

        {ceiling && ceiling.amountWei > 0n && !range.rangeDead ? (
          <p className="text-text-muted mt-4 max-w-[68ch] text-xs leading-relaxed">
            {ceiling.binding === 'pool'
              ? 'Capped by the shared trove’s collateral buffer, including the fee on any new debt.'
              : ceiling.binding === 'ceiling'
                ? `Capped by Mezo’s per-trove ceiling. Your ratio would allow ${formatMusd(ceiling.ratioHeadroomWei)}.`
                : `Capped by Maren’s ${policyRatio(MAREN_POLICY.minHealthyCr)} floor. Mezo’s ceiling would allow ${formatMusd(ceiling.mezoHeadroomWei)}.`}
          </p>
        ) : null}
      </div>

      {/* The shared trove's own figure, stated beside the refusal it causes. Without it
          the explanation above is an assertion; with it, anyone can check it. */}
      {range.rangeDead && stats ? (
        <div className="border-t border-[var(--border-hairline)]">
          <FactGroup>
            <Fact
              label="Vault health"
              value={
                <Num className="text-warning" tone="inherit">
                  {formatCollateralRatio(stats.troveIcrWei)}
                </Num>
              }
              caption={`must be at or above ${policyRatio(MAREN_VAULT.minTroveCr)} for anyone to borrow`}
            />
            <Fact
              label="Your collateral"
              value={position ? <Btc wei={position.collateralWei} /> : <Dash />}
              caption="untouched, and withdrawable"
            />
            <Fact
              label="Your debt"
              value={position ? <Musd wei={position.debtWei} /> : <Dash />}
              caption="unaffected by the pool’s ratio"
            />
          </FactGroup>
        </div>
      ) : null}

      {/* Every figure here is derived from the debt this borrow WOULD create, so each one
          dashes while that debt is still zero rather than quoting a liquidation price for
          a loan nobody has taken. */}
      {preview ? (
        <>
          <div className="border-t border-[var(--border-hairline)]">
            <FactGroup>
              <Fact
                label="Resulting ratio"
                value={
                  <RatioOrDash
                    cr={preview.collateralRatio}
                    debtWei={preview.debtWei}
                    tone={ratioTone ? 'inherit' : 'default'}
                    className={ratioTone?.text ?? ''}
                  />
                }
                caption={healthLabel[preview.health.status]}
              />
              <Fact
                label="Liquidation price"
                value={
                  <LiquidationPrice wei={preview.liquidationPriceWei} debtWei={preview.debtWei} />
                }
                caption="pooled positions liquidate at 140%"
              />
              <Fact
                label="Bitcoin can fall"
                value={
                  <DropToLiquidation
                    bps={preview.health.priceDropToLiquidationBps}
                    debtWei={preview.debtWei}
                  />
                }
                caption="from today’s price"
              />
            </FactGroup>
          </div>

          <div className="border-t border-[var(--border-hairline)]">
            <FactGroup layout="rows">
              <Fact
                label="Origination fee"
                caption="applies only above the pool’s existing MUSD reserve"
                value={<Musd wei={preview.originationFeeWei} />}
              />
              <Fact
                label="Liquidation reserve"
                caption="refunded when the trove closes"
                value={
                  position?.route === 'direct' ? (
                    <Musd wei={LIQUIDATION_RESERVE} />
                  ) : (
                    <span className="text-text-muted text-sm">none on this route</span>
                  )
                }
              />
              <Fact label="Total debt after" value={<Musd wei={preview.debtWei} />} />
            </FactGroup>
          </div>
        </>
      ) : null}

      <ActionFooter
        notes={
          <>
            {belowRecommendation ? (
              <p className="text-warning max-w-[68ch] text-sm leading-relaxed" role="status">
                Bitcoin would only need to fall {dropPercent}% to liquidate this, below the{' '}
                {policyRatio(MAREN_POLICY.targetCr)} we recommend.
              </p>
            ) : null}

            {/* A blocker that is about THIS amount rather than the whole range sits by the
                button, which is where the user is looking when they find out. */}
            {!range.rangeDead && worthStating(pre, value) && pre.blocker ? (
              <BlockedNote blocker={pre.blocker} id="borrow-amount-blocked" role="alert" />
            ) : null}
          </>
        }
      >
        <ActionButton
          onClick={() => runner.request(intent())}
          disabled={!pre.ok || !writes.ready}
          aria-describedby={range.rangeDead ? 'borrow-blocked' : 'borrow-amount-blocked'}
          icon={<ArrowRight className="size-4" />}
          className={BUTTON}
        >
          {value > 0n ? `Borrow ${formatMusd(value)}` : 'Borrow'}
        </ActionButton>
        {/* The gas claim, kept true and kept beside the button that incurs it. Same
            expression the intent uses, so the line under the button and the line in
            the sheet it opens cannot disagree. */}
        <CostLine>
          {gasLine(position?.route === 'pooled' && actionIsRelayable('borrowMusd'), relayer)}
        </CostLine>
      </ActionFooter>
    </Panel>
  );
}

function DepositPanel({
  runner,
  chain,
  refreshing,
}: {
  runner: TxRunner;
  chain: VaultState;
  refreshing: boolean;
}) {
  const { position, price } = chain;
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const [input, setInput] = useState('0.05');
  const wei = parseUnitsSafe(input);
  const livePrice = price.state === 'live' ? price.priceWei : null;

  const pre = preflightDeposit(chain, wei);

  /** What this account holds once this deposit confirms. The route is judged on it. */
  const collateralAfter = (position?.collateralWei ?? 0n) + wei;

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
        // Not "route after". `MarenVault.deposit()` has no branch that opens a trove of
        // your own, so the destination of THIS transaction is never in question, whatever
        // the collateral afterwards would qualify for.
        label: 'Where it goes',
        value: <span className="text-text-muted">The social vault</span>,
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
      note: 'A deposit carries Bitcoin with the call, so it can never be sponsored. You pay the Bitcoin gas for this one, today and always.',
    },
    confirmLabel: `Deposit ${formatBtc(wei)}`,
    submit: writes.ready ? () => writes.depositBtc(wei) : undefined,
  });

  return (
    <Panel
      title="Deposit Bitcoin"
      meta={
        <>
          {refreshing ? <Refreshing /> : null}
          <span className="text-text-muted text-[0.8125rem]">
            Raises your ratio the moment it confirms
          </span>
        </>
      }
    >
      {/* THE DECISION, BEFORE THE AMOUNT FIELD. It is a function of the amount, so it sits
          next to the control that sets it and moves as that control moves. */}
      <div className="px-5 py-5">
        <RouteChoice collateralWei={collateralAfter} priceWei={livePrice} />
      </div>

      <div className="border-t border-[var(--border-hairline)] px-5 py-5">
        <div className={FIELD}>
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
          />
        </div>
      </div>

      {position ? (
        <div className="border-t border-[var(--border-hairline)]">
          <FactGroup layout="rows">
            <Fact label="Collateral after" value={<Btc wei={collateralAfter} />} />
            <Fact
              label="Where it goes"
              value={<span className="text-text text-[0.9375rem]">The social vault</span>}
            />
          </FactGroup>
        </div>
      ) : null}

      <ActionFooter
        notes={
          worthStating(pre, wei) && pre.blocker ? (
            <BlockedNote
              blocker={pre.blocker}
              id="deposit-blocked"
              role={pre.rangeDead ? 'status' : 'alert'}
            />
          ) : null
        }
      >
        <ActionButton
          onClick={() => runner.request(intent())}
          disabled={!pre.ok || !writes.ready}
          aria-describedby="deposit-blocked"
          icon={<ArrowRight className="size-4" />}
          className={BUTTON}
        >
          Deposit {wei > 0n ? formatBtc(wei) : ''}
        </ActionButton>
        {/* The one action Maren can never sponsor, said before the user signs it. */}
        <CostLine>A deposit costs Bitcoin gas and always will, because it carries value.</CostLine>
      </ActionFooter>
    </Panel>
  );
}

function RepayPanel({
  runner,
  chain,
  refreshing,
}: {
  runner: TxRunner;
  chain: VaultState;
  refreshing: boolean;
}) {
  const { position, balances } = chain;
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const relayer = useRelayerStatus();
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
        value: <span className="mono text-text-muted break-all text-xs">{SPENDERS.vault}</span>,
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
      note: 'Approves exactly this amount, not an unlimited allowance. You pay the Bitcoin gas.',
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
      actionIsRelayable('repayMusd'),
      'Repaying is never paused and never gated on the oracle. An exit must always be open.',
      relayer,
    ),
    confirmLabel: `Repay ${formatMusd(wei)}`,
    submit: writes.ready ? () => writes.repayMusd(wei) : undefined,
  });

  return (
    <Panel
      title="Repay debt"
      meta={
        <>
          {refreshing ? <Refreshing /> : null}
          <span className="text-text-muted text-[0.8125rem]">
            Interest is simple, never compounding
          </span>
        </>
      }
    >
      <div className="px-5 py-5">
        <div className={FIELD}>
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
      </div>

      {position ? (
        <div className="border-t border-[var(--border-hairline)]">
          <FactGroup layout="rows">
            <Fact label="Debt after" value={<Musd wei={debtAfter} />} />
          </FactGroup>
        </div>
      ) : null}

      <ActionFooter
        notes={
          <>
            {worthStating(pre, wei) && pre.blocker ? (
              <BlockedNote
                blocker={pre.blocker}
                id="repay-blocked"
                role={pre.rangeDead ? 'status' : 'alert'}
              />
            ) : null}

            {pre.ok && needsApproval ? (
              <Note>
                The vault needs an allowance for {formatMusd(wei)} first. That is a separate
                transaction, shown here rather than slipped in behind the repay.
              </Note>
            ) : null}
          </>
        }
      >
        {needsApproval ? (
          <ActionButton
            onClick={() => runner.request(approvalIntent())}
            disabled={!pre.ok || !writes.ready}
            aria-describedby="repay-blocked"
            icon={<ArrowRight className="size-4" />}
            className={BUTTON}
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
          className={BUTTON}
        >
          Repay {wei > 0n ? formatMusd(wei) : ''}
        </ActionButton>
        <CostLine>Repay stays open when the oracle is stale.</CostLine>
      </ActionFooter>
    </Panel>
  );
}

function WithdrawPanel({
  runner,
  chain,
  refreshing,
}: {
  runner: TxRunner;
  chain: VaultState;
  refreshing: boolean;
}) {
  const { position } = chain;
  const writes = useMarenWrites({ onSimulated: runner.onSimulated });
  const relayer = useRelayerStatus();
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
      actionIsRelayable('withdrawBtc'),
      'Withdrawal is never paused: if Maren halts the vault, entries close and exits stay open.',
      relayer,
    ),
    confirmLabel: `Withdraw ${formatBtc(wei)}`,
    submit: writes.ready ? () => writes.withdrawBtc(wei) : undefined,
  });

  return (
    <Panel
      title="Withdraw Bitcoin"
      meta={
        <>
          {refreshing ? <Refreshing /> : null}
          <span className="text-text-muted text-[0.8125rem]">
            Already capped at Maren’s {policyRatio(MAREN_POLICY.minHealthyCr)} floor
          </span>
        </>
      }
    >
      <div className="px-5 py-5">
        <div className={FIELD}>
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
      </div>

      {position ? (
        <div className="border-t border-[var(--border-hairline)]">
          <FactGroup layout="rows">
            <Fact label="Collateral after" value={<Btc wei={collateralAfter} />} />
          </FactGroup>
        </div>
      ) : null}

      <ActionFooter
        notes={
          worthStating(pre, wei) && pre.blocker ? (
            <BlockedNote
              blocker={pre.blocker}
              id="withdraw-blocked"
              role={pre.rangeDead ? 'status' : 'alert'}
            />
          ) : null
        }
      >
        <ActionButton
          onClick={() => runner.request(intent())}
          disabled={!pre.ok || !writes.ready}
          aria-describedby="withdraw-blocked"
          icon={<ArrowRight className="size-4" />}
          className={BUTTON}
        >
          Withdraw {wei > 0n ? formatBtc(wei) : ''}
        </ActionButton>
        <CostLine>Withdrawal is never paused. If Maren halts the vault, exits stay open.</CostLine>
      </ActionFooter>
    </Panel>
  );
}
