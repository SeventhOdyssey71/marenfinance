import { StyleSheet, View } from 'react-native';
import { formatUsd } from '@maren/sdk';

import { STALE_AFTER_SECONDS, type PriceFeed } from '../chain/price';
import { base, radius, semantic, space } from '../design/tokens';
import { Icon } from './Icon';
import { Num, Txt } from './Text';

/**
 * The price-feed state, stated explicitly.
 *
 * ARCHITECTURE.md §4: "Both apps have an explicit 'price feed unavailable' state; we
 * never display a stale price as if it were live."
 *
 * The stale variant deliberately shows the last-known figure struck through and labelled
 * with its age. Hiding the number entirely would be less honest, not more: the user has
 * seen it seconds ago and needs to know it is the same number, now untrustworthy, rather
 * than wondering whether the app has lost its data.
 */
export function PriceBanner({ feed }: { feed: PriceFeed }) {
  if (feed.state === 'live') {
    return (
      <View style={styles.live} accessible accessibilityLabel={`Bitcoin price ${formatUsd(feed.priceWei)}, updated ${feed.ageSeconds} seconds ago`}>
        <View style={styles.dot} />
        <Txt variant="small" tone="muted">
          BTC
        </Txt>
        <Num size="numericSm" tone="muted">
          {formatUsd(feed.priceWei)}
        </Num>
        <Txt variant="small" tone="muted">
          · {freshness(feed.ageSeconds)}
        </Txt>
      </View>
    );
  }

  if (feed.state === 'loading') {
    return (
      <View style={styles.live}>
        <Txt variant="small" tone="muted">
          Reading price feed…
        </Txt>
      </View>
    );
  }

  const isStale = feed.state === 'stale';

  return (
    <View
      style={styles.alert}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={
        isStale
          ? `Price feed unavailable. Last observation is ${feed.ageSeconds} seconds old, past Mezo's ${STALE_AFTER_SECONDS} second limit. Borrowing is disabled.`
          : `Price feed unavailable. ${feed.reason}`
      }
    >
      <Icon name="alert" size={18} color={semantic.warning} />
      <View style={styles.alertBody}>
        <Txt variant="small" style={styles.alertTitle}>
          Price feed unavailable
        </Txt>

        {isStale ? (
          <>
            <Txt variant="small" tone="muted" style={styles.alertDetail}>
              Mezo’s oracle rejects observations older than {STALE_AFTER_SECONDS}s. This one is{' '}
              {feed.ageSeconds}s old, so anything priced against it would revert on-chain.
            </Txt>
            <View style={styles.lastKnown}>
              <Txt variant="small" tone="muted">
                Last known
              </Txt>
              <Num size="numericSm" tone="muted" style={styles.struck}>
                {formatUsd(feed.lastKnownWei)}
              </Num>
            </View>
          </>
        ) : (
          <Txt variant="small" tone="muted" style={styles.alertDetail}>
            {feed.reason}
          </Txt>
        )}
      </View>
    </View>
  );
}

/**
 * How fresh a live observation is.
 *
 * "0s ago" is technically exact and reads like a placeholder someone forgot to finish.
 * The age still appears verbatim in the VoiceOver label above, and the moment it matters
 * — past the oracle's own tolerance — this component is not rendering the live variant
 * at all, so nothing is being softened here except the wording.
 */
function freshness(ageSeconds: number): string {
  return ageSeconds < 5 ? 'just now' : `${ageSeconds}s ago`;
}

const styles = StyleSheet.create({
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: semantic.success,
  },
  alert: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    // A warning border rather than a warning fill: §2 says a screen where everything is
    // coloured is a screen where nothing is important.
    borderColor: 'rgba(251,191,36,0.32)',
  },
  alertBody: { flex: 1 },
  alertTitle: { color: semantic.warning },
  alertDetail: { marginTop: space.xs },
  lastKnown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
  },
  struck: { textDecorationLine: 'line-through' },
});
