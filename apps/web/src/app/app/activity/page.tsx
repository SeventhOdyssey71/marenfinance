'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { WAD, formatBtc, formatMusd, getChain, shortAddress, shortHash } from '@maren/sdk';
import type { Address } from 'viem';

import { ConnectPrompt } from '@/components/app/connect-prompt';
import { Segmented } from '@/components/app/controls';
import { Btc, Num } from '@/components/app/money';
import { EmptyState, Info, Label, Loading, Note, Panel } from '@/components/app/primitives';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  CopyIcon,
  EarnIcon,
  LinkIcon,
  PayIcon,
  VaultIcon,
} from '@/components/ui/icons';
import { explorerTxUrl } from '@/components/app/tx';
import { activityDirection, activityTitle, statusLabel, timeAgo } from '@/lib/copy';
import { NETWORK, useActivity, useCounterpartyHandles, useDataSource } from '@/lib/data/source';
import type { ActivityItem, ActivityKind } from '@/lib/data/types';
import { RELAYER_CONFIGURED } from '@/lib/chain/relay';

type Filter = 'all' | 'payments' | 'vault' | 'earn';

const FILTERS = [
  { key: 'all' as const, label: 'All' },
  { key: 'payments' as const, label: 'Payments' },
  { key: 'vault' as const, label: 'Vault' },
  { key: 'earn' as const, label: 'Earn' },
];

const GROUPS: Record<Exclude<Filter, 'all'>, readonly ActivityKind[]> = {
  payments: ['send', 'receive', 'link-created', 'link-claimed', 'request-created'],
  vault: ['deposit', 'withdraw', 'borrow', 'repay'],
  earn: ['earn-deposit', 'earn-withdraw'],
};

const explorer = getChain(NETWORK).blockExplorers.default;

/**
 * Activity — the ledger, and the screen this whole pass was called in over.
 *
 * WHAT WAS HERE BEFORE. A seeded list: payments to `@nadia`, `@okonkwo` and `@mira`, with
 * invented amounts, invented timestamps and invented transaction hashes rendered as
 * working links to `explorer.test.mezo.org`, under a header that said "Live from Mezo
 * testnet". None of those transactions existed. A reviewer following one of those links
 * would have learned that this app makes up chain history, and been right to distrust
 * every other figure in it.
 *
 * WHAT IS HERE NOW. `eth_getLogs` against `MarenVault`, `MarenPay` and `MarenEarn`,
 * decoded in `lib/chain/logs.ts`. Every row is an event the node returned; every hash is a
 * hash the node gave us; every amount is an event parameter; every timestamp is the
 * timestamp of the block the event was in. When there is nothing, the screen says nothing
 * — it does not seed itself so the page looks busier.
 *
 * THE RANGE IS PART OF THE ANSWER. Mezo's RPC caps a log query at 10,000 blocks, so this
 * reads a bounded window rather than all of history, and the empty state distinguishes
 * "we read everything since deployment and you have done nothing" from "we read the last
 * few days". Those are different claims and only one of them is a fact about the user.
 *
 * THE PRESENTATION IS TALISE'S, THE DATA IS MEZO'S. Rows carry a direction badge, an
 * asset-coloured amount and a per-transaction receipt, ported from Talise's history UI —
 * but not one field is drawn from anything except a decoded log or an on-chain read.
 */
export default function ActivityPage() {
  const source = useDataSource();
  const { data: window, isPending, error } = useActivity();
  const [filter, setFilter] = useState<Filter>('all');

  const items = useMemo(() => window?.items ?? [], [window]);
  const rows = items.filter((item) => filter === 'all' || GROUPS[filter].includes(item.kind));

  /**
   * The counterparty addresses worth asking the registry about: rows that recorded a raw
   * address rather than a handle the payer typed. Gathered here — at the top of the only
   * component that always renders — so the reverse-resolution hook is called
   * unconditionally, and passed down to the rows that need it.
   */
  const addressesToResolve = useMemo(
    () =>
      items
        .filter((item) => item.counterpartyAddress && !item.counterparty?.startsWith('@'))
        .map((item) => item.counterpartyAddress as Address),
    [items],
  );
  const handles = useCounterpartyHandles(addressesToResolve);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>Activity</Label>
        <h1 className="t-h3 mt-1.5">History</h1>
      </div>

      <Body
        connected={source.connected}
        filter={filter}
        setFilter={setFilter}
        rows={rows}
        items={items}
        window={window}
        isPending={isPending}
        error={error}
        handles={handles}
      />
    </div>
  );
}

function Body({
  connected,
  filter,
  setFilter,
  rows,
  items,
  window,
  isPending,
  error,
  handles,
}: {
  connected: boolean;
  filter: Filter;
  setFilter: (f: Filter) => void;
  rows: ActivityItem[];
  items: ActivityItem[];
  window: ReturnType<typeof useActivity>['data'];
  isPending: boolean;
  error: unknown;
  handles: Map<string, string>;
}) {
  /**
   * Two different absences, two different screens. Disconnected means the query never
   * runs, so pending-forever is the resting state and "connect" is the answer. Connected
   * with no data yet means the log scan is IN FLIGHT — telling that user to connect,
   * while their address sits in the header, was this page's bug: it conflated the two
   * because both look like `!window && isPending` from inside the query.
   */
  if (!connected) {
    return <ActivityUnread />;
  }

  if (!window && !error && isPending) {
    return <Loading>Reading your history from Maren&rsquo;s contract logs&hellip;</Loading>;
  }

  /**
   * A failed scan is NOT an empty history.
   *
   * This is the distinction the old screen could not make, because it never read anything
   * that could fail. Rendering "nothing yet" after a transport error would tell someone
   * their transactions had vanished.
   */
  if (error) {
    return (
      <Note tone="warning" role="alert">
        <p className="text-warning">Could not read your history</p>
        <p className="mt-1">
          Mezo’s RPC did not answer the log query, so this list is unknown rather than empty. Your
          transactions are unaffected. Nothing here reads or writes your position.{' '}
          {error instanceof Error ? error.message : ''}
        </p>
      </Note>
    );
  }

  const days = groupByDay(rows);

  return (
    <>
      <Segmented options={FILTERS} value={filter} onChange={setFilter} label="Activity filter" />

      <Panel title={`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}>
        {rows.length > 0 ? (
          <div className="px-5">
            {days.map((day) => (
              <section key={day.key} aria-label={day.label} className="pt-4 first:pt-3">
                <h3 className="t-label text-text-subtle pb-1">{day.label}</h3>
                <div>
                  {day.rows.map((item, index) => (
                    <Row
                      key={item.id}
                      item={item}
                      handles={handles}
                      last={index === day.rows.length - 1}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="px-5 py-6">
            {items.length > 0 ? (
              <EmptyState title="Nothing in this filter">
                You have history, just none of this kind. Switch back to All.
              </EmptyState>
            ) : window?.complete ? (
              <EmptyState title="Nothing here yet">
                This account has never transacted with Maren. We read every block since the
                contracts were deployed, so that is the whole story rather than a recent slice.
                Deposit Bitcoin in the Vault and the first row appears here.
              </EmptyState>
            ) : (
              <EmptyState title="Nothing in the blocks we could read">
                Mezo’s RPC answers 10,000 blocks at a time, so this scan covered the most recent
                stretch rather than all of history. Anything older than that is not shown and is
                not claimed to be absent.
              </EmptyState>
            )}
          </div>
        )}
      </Panel>

      {window ? <Coverage window={window} /> : null}

      {rows.length > 0 ? (
        <div>
          <Info summary="What these statuses mean">
            <ul className="space-y-2">
              <li>
                <span className="text-text">Confirmed</span>: a receipt came back successful. A
                transaction hash on its own is never shown as a result.
              </li>
              <li>
                <span className="text-text">Awaiting receipt</span>: we have a hash and no receipt
                yet. It may still land; check here before retrying.
              </li>
              <li>
                <span className="text-text">Failed, no funds moved</span>: mined, then reverted. A
                reverted transaction emits no events, so it can only appear here if its receipt says
                so.
              </li>
              <li>
                <span className="text-text">Gas</span>: what you actually paid in BTC, from the
                receipt.{' '}
                {RELAYER_CONFIGURED
                  ? 'A row reads as sponsored when the transaction was sent by Maren’s relayer rather than by you.'
                  : 'No relayer is deployed, so no row is sponsored today.'}
              </li>
            </ul>
          </Info>
        </div>
      ) : null}
    </>
  );
}

/** The state before a wallet exists. History is per-account; there is no general feed. */
function ActivityUnread() {
  return (
    <ConnectPrompt title="Connect to see your history">
      Activity is read from Maren’s contract logs for your address specifically. There is no sample
      history to show you. The app does not keep one.
    </ConnectPrompt>
  );
}

/**
 * How far back this list actually looked.
 *
 * Stated in blocks because blocks are exact and a converted date would not be: the only
 * honest way to turn a block number into a wall-clock time is to fetch that block, and
 * quoting "about 3 days" from an assumed block time is the kind of small invention this
 * screen exists to be free of.
 */
function Coverage({ window }: { window: NonNullable<ReturnType<typeof useActivity>['data']> }) {
  const span = (window.toBlock - window.fromBlock + 1n).toString();
  return (
    <p className="text-text-subtle text-xs leading-relaxed">
      {window.complete ? (
        <>
          Read every block from <span className="num">{window.fromBlock.toString()}</span>, where
          Maren was deployed, to <span className="num">{window.toBlock.toString()}</span>. That is
          the complete history.
        </>
      ) : (
        <>
          Read blocks <span className="num">{window.fromBlock.toString()}</span> to{' '}
          <span className="num">{window.toBlock.toString()}</span> ({span} blocks). Mezo’s public
          RPC caps a log query at 10,000 blocks, so older history needs an indexer. See{' '}
          <span className="num">apps/web/README.md</span>.
        </>
      )}
    </p>
  );
}

// ── one row, and the receipt behind it ───────────────────────────────────────

/**
 * A row is a native `<details>`: the summary is the ledger line, and expanding it reveals
 * the receipt in place. A disclosure rather than a modal because it works on touch,
 * survives no-JS, and is announced by a screen reader without any ARIA of ours — the same
 * reasoning as `primitives.tsx`'s `Info`.
 */
function Row({
  item,
  handles,
  last,
}: {
  item: ActivityItem;
  handles: Map<string, string>;
  last: boolean;
}) {
  const direction = activityDirection(item.kind);
  const counterparty = counterpartyLabel(item, handles);

  const statusTone =
    item.status === 'failed'
      ? 'text-danger'
      : item.status === 'pending'
        ? 'text-warning'
        : 'text-text-subtle';

  return (
    <details className={`group ${last ? '' : 'border-b border-[var(--border-hairline)]'}`}>
      <summary className="marker:content-none flex cursor-pointer list-none items-center gap-3 rounded-[var(--radius-input)] py-3">
        <Badge kind={item.kind} />

        <div className="min-w-0 flex-1">
          <p className="text-text truncate text-sm">{activityTitle(item.kind, counterparty)}</p>
          <p className="text-text-subtle mt-1 flex flex-wrap items-center gap-x-2 text-xs">
            <span>{item.at > 0 ? timeAgo(item.at) : 'time unknown'}</span>
            <span aria-hidden>·</span>
            <span className={statusTone}>{statusLabel(item.status)}</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <LedgerAmount item={item} direction={direction} />
          {/* The affordance that says the row opens. Rotates on open; the chevron is the
              only thing that moves, so the motion names `transform` alone. */}
          <ArrowDown
            aria-hidden
            className="text-text-subtle size-4 transition-transform duration-200 ease-out group-open:rotate-180"
          />
        </div>
      </summary>

      <Receipt item={item} counterparty={counterparty} />
    </details>
  );
}

/**
 * The circular direction badge, Talise's shape in Maren's palette.
 *
 * The disc stays neutral — a hairline well — and the glyph carries the row's asset colour,
 * so badge and amount agree on what moved. Colour here means "which asset", never "good or
 * bad": BRAND.md §2 keeps the semantic reds and greens for health, not for a ledger.
 */
function Badge({ kind }: { kind: ActivityKind }) {
  const { Icon, tone } = badgeFor(kind);
  return (
    <span className="bg-surface-inset grid size-9 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)]">
      <Icon className={`size-4 ${tone}`} />
    </span>
  );
}

function badgeFor(kind: ActivityKind): {
  Icon: typeof ArrowUpRight;
  tone: string;
} {
  switch (kind) {
    case 'send':
      return { Icon: ArrowUpRight, tone: 'text-musd' };
    case 'receive':
      return { Icon: ArrowDown, tone: 'text-musd' };
    case 'deposit':
      return { Icon: VaultIcon, tone: 'text-btc' };
    case 'withdraw':
      return { Icon: VaultIcon, tone: 'text-btc' };
    case 'borrow':
      return { Icon: ArrowDown, tone: 'text-musd' };
    case 'repay':
      return { Icon: ArrowUpRight, tone: 'text-musd' };
    case 'earn-deposit':
      return { Icon: EarnIcon, tone: 'text-musd' };
    case 'earn-withdraw':
      return { Icon: EarnIcon, tone: 'text-musd' };
    case 'link-created':
      return { Icon: LinkIcon, tone: 'text-musd' };
    case 'link-claimed':
      return { Icon: LinkIcon, tone: 'text-musd' };
    case 'request-created':
      return { Icon: PayIcon, tone: 'text-musd' };
  }
}

/**
 * The amount, signed, with the fractional part and unit greyed so the eye lands on the
 * figure that matters. Asset-coloured — BTC amber, MUSD green — with the exact,
 * unabbreviated value on hover per BRAND.md §8.
 */
function LedgerAmount({
  item,
  direction,
}: {
  item: ActivityItem;
  direction: 'in' | 'out' | 'none';
}) {
  const isMusd = item.musdWei !== undefined;
  const wei = isMusd ? item.musdWei : item.btcWei;
  if (wei === undefined) return null;

  const unit = isMusd ? 'MUSD' : 'BTC';
  const formatted = isMusd ? formatMusd(wei, { unit: false }) : formatBtc(wei, { unit: false });
  const [whole, frac] = formatted.split('.');
  const sign = direction === 'out' ? '−' : direction === 'in' ? '+' : '';

  return (
    <Num size="md" tone={isMusd ? 'musd' : 'btc'} title={exactValue(wei, unit)}>
      {sign}
      {whole}
      {frac ? <span className="text-text-subtle">.{frac}</span> : null}
      <span className="text-text-subtle"> {unit}</span>
    </Num>
  );
}

/**
 * The receipt: the mechanical facts behind a row, revealed in place.
 *
 * Every line is read off the decoded log or its receipt. Gas is stated honestly — a
 * sponsored transaction says so and quotes nothing, a direct one quotes the exact BTC from
 * the receipt — and the hash is a link to the explorer, never dressed up as a result on
 * its own. The block number is shown because it is exact, where the relative time is not.
 */
function Receipt({ item, counterparty }: { item: ActivityItem; counterparty?: string }) {
  const partyLabel = item.kind === 'receive' ? 'From' : item.kind === 'send' ? 'To' : null;

  return (
    <div className="bg-surface-inset mb-3 rounded-[var(--radius-input)] border border-[var(--border-hairline)] px-4">
      <dl>
        {partyLabel && counterparty ? (
          <DetailRow label={partyLabel}>
            <span className={counterparty.startsWith('@') ? '' : 'num'}>{counterparty}</span>
          </DetailRow>
        ) : null}

        {item.memo ? (
          <DetailRow label="Memo">
            <span className="break-words">{item.memo}</span>
          </DetailRow>
        ) : null}

        <DetailRow label="Status">
          <span
            className={
              item.status === 'failed'
                ? 'text-danger'
                : item.status === 'pending'
                  ? 'text-warning'
                  : 'text-text'
            }
          >
            {statusLabel(item.status)}
          </span>
        </DetailRow>

        <DetailRow label="When">
          {item.at > 0 ? (
            <span>{absoluteTime(item.at)}</span>
          ) : (
            <span className="text-text-subtle">time unknown</span>
          )}
        </DetailRow>

        {item.blockNumber !== undefined ? (
          <DetailRow label="Block">
            <span className="num">{item.blockNumber.toString()}</span>
          </DetailRow>
        ) : null}

        <DetailRow label="Network">
          <span>{explorer.name}</span>
        </DetailRow>

        <DetailRow label="Gas">
          {item.status === 'pending' ? (
            <span className="text-text-subtle">not settled yet</span>
          ) : item.sponsored ? (
            <span className="text-text">Sponsored. No gas paid by you</span>
          ) : (
            // `Btc` not a bare `formatBtc`: Mezo's gas is a few hundred wei and a real fee
            // of 0.000000029 BTC rounds to "0 BTC" at display precision, so the exact
            // figure stays reachable in the hover title — BRAND.md §8.
            <Btc wei={item.gasPaidWei} size="sm" />
          )}
        </DetailRow>

        {item.hash ? <HashRow hash={item.hash} /> : null}
      </dl>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border-hairline)] py-3 last:border-b-0">
      <dt className="text-text-muted shrink-0 text-sm">{label}</dt>
      <dd className="text-text min-w-0 text-right text-sm">{children}</dd>
    </div>
  );
}

/**
 * The transaction hash: truncated, with a copy affordance and the explorer link. Reuses
 * `explorerTxUrl` from `tx.tsx` so the sheet and the receipt cannot point at different
 * explorers, and `shortHash` from the SDK so web and iOS truncate identically. Nobody
 * reads 66 characters; the full value stays reachable through Copy and the `title`.
 */
function HashRow({ hash }: { hash: `0x${string}` }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1_800);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--border-hairline)] py-3 last:border-b-0">
      <dt className="text-text-muted shrink-0 text-sm">Transaction</dt>
      <dd className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          title={hash}
          onClick={() => {
            void navigator.clipboard?.writeText(hash);
            setCopied(true);
          }}
          className="num text-text-muted hover:text-text inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] text-xs transition-colors duration-[120ms] ease-out"
        >
          <span>{shortHash(hash)}</span>
          {/* Cross-fade on swap: the copy glyph fades, shrinks and blurs out while the
              check enters the same way. Both stay mounted; the transition names opacity,
              transform and filter — nothing else. */}
          <span className="relative grid size-3.5 place-items-center">
            <CopyIcon
              aria-hidden
              className={`absolute transition-[opacity,transform,filter] duration-150 ease-out ${
                copied ? 'scale-50 opacity-0 blur-[2px]' : 'scale-100 opacity-100 blur-0'
              }`}
            />
            <Check
              aria-hidden
              className={`text-success absolute transition-[opacity,transform,filter] duration-150 ease-out ${
                copied ? 'scale-100 opacity-100 blur-0' : 'scale-50 opacity-0 blur-[2px]'
              }`}
            />
          </span>
          <span className="sr-only">{copied ? 'Copied' : 'Copy the full transaction hash'}</span>
        </button>
        <a
          href={explorerTxUrl(hash)}
          target="_blank"
          rel="noreferrer noopener"
          className="text-text-muted hover:text-text inline-flex items-center gap-1.5 text-xs transition-colors duration-[120ms] ease-out"
        >
          Explorer
          <ArrowUpRight aria-hidden className="size-3.5" />
          <span className="sr-only">open this transaction on {explorer.name}</span>
        </a>
      </dd>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * A counterparty is the handle the payer actually typed on-chain, the registry's current
 * handle for the counterparty's address, or a shortened address — in that order of
 * honesty. `handles` is the reverse-resolution map from `useCounterpartyHandles`; a miss
 * means the row shows the address rather than a name the registry did not give.
 */
function counterpartyLabel(item: ActivityItem, handles: Map<string, string>): string | undefined {
  if (item.counterparty?.startsWith('@')) return item.counterparty;
  if (item.counterpartyAddress) {
    const resolved = handles.get(item.counterpartyAddress.toLowerCase());
    return resolved ?? shortAddress(item.counterpartyAddress);
  }
  return item.counterparty ? shortAddress(item.counterparty) : undefined;
}

/** The exact, unabbreviated amount for the hover title — BRAND.md §8. */
function exactValue(wei: bigint, unit: 'BTC' | 'MUSD'): string {
  const whole = wei / WAD;
  const frac = (wei % WAD).toString().padStart(18, '0');
  return unit === 'BTC' ? `${whole}.${frac} BTC exactly` : `${whole}.${frac} MUSD`;
}

interface DayGroup {
  key: string;
  label: string;
  rows: ActivityItem[];
}

/**
 * Group rows into days, newest first, preserving the incoming order within each day.
 *
 * Rows whose block timestamp could not be read (`at === 0`) are not forced into "today" —
 * that would be a fabricated date. They fall into a single "Time unknown" group, which is
 * the honest label for a real transaction with an unread timestamp.
 */
function groupByDay(rows: ActivityItem[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const row of rows) {
    const key = row.at > 0 ? dayKey(row.at) : 'unknown';
    let group = groups.get(key);
    if (!group) {
      group = { key, label: key === 'unknown' ? 'Time unknown' : dayLabel(row.at), rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()];
}

function dayKey(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** An absolute timestamp for the receipt — exact where the row's relative time is not. */
function absoluteTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
