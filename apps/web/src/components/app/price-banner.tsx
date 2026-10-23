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
 * as last known. It is context, not a quote.
 *
 * The unavailable state is painted exactly like a `BlockedNote` from the pool: a grey
 * well, a hairline of amber, an amber title and a muted sentence. Both say "not your
 * doing, and here is what still works", so they should look like the same kind of thing.
 */
export function PriceBanner({ feed, className = '' }: { feed: PriceFeed; className?: string }) {
  if (feed.state === 'live') {
    return (
      <div
        className={`text-text-muted flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.8125rem] ${className}`}
      >
        <span aria-hidden className="bg-success size-1.5 shrink-0 rounded-[var(--radius-pill)]" />
        <span>BTC</span>
        <Num tone="default" size="sm">
          {formatUsd(feed.priceWei)}
        </Num>
        <span>
          oracle updated <span className="num">{feed.ageSeconds}s</span> ago
        </span>
      </div>
    );
  }

  if (feed.state === 'loading') {
    return (
      <div className={`text-text-muted text-[0.8125rem] ${className}`} role="status">
        Reading the price feed.
      </div>
    );
  }

  const detail =
    feed.state === 'stale'
      ? `Mezo’s oracle has not updated in ${feed.ageSeconds} seconds, past its own ${STALE_AFTER_SECONDS}-second limit.`
      : feed.reason;

  return (
    <div role="status" className={`border-warning/30 bg-surface-inset border p-4 ${className}`}>
      <p className="text-warning text-sm font-medium">Price feed unavailable</p>
      <p className="text-text-muted mt-1.5 max-w-[68ch] text-sm leading-relaxed">
        {detail} You can still repay and withdraw; new borrowing is paused.
      </p>
      {feed.state === 'stale' ? (
        <p className="text-text-muted mt-2.5 text-xs">
          {/* Struck through and labelled. A stale price shown plainly would be read as
              current, which is the one mistake this whole state exists to prevent. */}
          Last known price{' '}
          <span className="num decoration-text-muted line-through">
            {formatUsd(feed.lastKnownWei)}
          </span>
          . Nothing is computed from it.
        </p>
      ) : null}
    </div>
  );
}
