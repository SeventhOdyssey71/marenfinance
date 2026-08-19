import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Linking from 'expo-linking';
import { formatBtc, formatMusd, getChain, shortHash } from '@maren/sdk';

import { Card } from '../../src/components/Card';
import { DemoNotice, ReadFailure } from '../../src/components/DataNotice';
import { Icon, type IconName } from '../../src/components/Icon';
import { Sats } from '../../src/components/Money';
import { Screen } from '../../src/components/Screen';
import { Label, Num, Txt } from '../../src/components/Text';
import { base, radius, semanticText, space, text as textColors } from '../../src/design/tokens';
import { activityTitle, statusLabel, timeAgo } from '../../src/lib/copy';
import type {
  ActivityItem,
  ActivityKind,
  ActivityStatus,
  ActivityWindow,
} from '../../src/data/types';
import { useActivity } from '../../src/hooks/useChainData';
import { useAppStore } from '../../src/state/store';

/**
 * Activity — history with status, memo, and a link to the explorer.
 *
 * Every row here is decoded from a log Mezo returned for this address. The explorer
 * links therefore resolve, which is the whole reason this screen is worth having: a
 * ledger nobody can check against the chain is a picture of a ledger.
 *
 * Status is rendered from the receipt-derived value and nothing else. A failed
 * transaction is shown as failed, in danger red, with the words "no funds moved" —
 * R15 in the one place a user will actually look for it. Talise's audit finding was
 * that a failure could reach the UI wearing a success's clothes; here the failure has
 * its own row treatment and cannot be mistaken for anything else.
 *
 * THE THREE EMPTY STATES ARE THREE DIFFERENT FACTS, and this screen refuses to collapse
 * them. "We read every block since deployment and you have done nothing" is a complete
 * answer. "We read the last 60,000 blocks and found nothing" is a much weaker one.
 * "The RPC did not answer" is not an answer at all, and is the one that must never be
 * rendered as an empty list, because that tells somebody their transactions are gone.
 */
export default function Activity() {
  const { data: window, error, isPending, refetch } = useActivity();
  const network = useAppStore((s) => s.network);
  const demo = useAppStore((s) => s.dataSource === 'mock');
  const explorer = getChain(network).blockExplorers?.default.url ?? 'https://explorer.mezo.org';

  const items = window?.items ?? [];
  const groups = groupByDay(items);

  return (
    <Screen bottomInset={space.xxl}>
      <View style={styles.header}>
        <Label>Activity</Label>
        <Txt variant="h2" style={styles.title}>
          Everything that moved
        </Txt>
      </View>

      {demo ? <DemoNotice /> : null}

      {error ? (
        <ReadFailure
          what="your history"
          detail={error instanceof Error ? error.message : String(error)}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : isPending ? (
        <Card>
          <Txt variant="small" tone="muted">
            Reading your history from Maren’s contract logs…
          </Txt>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <Txt variant="h3">
            {window?.complete ? 'Nothing yet' : 'Nothing in the blocks we read'}
          </Txt>
          <Txt variant="small" tone="muted" style={styles.emptyBody}>
            {window?.complete
              ? 'This address has never transacted with Maren. Every block since the contracts were deployed was read, so that is the whole story rather than a recent slice. Deposits, borrows and payments appear here the moment they have an on-chain receipt.'
              : 'Mezo’s RPC answers 10,000 blocks at a time, so this scan covered the most recent stretch rather than all of history. Anything older is not shown, and is not claimed to be absent.'}
          </Txt>
        </Card>
      ) : (
        groups.map(([day, rows]) => (
          <Fragment key={day}>
            <Label style={styles.dayLabel}>{day}</Label>
            <Card padded={false} style={styles.group}>
              {rows.map((item, i) => (
                <Row key={item.id} item={item} explorer={explorer} last={i === rows.length - 1} />
              ))}
            </Card>
          </Fragment>
        ))
      )}

      {/* Coverage is a claim about a scan, so it is only shown when a scan happened. */}
      {window && !error && !demo ? <Coverage window={window} /> : null}
    </Screen>
  );
}

/**
 * How far back this list actually looked.
 *
 * Stated in blocks, because blocks are exact and a converted date would not be. The only
 * honest way to turn a block number into a wall-clock time is to fetch that block, and
 * quoting "about three days" from an assumed block time is precisely the small invention
 * this screen exists to be free of.
 */
function Coverage({ window }: { window: ActivityWindow }) {
  const span = (window.toBlock - window.fromBlock + 1n).toString();
  return (
    <Txt variant="small" tone="muted" style={styles.coverage}>
      {window.complete
        ? `Read every block from ${window.fromBlock.toString()}, where Maren was deployed, to ${window.toBlock.toString()}. That is the complete history.`
        : `Read blocks ${window.fromBlock.toString()} to ${window.toBlock.toString()} (${span} blocks). Mezo’s public RPC caps a log query at 10,000 blocks, so older history needs an indexer.`}
    </Txt>
  );
}

function Row({ item, explorer, last }: { item: ActivityItem; explorer: string; last: boolean }) {
  const failed = item.status === 'failed';
  const amount =
    item.musdWei !== undefined
      ? formatMusd(item.musdWei)
      : item.btcWei !== undefined
        ? formatBtc(item.btcWei)
        : '—';
  const direction = outflow(item.kind) ? '−' : '+';
  const [numeral, unit] = splitAmount(amount);

  const label = `${activityTitle(item.kind, item.counterparty)}, ${amount}, ${statusLabel(item.status)}, ${timeAgo(item.at)}`;

  return (
    <Pressable
      onPress={item.hash ? () => Linking.openURL(`${explorer}/tx/${item.hash}`) : undefined}
      accessibilityRole={item.hash ? 'link' : undefined}
      accessibilityLabel={label}
      accessibilityHint={item.hash ? 'Opens this transaction on explorer.mezo.org' : undefined}
      style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && styles.pressed]}
    >
      <View style={[styles.rowIcon, failed && styles.rowIconFailed]}>
        <Icon
          name={iconFor(item.kind)}
          size={17}
          color={failed ? semanticText.danger : textColors.muted}
        />
      </View>

      <View style={styles.rowBody}>
        <Txt variant="body" style={styles.rowTitle} numberOfLines={1}>
          {activityTitle(item.kind, item.counterparty)}
        </Txt>

        <View style={styles.rowMeta}>
          <StatusChip status={item.status} />
          <Txt variant="small" tone="muted">
            · {timeAgo(item.at)}
          </Txt>
        </View>

        {item.memo ? (
          <Txt variant="small" tone="muted" style={styles.memo} numberOfLines={1}>
            “{item.memo}”
          </Txt>
        ) : null}

        {item.hash ? (
          <View style={styles.hashRow}>
            <Num size="numericSm" tone="muted" style={styles.hash}>
              {shortHash(item.hash)}
            </Num>
            <Icon name="external" size={11} color={textColors.subtle} />
          </View>
        ) : null}
      </View>

      <View style={styles.rowRight}>
        {/*
          Numeral and unit are separate runs, as everywhere else: the figure carries the
          value in plain text and the unit carries the asset colour (§2's "asset mark").
          A failed row strikes the whole pair through and drops it to muted, so it reads
          as withdrawn rather than as money that moved.
        */}
        <View style={styles.amountPair}>
          <Num
            size="numeric"
            tone="inherit"
            style={[styles.amount, failed ? styles.amountFailed : styles.amountLive]}
          >
            {direction}
            {numeral}
          </Num>
          {unit ? (
            <Num
              size="numericSm"
              tone="inherit"
              style={
                failed
                  ? styles.amountFailed
                  : item.musdWei !== undefined
                    ? styles.amountMusd
                    : styles.amountBtc
              }
            >
              {unit}
            </Num>
          ) : null}
        </View>

        {item.sponsored ? (
          <Txt variant="small" tone="muted" style={styles.gas}>
            no gas paid
          </Txt>
        ) : item.gasPaidWei > 0n ? (
          <View style={styles.gasRow}>
            <Sats wei={item.gasPaidWei} />
            <Txt variant="small" tone="muted">
              {' '}
              gas
            </Txt>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** "1,500.00 MUSD" -> ["1,500.00", "MUSD"]; "—" survives unsplit. */
function splitAmount(value: string): [string, string | null] {
  const at = value.lastIndexOf(' ');
  if (at < 0) return [value, null];
  const tail = value.slice(at + 1);
  return /^[A-Za-z]+$/.test(tail) ? [value.slice(0, at), tail] : [value, null];
}

function StatusChip({ status }: { status: ActivityStatus }) {
  /**
   * Confirmed is the expected outcome of every row in a working ledger, so it is grey.
   *
   * Colouring it green meant a healthy history rendered as a wall of green, and BRAND.md
   * §2 is explicit that "a screen where everything is coloured is a screen where nothing
   * is important" — the one genuinely important row, the failed send, was the same
   * weight as everything around it. Only the two states a person must act on take
   * colour, which is what makes R15's "Failed — no funds moved" impossible to miss.
   */
  const colour =
    status === 'confirmed'
      ? textColors.muted
      : status === 'failed'
        ? semanticText.danger
        : semanticText.warning;

  return (
    <View style={styles.chip}>
      <View style={[styles.chipDot, { backgroundColor: colour }]} />
      <Txt variant="small" style={{ color: colour }}>
        {statusLabel(status)}
      </Txt>
    </View>
  );
}

function iconFor(kind: ActivityKind): IconName {
  switch (kind) {
    case 'send':
      return 'arrowUpRight';
    case 'receive':
      return 'arrowDown';
    case 'deposit':
      return 'vault';
    case 'withdraw':
      return 'arrowUpRight';
    case 'borrow':
      return 'plus';
    case 'repay':
      return 'minus';
    case 'earn-deposit':
      return 'earn';
    case 'earn-withdraw':
      return 'arrowDown';
    case 'request-created':
      return 'plus';
    case 'link-created':
      return 'arrowUpRight';
    case 'link-claimed':
      return 'arrowDown';
  }
}

/**
 * Which way the money went, for the sign on the amount.
 *
 * The three payment-link and request kinds are deliberately absent from this list, so
 * they render with a plus. None of them moves money at the moment they are emitted: a
 * request is an ask, a created link is escrowed and reclaimable, and a claim is an
 * inflow to whoever claimed it. Signing them as outgoing would put a minus against a
 * balance that did not fall.
 */
function outflow(kind: ActivityKind): boolean {
  return kind === 'send' || kind === 'repay' || kind === 'deposit' || kind === 'earn-deposit';
}

/** Group into "Today" / "Yesterday" / a date. */
function groupByDay(items: ActivityItem[]): [string, ActivityItem[]][] {
  const out = new Map<string, ActivityItem[]>();
  const now = new Date();

  for (const item of items) {
    const date = new Date(item.at * 1000);
    const days = Math.floor((startOfDay(now) - startOfDay(date)) / 86_400_000);
    const key =
      days === 0
        ? 'Today'
        : days === 1
          ? 'Yesterday'
          : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

    const bucket = out.get(key);
    if (bucket) bucket.push(item);
    else out.set(key, [item]);
  }

  return [...out.entries()];
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const styles = StyleSheet.create({
  header: { marginBottom: space.xl },
  title: { marginTop: space.xs },
  dayLabel: { marginBottom: space.md, marginTop: space.sm },
  coverage: { marginTop: space.md },
  group: { paddingHorizontal: space.lg, marginBottom: space.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.lg,
    minHeight: 44,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: base.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  rowIconFailed: { borderColor: 'rgba(220,38,38,0.45)' },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 15 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipDot: { width: 5, height: 5, borderRadius: radius.pill },
  memo: { marginTop: 2 },
  hashRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  hash: { fontSize: 11 },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  amount: { fontSize: 15 },
  amountPair: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'flex-end', gap: 6 },
  amountLive: { color: textColors.primary },
  amountMusd: { color: semanticText.musd },
  amountBtc: { color: semanticText.btc },
  /**
   * `muted`, not `subtle`. This is a 15px figure a user reads to work out that a payment
   * did not happen — the strike-through says withdrawn, the tone says quiet, and neither
   * is allowed to say illegible. #82828C would be 3.80:1 on this card; #55555E is 7.38.
   */
  amountFailed: { color: textColors.muted, textDecorationLine: 'line-through' },
  gas: { fontSize: 11 },
  gasRow: { flexDirection: 'row', alignItems: 'center' },
  emptyBody: { marginTop: space.sm },
  pressed: { opacity: 0.6 },
});
