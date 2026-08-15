import { formatUsd } from '@maren/sdk';

import { STALE_AFTER_SECONDS, type PriceFeed } from '@/lib/chain/price';
import { Num } from './money';

/**
 * The price feed, stated.
 *
 * Mezo's oracle reverts above 60 seconds of staleness, which makes every borrow path
 * fail for reasons that have nothing to do with the user. Rather than an opaque error,
 * the app enters an explicit state and says what still works.
 *
 * The rule this component exists to enforce: a stale price is never rendered as if it
 * were live. When the feed is stale the last known figure is struck through and labelled
 * as last known — it is context, not a quote.
 */
export function PriceBanner({ feed, className = '' }: { feed: PriceFeed; className?: string }) {
  if (feed.state === 'live') {
    return (
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted ${className}`}
      >
        <span
          aria-hidden
          className="size-1.5 rounded-[var(--radius-pill)] bg-success shadow-[0_0_8px_1px_rgba(52,211,153,0.5)]"
        />
        <span>BTC</span>
        <Num tone="default">{formatUsd(feed.priceWei)}</Num>
        <span className="text-text-subtle">
          oracle updated <span className="num">{feed.ageSeconds}s</span> ago
        </span>
      </div>
    );
  }

  if (feed.state === 'loading') {
    return (
      <div className={`text-sm text-text-subtle ${className}`} role="status">
        Reading the price feed.
      </div>
    );
  }

  const detail =
    feed.state === 'stale'
      ? `Mezo’s oracle has not updated in ${feed.ageSeconds} seconds, past its own ${STALE_AFTER_SECONDS}-second limit.`
      : feed.reason;

  return (
    <div
      role="status"
      className={`rounded-[var(--radius-input)] border border-warning/30 bg-surface-inset p-4 ${className}`}
    >
      <div className="flex items-center gap-2 text-sm text-warning">
        <span aria-hidden className="size-1.5 rounded-[var(--radius-pill)] bg-warning" />
        Price feed unavailable
      </div>
      <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-text-muted">
        {detail} You can still repay and withdraw. New borrowing is paused until it
        recovers.
      </p>
      {feed.state === 'stale' ? (
        <p className="mt-3 text-xs text-text-subtle">
          Last known price{' '}
          <span className="num line-through decoration-text-subtle">
            {formatUsd(feed.lastKnownWei)}
          </span>{' '}
          — shown for context only. It is not the current price and nothing is computed
          from it.
        </p>
      ) : null}
    </div>
  );
}
