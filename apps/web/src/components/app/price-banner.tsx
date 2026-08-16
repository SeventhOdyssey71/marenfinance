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
        className={`text-text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${className}`}
      >
        <span
          aria-hidden
          className="bg-success size-1.5 rounded-[var(--radius-pill)] shadow-[0_0_8px_1px_rgba(52,211,153,0.5)]"
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
      <div className={`text-text-subtle text-sm ${className}`} role="status">
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
      className={`border-warning/30 bg-surface-inset rounded-[var(--radius-input)] border p-4 ${className}`}
    >
      <div className="text-warning flex items-center gap-2 text-sm">
        <span aria-hidden className="bg-warning size-1.5 rounded-[var(--radius-pill)]" />
        Price feed unavailable
      </div>
      <p className="text-text-muted mt-2 max-w-[60ch] text-sm leading-relaxed">
        {detail} You can still repay and withdraw; new borrowing is paused.
      </p>
      {feed.state === 'stale' ? (
        <p className="text-text-subtle mt-3 text-xs">
          {/* Struck through and labelled. A stale price shown plainly would be read as
              current, which is the one mistake this whole state exists to prevent. */}
          Last known price{' '}
          <span className="num decoration-text-subtle line-through">
            {formatUsd(feed.lastKnownWei)}
          </span>
          . Nothing is computed from it.
        </p>
      ) : null}
    </div>
  );
}
