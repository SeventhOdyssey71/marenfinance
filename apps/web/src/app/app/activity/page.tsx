'use client';

import { useState } from 'react';
import { formatBtc, formatMusd, getChain, shortAddress, shortHash } from '@maren/sdk';

import { ConnectPrompt } from '@/components/app/connect-prompt';
import { Segmented } from '@/components/app/controls';
import { Btc, Num } from '@/components/app/money';
import { EmptyState, Info, Label, Loading, Note, Panel } from '@/components/app/primitives';
import { ArrowUpRight } from '@/components/ui/icons';
import { activityDirection, activityTitle, statusLabel, timeAgo } from '@/lib/copy';
import { NETWORK, useActivity, useDataSource } from '@/lib/data/source';
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
 */
export default function ActivityPage() {
  const source = useDataSource();
  const { data: window, isPending, error } = useActivity();
  const [filter, setFilter] = useState<Filter>('all');

  const items = window?.items ?? [];
  const rows = items.filter((item) => filter === 'all' || GROUPS[filter].includes(item.kind));

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
}: {
  connected: boolean;
  filter: Filter;
  setFilter: (f: Filter) => void;
  rows: ActivityItem[];
  items: ActivityItem[];
  window: ReturnType<typeof useActivity>['data'];
  isPending: boolean;
  error: unknown;
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

  return (
    <>
      <Segmented options={FILTERS} value={filter} onChange={setFilter} label="Activity filter" />

      <Panel title={`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}>
        <div className="px-5">
          {rows.map((item, index) => (
            <Row key={item.id} item={item} last={index === rows.length - 1} />
          ))}
          {rows.length === 0 ? (
            <div className="py-6">
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
          ) : null}
        </div>
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

function Row({ item, last }: { item: ActivityItem; last: boolean }) {
  const direction = activityDirection(item.kind);
  const amount =
    item.musdWei !== undefined
      ? formatMusd(item.musdWei)
      : item.btcWei !== undefined
        ? formatBtc(item.btcWei)
        : null;

  const statusClass =
    item.status === 'failed'
      ? 'text-danger'
      : item.status === 'pending'
        ? 'text-warning'
        : 'text-text-subtle';

  // A counterparty is either a handle the payer actually typed on-chain or a raw address.
  // Addresses are shortened for the row; nothing is looked up to make them prettier,
  // because a name the chain did not record is a name we would be inventing.
  const counterparty = item.counterparty
    ? item.counterparty.startsWith('@')
      ? item.counterparty
      : shortAddress(item.counterparty)
    : undefined;

  return (
    <div
      className={`flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5 py-3 ${
        last ? '' : 'border-b border-[var(--border-hairline)]'
      }`}
    >
      <div className="min-w-0">
        <p className="text-text truncate text-sm">{activityTitle(item.kind, counterparty)}</p>
        <p className="text-text-subtle mt-1 flex flex-wrap items-center gap-x-2 text-xs">
          <span>{item.at > 0 ? timeAgo(item.at) : 'time unknown'}</span>
          <span aria-hidden>·</span>
          <span className={statusClass}>{statusLabel(item.status)}</span>
          {item.memo ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{item.memo}</span>
            </>
          ) : null}
          {item.hash ? (
            <a
              href={`${explorer.url}/tx/${item.hash}`}
              target="_blank"
              rel="noreferrer noopener"
              className="num text-text-subtle hover:text-text inline-flex items-center gap-1 rounded-[var(--radius-pill)] transition-colors duration-[120ms] ease-out"
            >
              {shortHash(item.hash)}
              <ArrowUpRight className="size-3" />
              <span className="sr-only">open on {explorer.name}</span>
            </a>
          ) : null}
        </p>
      </div>

      <div className="shrink-0 text-right">
        {amount ? (
          <Num size="md">
            {direction === 'out' ? '−' : direction === 'in' ? '+' : ''}
            {amount}
          </Num>
        ) : null}
        <p className="text-text-subtle mt-1 text-xs">
          {item.sponsored ? (
            'Gas paid by a relayer'
          ) : (
            <>
              {/* `Btc` rather than a bare `formatBtc`, because Mezo's gas price is a few
                  hundred wei and a real fee of 0.000000029 BTC rounds to "0 BTC" at the
                  display precision. Rendering zero for a fee that was genuinely paid is a
                  small lie of the same family as the ones this pass removed, so the exact
                  figure stays reachable in the hover title — BRAND.md §8. */}
              Gas <Btc wei={item.gasPaidWei} size="sm" tone="subtle" />
            </>
          )}
        </p>
      </div>
    </div>
  );
}
