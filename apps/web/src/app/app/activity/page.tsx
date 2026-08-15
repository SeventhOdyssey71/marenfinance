'use client';

import { useState } from 'react';
import { formatBtc, formatMusd, getChain, shortHash } from '@maren/sdk';

import { Segmented } from '@/components/app/controls';
import { Num } from '@/components/app/money';
import { AppCard, EmptyState, Info, Label } from '@/components/app/primitives';
import { ArrowUpRight } from '@/components/ui/icons';
import { activityDirection, activityTitle, statusLabel, timeAgo } from '@/lib/copy';
import { NETWORK, useActivity } from '@/lib/data/source';
import type { ActivityItem, ActivityKind } from '@/lib/data/types';

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
 * Activity — the ledger.
 *
 * Status is the point of this screen. Every row says which of the three states it is in,
 * and 'Failed — no funds moved' says so in as many words rather than hiding behind
 * "unsuccessful". A row is only ever 'Confirmed' because a receipt came back with
 * `status === 'success'`; a hash on its own leaves it 'Awaiting receipt'.
 *
 * Every row with a hash links to Mezo's explorer, so nothing here has to be taken on
 * Maren's word.
 */
export default function ActivityPage() {
  const { data: activity } = useActivity();
  const [filter, setFilter] = useState<Filter>('all');

  const rows = (activity ?? []).filter(
    (item) => filter === 'all' || GROUPS[filter].includes(item.kind),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Label>Activity</Label>
        <h1 className="t-h2 mt-2">History</h1>
        <p className="text-text-muted mt-3 max-w-[68ch] text-sm leading-relaxed">
          Every action, its gas, and a receipt on {explorer.name}.
        </p>
      </div>

      <Segmented options={FILTERS} value={filter} onChange={setFilter} label="Activity filter" />

      <AppCard className="p-0">
        <div className="px-6">
          {rows.map((item, index) => (
            <Row key={item.id} item={item} last={index === rows.length - 1} />
          ))}
          {rows.length === 0 ? (
            <div className="py-6">
              <EmptyState title="Nothing here yet">
                {filter === 'all'
                  ? 'Your deposits, borrows and payments will appear here.'
                  : 'Nothing in this filter.'}
              </EmptyState>
            </div>
          ) : null}
        </div>
      </AppCard>

      {/* The status vocabulary is load-bearing — a user deciding whether to retry a
          payment needs to know that a hash is not a result — but it is reference
          material, not something to read on every visit. */}
      {/* No card around it: a whole panel holding one collapsed link is exactly the kind
          of container-for-its-own-sake this pass removes. */}
      {rows.length > 0 ? (
        <div>
          <Info summary="What these statuses mean">
            <ul className="space-y-2">
              <li>
                <span className="text-text">Confirmed</span> — a receipt came back successful. A
                transaction hash on its own is never shown as a result.
              </li>
              <li>
                <span className="text-text">Awaiting receipt</span> — we have a hash and no receipt
                yet. It may still land; check here before retrying.
              </li>
              <li>
                <span className="text-text">Failed</span> — mined, then reverted. No funds moved.
              </li>
              <li>
                <span className="text-text">Gas</span> — what you paid in BTC. Sponsored rows are
                zero because Maren’s relayer paid instead. A deposit is never sponsored.
              </li>
            </ul>
          </Info>
        </div>
      ) : null}
    </div>
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

  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-x-6 gap-y-3 py-5 ${
        last ? '' : 'border-b border-[var(--border-hairline)]'
      }`}
    >
      <div className="min-w-0">
        <p className="text-text text-[0.9375rem]">{activityTitle(item.kind, item.counterparty)}</p>
        <p className="text-text-subtle mt-1.5 text-xs">
          {timeAgo(item.at)} · <span className={statusClass}>{statusLabel(item.status)}</span>
          {item.memo ? ` · ${item.memo}` : ''}
        </p>
        {item.hash ? (
          <a
            href={`${explorer.url}/tx/${item.hash}`}
            target="_blank"
            rel="noreferrer noopener"
            className="num text-text-muted hover:text-text mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] text-xs transition-colors duration-[120ms] ease-out"
          >
            {shortHash(item.hash)}
            <ArrowUpRight className="size-3" />
            <span className="sr-only">— open on {explorer.name}</span>
          </a>
        ) : null}
      </div>

      <div className="shrink-0 text-right">
        {amount ? (
          <Num size="md">
            {direction === 'out' ? '−' : direction === 'in' ? '+' : ''}
            {amount}
          </Num>
        ) : null}
        <p className="text-text-subtle mt-1.5 text-xs">
          {item.sponsored ? (
            'Gas paid by Maren'
          ) : (
            <>
              Gas <span className="num">{formatBtc(item.gasPaidWei)}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
