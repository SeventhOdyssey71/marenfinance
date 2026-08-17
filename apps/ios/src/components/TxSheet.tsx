import { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { getChain, shortHash } from '@maren/sdk';

import { describeOutcome, type TxOutcome } from '../chain/receipt';
import { submitAction, type ActionKind } from '../chain/actions';
import { base, brand, radius, semantic, space } from '../design/tokens';
import { useAppStore } from '../state/store';
import { Icon } from './Icon';
import { PillButton } from './PillButton';
import { Sats } from './Money';
import { Label, Num, Txt } from './Text';

/**
 * The one transaction sheet every action goes through.
 *
 * Its states map exactly onto the R15 outcome union — there is no "success" state that
 * can be reached without a `delivered` outcome, and the three non-delivered outcomes are
 * rendered distinctly rather than collapsed into a generic failure. In particular
 * `timeout` and `unreachable` explicitly say that the transaction *may still land*,
 * because telling a user a payment failed when it did not is how people double-spend.
 */

export type TxPhase =
  | { phase: 'idle' }
  /** Face ID prompt is up, or the transaction is in flight. */
  | { phase: 'signing'; title: string }
  | { phase: 'confirming'; title: string }
  | { phase: 'settled'; title: string; outcome: TxOutcome }
  | { phase: 'declined'; title: string; reason: string };

export interface TxRunner {
  state: TxPhase;
  run: (action: ActionKind, title: string) => Promise<void>;
  dismiss: () => void;
}

export function useTxRunner(onDelivered?: () => void): TxRunner {
  const [state, setState] = useState<TxPhase>({ phase: 'idle' });

  const run = useCallback(
    async (action: ActionKind, title: string) => {
      setState({ phase: 'signing', title });

      // submitAction gates on Face ID, submits, and only then reads a receipt.
      const resultPromise = submitAction(action);

      // The sheet moves to 'confirming' once signing plausibly completed, so the copy
      // reflects that we are now waiting on the chain rather than on the user.
      const flip = setTimeout(() => {
        setState((s) => (s.phase === 'signing' ? { phase: 'confirming', title } : s));
      }, 1_100);

      const result = await resultPromise;
      clearTimeout(flip);

      if (result.kind === 'declined') {
        setState({ phase: 'declined', title, reason: result.reason });
        return;
      }

      const outcome =
        result.kind === 'ok'
          ? { kind: 'delivered' as const, receipt: result.outcome.receipt }
          : result.outcome;
      setState({ phase: 'settled', title, outcome });

      if (result.kind === 'ok') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onDelivered?.();
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    },
    [onDelivered],
  );

  const dismiss = useCallback(() => setState({ phase: 'idle' }), []);

  return { state, run, dismiss };
}

export function TxSheet({ runner }: { runner: TxRunner }) {
  const network = useAppStore((s) => s.network);
  const { state, dismiss } = runner;

  if (state.phase === 'idle') return null;

  const explorer = getChain(network).blockExplorers?.default.url ?? 'https://explorer.mezo.org';

  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal accessibilityRole="alert">
          {state.phase === 'signing' || state.phase === 'confirming' ? (
            <Pending
              title={state.title}
              caption={
                state.phase === 'signing'
                  ? 'Waiting for Face ID, then broadcasting.'
                  : 'Broadcast. Waiting for an on-chain receipt. A hash alone is not a confirmation.'
              }
            />
          ) : null}

          {state.phase === 'declined' ? (
            <Result
              icon="lock"
              colour={semantic.warning}
              title="Not signed"
              detail={state.reason}
              onDismiss={dismiss}
            />
          ) : null}

          {state.phase === 'settled' ? (
            <Settled
              outcome={state.outcome}
              title={state.title}
              explorer={explorer}
              onDismiss={dismiss}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function Pending({ title, caption }: { title: string; caption: string }) {
  return (
    <View style={styles.body}>
      <View style={styles.pendingMark}>
        <Icon name="clock" size={22} color={brand.violet400} />
      </View>
      <Txt variant="h3" style={styles.title}>
        {title}
      </Txt>
      <Txt variant="small" tone="muted" style={styles.caption}>
        {caption}
      </Txt>
    </View>
  );
}

function Settled({
  outcome,
  title,
  explorer,
  onDismiss,
}: {
  outcome: TxOutcome;
  title: string;
  explorer: string;
  onDismiss: () => void;
}) {
  const described = describeOutcome(outcome);
  const delivered = outcome.kind === 'delivered';
  const colour = delivered
    ? semantic.success
    : outcome.kind === 'reverted'
      ? semantic.danger
      : semantic.warning;

  const hash = outcome.kind === 'delivered' ? outcome.receipt.hash : outcome.hash;

  return (
    <View style={styles.body}>
      <View style={[styles.mark, { borderColor: `${colour}55` }]}>
        <Icon
          name={delivered ? 'check' : outcome.kind === 'reverted' ? 'close' : 'clock'}
          size={22}
          color={colour}
        />
      </View>

      <Txt variant="h3" style={styles.title}>
        {described.title}
      </Txt>
      <Txt variant="small" tone="muted" style={styles.caption}>
        {title}. {described.detail}
      </Txt>

      {delivered && outcome.kind === 'delivered' ? (
        <View style={styles.receipt}>
          <View style={styles.receiptRow}>
            <Label>Block</Label>
            <Num size="numericSm" tone="muted">
              {outcome.receipt.blockNumber.toString()}
            </Num>
          </View>
          <View style={styles.receiptRow}>
            <Label>Gas you paid</Label>
            {outcome.receipt.gasPaidByUser === 0n ? (
              <Txt variant="small" style={{ color: semantic.success }}>
                None, relayer sponsored
              </Txt>
            ) : (
              <Sats wei={outcome.receipt.gasPaidByUser} />
            )}
          </View>
        </View>
      ) : null}

      {hash ? (
        <Pressable
          onPress={() => Linking.openURL(`${explorer}/tx/${hash}`)}
          accessibilityRole="link"
          accessibilityLabel={`View transaction ${shortHash(hash)} on the Mezo explorer`}
          style={styles.explorerLink}
          hitSlop={8}
        >
          <Num size="numericSm" tone="violet">
            {shortHash(hash)}
          </Num>
          <Icon name="external" size={14} color={brand.violet400} />
        </Pressable>
      ) : null}

      <PillButton label="Done" onPress={onDismiss} style={styles.dismiss} />
    </View>
  );
}

function Result({
  icon,
  colour,
  title,
  detail,
  onDismiss,
}: {
  icon: 'lock' | 'alert';
  colour: string;
  title: string;
  detail: string;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.body}>
      <View style={[styles.mark, { borderColor: `${colour}55` }]}>
        <Icon name={icon} size={22} color={colour} />
      </View>
      <Txt variant="h3" style={styles.title}>
        {title}
      </Txt>
      <Txt variant="small" tone="muted" style={styles.caption}>
        {detail}
      </Txt>
      <PillButton label="Close" onPress={onDismiss} style={styles.dismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,8,10,0.82)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: base.surfaceRaised,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: base.borderStrong,
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
    paddingBottom: space.xxxl,
  },
  body: { alignItems: 'center' },
  pendingMark: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(139,119,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  mark: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  title: { textAlign: 'center' },
  caption: { textAlign: 'center', marginTop: space.sm, maxWidth: 320 },
  receipt: {
    alignSelf: 'stretch',
    marginTop: space.xl,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    gap: space.md,
  },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  explorerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.lg,
    minHeight: 44,
  },
  dismiss: { marginTop: space.lg, alignSelf: 'stretch' },
});
