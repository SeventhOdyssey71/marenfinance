import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { shortHash } from '@maren/sdk';

import {
  base,
  brand,
  hit,
  modalShadow,
  radius,
  semantic,
  semanticText,
  space,
  text as textColors,
} from '../design/tokens';
import type { ActivityItem, ActivityStatus } from '../data/types';
import {
  activityTitle,
  counterpartyLabel,
  isOutflow,
  signedAmountText,
  statusLabel,
  timeAgo,
} from '../lib/copy';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Icon, type IconName } from './Icon';
import { LedgerAmount, Sats } from './Money';
import { PillButton } from './PillButton';
import { Label, Num, Txt } from './Text';

/**
 * The per-transaction receipt.
 *
 * Every value on it was decoded from a log Mezo returned for this address and read off
 * the `ActivityItem` the History list already holds — the sheet issues NO new chain read,
 * so it cannot show a figure the list could not. It is the detail behind a row, the way
 * `TxSheet` is the detail behind an action, and it is built to the same shape: a bottom
 * sheet, a status mark, an inset panel of facts, and the one explorer link that lets a
 * reviewer check the whole thing against the chain.
 *
 * R15 lives here too. The status mark and its label come from `item.status`, which
 * `logs.ts` derives from the receipt and nothing else. A hash is shown, always, but it is
 * NEVER dressed as a success unless the receipt confirmed it: a reverted transaction wears
 * the danger mark and "Failed, no funds moved", and one still awaiting a receipt says so.
 */

const STATUS_MARK: Record<ActivityStatus, { icon: IconName; fill: string; textTone: string }> = {
  confirmed: { icon: 'check', fill: semantic.success, textTone: semanticText.success },
  failed: { icon: 'close', fill: semantic.danger, textTone: semanticText.danger },
  pending: { icon: 'clock', fill: semantic.warning, textTone: semanticText.warning },
};

/** iOS medium date + short time. Guards a zero `at`, which is an unread block timestamp. */
function formatWhen(unixSeconds: number): string | null {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
  return new Date(unixSeconds * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ReceiptSheet({
  item,
  explorer,
  network,
  onClose,
}: {
  item: ActivityItem | null;
  explorer: string;
  network: string;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const [copied, setCopied] = useState(false);

  if (!item) return null;

  const mark = STATUS_MARK[item.status];
  const direction: '+' | '−' = isOutflow(item.kind) ? '−' : '+';
  const failed = item.status === 'failed';
  const who = counterpartyLabel(item);
  const isTransfer = item.kind === 'send' || item.kind === 'receive';
  const when = formatWhen(item.at);

  const copyHash = async () => {
    if (!item.hash) return;
    await Clipboard.setStringAsync(item.hash);
    Haptics.selectionAsync().catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1_400);
  };

  const close = () => {
    setCopied(false);
    onClose();
  };

  return (
    <Modal transparent visible animationType={reduced ? 'none' : 'slide'} onRequestClose={close}>
      <View style={styles.backdrop}>
        {/* The scrim closes the sheet; it is decorative to the reader, so it is hidden
            from VoiceOver, which reaches the close button and Done inside instead. */}
        <Pressable
          style={styles.scrim}
          onPress={close}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />

        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.headerRow}>
            <Txt variant="h3" numberOfLines={1} style={styles.headerTitle}>
              {activityTitle(item.kind, who)}
            </Txt>
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Close receipt"
              hitSlop={12}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Icon name="close" size={18} color={textColors.muted} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View
              style={styles.hero}
              accessible
              accessibilityLabel={`${activityTitle(item.kind, who)}, ${signedAmountText(item)}, ${statusLabel(item.status)}`}
            >
              <View style={[styles.mark, { borderColor: `${mark.fill}55` }]}>
                <Icon name={mark.icon} size={22} color={mark.fill} />
              </View>
              <LedgerAmount
                musdWei={item.musdWei}
                btcWei={item.btcWei}
                direction={direction}
                failed={failed}
                size="numericLg"
              />
            </View>

            <View style={styles.panel}>
              {isTransfer ? (
                <DetailRow
                  label={item.kind === 'receive' ? 'From' : 'To'}
                  value={
                    <Txt variant="small" style={styles.value} numberOfLines={1}>
                      {who ?? 'Unknown'}
                    </Txt>
                  }
                />
              ) : null}

              {item.memo ? (
                <DetailRow
                  label="Memo"
                  value={
                    <Txt variant="small" style={styles.value} numberOfLines={2}>
                      “{item.memo}”
                    </Txt>
                  }
                />
              ) : null}

              <DetailRow
                label="Status"
                value={
                  <View style={styles.statusRow}>
                    <View style={[styles.statusDot, { backgroundColor: mark.textTone }]} />
                    <Txt variant="small" style={{ color: mark.textTone }}>
                      {statusLabel(item.status)}
                    </Txt>
                  </View>
                }
              />

              <DetailRow
                label="Time"
                value={
                  when ? (
                    <View style={styles.timeCol}>
                      <Txt variant="small" style={styles.value}>
                        {when}
                      </Txt>
                      <Txt variant="small" tone="muted" style={styles.timeSub}>
                        {timeAgo(item.at)}
                      </Txt>
                    </View>
                  ) : (
                    <Txt variant="small" tone="muted">
                      Unknown
                    </Txt>
                  )
                }
              />

              {item.blockNumber !== undefined ? (
                <DetailRow
                  label="Block"
                  value={
                    <Num size="numericSm" tone="muted">
                      {item.blockNumber.toString()}
                    </Num>
                  }
                />
              ) : null}

              <DetailRow
                label="Gas you paid"
                value={
                  item.sponsored ? (
                    <Txt variant="small" style={{ color: semanticText.success }}>
                      None, relayer sponsored
                    </Txt>
                  ) : item.gasPaidWei > 0n ? (
                    <Sats wei={item.gasPaidWei} />
                  ) : (
                    <Txt variant="small" tone="muted">
                      Unknown
                    </Txt>
                  )
                }
              />

              <DetailRow
                label="Network"
                last
                value={
                  <Txt variant="small" style={styles.value}>
                    Mezo {network}
                  </Txt>
                }
              />
            </View>

            {item.hash ? (
              <Pressable
                onPress={() => Linking.openURL(`${explorer}/tx/${item.hash}`)}
                accessibilityRole="link"
                accessibilityLabel={`View transaction ${shortHash(item.hash)} on the Mezo explorer`}
                accessibilityHint="Opens the block explorer"
                style={({ pressed }) => [styles.explorerLink, pressed && styles.pressed]}
              >
                <Num size="numericSm" tone="violet">
                  {shortHash(item.hash)}
                </Num>
                <Icon name="external" size={14} color={brand.violet400} />
              </Pressable>
            ) : null}

            {item.hash ? (
              <PillButton
                variant="secondary"
                label={copied ? 'Copied' : 'Copy transaction hash'}
                onPress={copyHash}
                badge={undefined}
                accessibilityLabel={copied ? 'Hash copied' : 'Copy transaction hash'}
                style={styles.action}
              />
            ) : null}

            <PillButton label="Done" onPress={close} style={styles.action} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DetailRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[styles.detailRow, !last && styles.detailDivider]}>
      <Label>{label}</Label>
      <View style={styles.valueCol}>{value}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  // The scrim stays dark on the light theme, exactly as TxSheet's does: its job is to
  // push the page back, and a light scrim over a light page does not.
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(23,20,41,0.45)',
  },
  sheet: {
    backgroundColor: base.surfaceRaised,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: space.lg,
    paddingHorizontal: space.xl,
    paddingBottom: space.xxxl,
    maxHeight: '88%',
    ...modalShadow,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.lg,
  },
  headerTitle: { flexShrink: 1 },
  close: {
    width: hit.min,
    height: hit.min,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // Pull the icon to the visual edge without shrinking the 44pt hit area.
    marginRight: -space.md,
  },
  body: { alignItems: 'stretch' },
  hero: { alignItems: 'center', gap: space.md, marginBottom: space.xl },
  mark: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    // Concentric with the 28pt sheet minus its 24pt inset — the §4 card radius.
    borderRadius: radius.card,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    paddingHorizontal: space.lg,
  },
  detailRow: {
    minHeight: hit.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    paddingVertical: space.md,
  },
  detailDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: base.border,
  },
  valueCol: { flexShrink: 1, alignItems: 'flex-end' },
  value: { textAlign: 'right' },
  timeCol: { alignItems: 'flex-end' },
  timeSub: { marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  statusDot: { width: 6, height: 6, borderRadius: radius.pill },
  explorerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: hit.min,
    marginTop: space.lg,
  },
  action: { marginTop: space.md },
  pressed: { opacity: 0.6 },
});
