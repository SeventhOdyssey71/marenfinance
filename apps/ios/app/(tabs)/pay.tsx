import { useState } from 'react';
import { Modal, Pressable, Share, StyleSheet, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { formatMusd, shortAddress } from '@maren/sdk';

import { Amount, Musd } from '../../src/components/Money';
import { AmountPad } from '../../src/components/AmountPad';
import { Card } from '../../src/components/Card';
import { Icon } from '../../src/components/Icon';
import { PillButton } from '../../src/components/PillButton';
import { StatRow } from '../../src/components/Row';
import { Screen } from '../../src/components/Screen';
import { Label, Num, Txt } from '../../src/components/Text';
import { TxSheet, useTxRunner } from '../../src/components/TxSheet';
import { isSponsored } from '../../src/chain/actions';
import {
  base,
  brand,
  hit,
  modalShadow,
  radius,
  semantic,
  semanticText,
  space,
  text,
} from '../../src/design/tokens';
import { fonts } from '../../src/design/type';
import { resolveHandle } from '../../src/data/source';
import type { Handle } from '../../src/data/types';
import { useBalances } from '../../src/hooks/useChainData';
import { gasCopy } from '../../src/lib/copy';
import { buildPaymentPayload } from '../../src/lib/payment';
import { useAppStore } from '../../src/state/store';

type Tab = 'send' | 'request';

/**
 * Pay — send MUSD to a @handle or address, request, and scan to pay.
 *
 * Send is a stepper, ported from the reference wallet's choreography: Amount → Recipient
 * → Review, then the shared TxSheet's Submitting → Delivered/Declined/Failed. The stepper
 * only gathers and confirms; it never signs or reads a receipt itself. The one commit
 * goes through the existing `useTxRunner`/`submitAction` pipeline, which is the single
 * place a receipt is checked (R15) — so this screen cannot invent a success the chain did
 * not return.
 *
 * The gasless claim is made on Review, once, from `gasCopy` and gated on the SAME
 * `isSponsored` the submit path routes by. A send goes through MarenPay on the relayer's
 * allowlist, so it is truthfully gasless here; the copy would flip if the routing did.
 */
export default function Pay() {
  const params = useLocalSearchParams<{ to?: string; amount?: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('send');

  return (
    <Screen bottomInset={space.xxl}>
      <View style={styles.header}>
        <Label>Pay</Label>
        <Txt variant="h2" style={styles.title}>
          Move dollars
        </Txt>
      </View>

      <View style={styles.segmented} accessibilityRole="tablist">
        {(['send', 'request'] as Tab[]).map((t) => {
          const active = t === tab;
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t === 'send' ? 'Send' : 'Request'}
              style={[styles.segment, active && styles.segmentActive]}
            >
              <Txt variant="small" tone={active ? 'primary' : 'muted'}>
                {t === 'send' ? 'Send' : 'Request'}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      {tab === 'send' ? (
        <SendPanel
          initialTo={params.to}
          initialAmount={params.amount}
          onScan={() => router.push('/scan')}
        />
      ) : (
        <RequestPanel />
      )}
    </Screen>
  );
}

type SendStep = 'amount' | 'recipient' | 'review';

function SendPanel({
  initialTo,
  initialAmount,
  onScan,
}: {
  initialTo?: string;
  initialAmount?: string;
  onScan: () => void;
}) {
  const { data: balances } = useBalances();
  const handle = useAppStore((s) => s.handle);

  const [to, setTo] = useState(initialTo ?? '');
  const [amount, setAmount] = useState(initialAmount ?? '');
  const [memo, setMemo] = useState('');
  // A deep-linked recipient (a scan, or a link back into Pay) opens straight on the
  // Recipient step so the resolved name is what the user confirms first.
  const [step, setStep] = useState<SendStep>(initialTo ? 'recipient' : 'amount');

  // A delivered send resets the flow, so returning from the sheet lands on a clean Amount
  // screen rather than the just-sent figures. Only fires on 'delivered'; the runner leaves
  // the pre-transaction state in place for every other outcome.
  const runner = useTxRunner(() => {
    setStep('amount');
    setAmount('');
    setTo('');
    setMemo('');
  });

  /**
   * Deep-linked values from the scanner arrive after mount.
   *
   * Adjusted during render against the previous prop rather than in an effect — React's
   * own guidance for "reset state when a prop changes". A scanned code carries a real
   * recipient (and sometimes an amount), so it lands the user on the Recipient step with
   * the resolved name in view, which is exactly where a scan should confirm who is paid.
   */
  const [seenParams, setSeenParams] = useState({ to: initialTo, amount: initialAmount });
  if (seenParams.to !== initialTo || seenParams.amount !== initialAmount) {
    setSeenParams({ to: initialTo, amount: initialAmount });
    if (initialTo) setTo(initialTo);
    if (initialAmount) setAmount(initialAmount);
    if (initialTo) setStep('recipient');
  }

  /**
   * Handle resolution through MarenRegistry. A keyed async read, so it is a query rather
   * than an effect plus two useStates — the same shape the rest of the app uses.
   */
  const handleQuery = to.trim();
  const isHandle = handleQuery.startsWith('@') && handleQuery.length > 1;

  const { data: resolvedData, isFetching: resolving } = useQuery({
    queryKey: ['handle', handleQuery],
    queryFn: () => resolveHandle(handleQuery),
    enabled: isHandle,
    staleTime: 30_000,
  });

  const resolved: Handle | null = isHandle ? (resolvedData ?? null) : null;

  const amountWei = parseMusd(amount);
  const isAddress = /^0x[0-9a-fA-F]{40}$/.test(to.trim());
  const recipientOk = isAddress || resolved !== null;
  const overBalance = balances !== undefined && amountWei > balances.musdWei;
  const amountOk = amountWei > 0n && !overBalance;

  return (
    <>
      {step === 'amount' ? (
        <AmountStep
          amount={amount}
          setAmount={setAmount}
          balances={balances}
          overBalance={overBalance}
          canContinue={amountOk}
          onContinue={() => setStep('recipient')}
        />
      ) : null}

      {step === 'recipient' ? (
        <RecipientStep
          to={to}
          setTo={setTo}
          memo={memo}
          setMemo={setMemo}
          resolved={resolved}
          resolving={resolving}
          isAddress={isAddress}
          canContinue={recipientOk}
          onScan={onScan}
          onBack={() => setStep('amount')}
          onContinue={() => setStep('review')}
        />
      ) : null}

      {step === 'review' ? (
        <ReviewStep
          amountWei={amountWei}
          fromHandle={handle}
          recipientName={resolved?.handle ?? shortAddress(to.trim())}
          recipientAddress={resolved?.address ?? to.trim()}
          memo={memo}
          onBack={() => setStep('recipient')}
          onConfirm={() =>
            runner.run(
              { type: 'send', musdWei: amountWei, to: resolved?.address ?? to.trim(), memo },
              `Send ${formatMusd(amountWei)} to ${resolved?.handle ?? shortAddress(to.trim())}`,
            )
          }
        />
      ) : null}

      <TxSheet runner={runner} />
    </>
  );
}

/* ─── Amount ─────────────────────────────────────────────────────────────── */

function AmountStep({
  amount,
  setAmount,
  balances,
  overBalance,
  canContinue,
  onContinue,
}: {
  amount: string;
  setAmount: (next: string) => void;
  balances: { musdWei: bigint } | undefined;
  overBalance: boolean;
  canContinue: boolean;
  onContinue: () => void;
}) {
  // The in-progress input, given the Money hero treatment: whole number in ink, the
  // fractional tail greyed (`dimFraction`), the unit small beside it. It is the same
  // component a balance renders through, so a typed figure and a read one look identical.
  const display = amount === '' ? '0' : amount;

  return (
    <>
      <View style={styles.amountHero}>
        <Amount
          value={`${display} MUSD`}
          size="numericXl"
          unitTone="musd"
          dimFraction
          align="left"
        />
        {overBalance ? (
          <Txt
            variant="small"
            style={[styles.overNote, { color: semanticText.danger }]}
            accessibilityRole="alert"
          >
            More than your MUSD balance.
          </Txt>
        ) : null}
      </View>

      <Pressable
        onPress={() =>
          balances && setAmount(formatMusd(balances.musdWei, { unit: false }).replace(/,/g, ''))
        }
        accessibilityRole="button"
        accessibilityLabel="Use your full MUSD balance"
        style={styles.walletPill}
        hitSlop={8}
      >
        <View style={styles.walletDot} />
        <Txt variant="small" tone="muted">
          Available
        </Txt>
        <Txt variant="small" tone="subtle">
          ·
        </Txt>
        {balances ? <Musd wei={balances.musdWei} size="numericSm" plain /> : null}
      </Pressable>

      <View style={styles.padWrap}>
        <AmountPad value={amount} onChange={setAmount} />
      </View>

      <PillButton
        label="Continue"
        onPress={onContinue}
        disabled={!canContinue}
        badge={<Icon name="arrowRight" size={15} color={base.onAccent} />}
        accessibilityHint="Go to choosing who to pay."
      />
    </>
  );
}

/* ─── Recipient ──────────────────────────────────────────────────────────── */

function RecipientStep({
  to,
  setTo,
  memo,
  setMemo,
  resolved,
  resolving,
  isAddress,
  canContinue,
  onScan,
  onBack,
  onContinue,
}: {
  to: string;
  setTo: (next: string) => void;
  memo: string;
  setMemo: (next: string) => void;
  resolved: Handle | null;
  resolving: boolean;
  isAddress: boolean;
  canContinue: boolean;
  onScan: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const memoBytes = utf8Length(memo);
  const typedHandle = to.trim().startsWith('@') && to.trim().length > 1;

  return (
    <>
      <StepHeader title="Send to" onBack={onBack} backLabel="Back to amount" />

      <Card style={styles.panel}>
        <Label>To</Label>
        <View style={styles.recipientRow}>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="@handle or 0x address"
            placeholderTextColor={text.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.recipientInput}
            accessibilityLabel="Recipient"
            accessibilityHint="Enter a Maren handle beginning with @ or a 0x address."
          />
          <Pressable
            onPress={onScan}
            accessibilityRole="button"
            accessibilityLabel="Scan a payment QR code"
            style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}
          >
            <Icon name="scan" size={18} color={text.primary} />
          </Pressable>
        </View>

        {resolving ? (
          <Txt variant="small" tone="muted" style={styles.resolveNote}>
            Resolving handle…
          </Txt>
        ) : resolved ? (
          <View
            style={styles.resolved}
            accessible
            accessibilityLabel={`${resolved.handle} resolves to ${resolved.address}`}
          >
            <Icon name="check" size={14} color={semanticText.success} />
            <Num size="numericSm" tone="muted">
              {shortAddress(resolved.address)}
            </Num>
          </View>
        ) : typedHandle ? (
          <Txt variant="small" style={[styles.resolveNote, { color: semanticText.danger }]}>
            No such handle on this network.
          </Txt>
        ) : isAddress ? (
          <View style={styles.resolved}>
            <Icon name="check" size={14} color={semanticText.success} />
            <Txt variant="small" tone="muted">
              Valid address
            </Txt>
          </View>
        ) : null}

        <View style={styles.divider} />

        <Label>Memo (optional)</Label>
        <TextInput
          value={memo}
          onChangeText={setMemo}
          placeholder="What is this for?"
          placeholderTextColor={text.muted}
          maxLength={80}
          style={styles.memoInput}
          accessibilityLabel="Memo"
          accessibilityHint="Recorded on-chain. Maximum 80 bytes."
        />
        <Txt variant="small" tone="muted" style={styles.memoCount}>
          {memoBytes}/80 bytes · written on-chain and publicly readable
        </Txt>
      </Card>

      <PillButton
        label="Continue"
        onPress={onContinue}
        disabled={!canContinue}
        badge={<Icon name="arrowRight" size={15} color={base.onAccent} />}
        accessibilityHint="Go to reviewing the payment before you send it."
      />
    </>
  );
}

/* ─── Review ─────────────────────────────────────────────────────────────── */

function ReviewStep({
  amountWei,
  fromHandle,
  recipientName,
  recipientAddress,
  memo,
  onBack,
  onConfirm,
}: {
  amountWei: bigint;
  fromHandle: string | null;
  recipientName: string;
  recipientAddress: string;
  memo: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  // The gas statement is derived, never typed: it reads the same predicate the submit path
  // routes by. A send is on the relayer's allowlist, so it is truthfully sponsored; if the
  // routing ever changed, this line would change with it rather than lying.
  const sponsored = isSponsored({ type: 'send', musdWei: amountWei, to: recipientAddress, memo });

  return (
    <>
      <StepHeader title="Review" onBack={onBack} backLabel="Back to recipient" />

      <Card style={styles.reviewCard}>
        <Label>{fromHandle ? `From ${fromHandle}` : 'From you'}</Label>
        <View style={styles.reviewAmount}>
          <Musd wei={amountWei} size="numericLg" dimFraction align="left" />
        </View>
      </Card>

      <View style={styles.arrowDisc}>
        <Icon name="arrowDown" size={16} color={text.muted} />
      </View>

      <Card style={styles.reviewCard}>
        <Label>To</Label>
        <Txt variant="h3" style={styles.reviewTo} numberOfLines={1}>
          {recipientName}
        </Txt>
        <Num size="numericSm" tone="muted">
          {shortAddress(recipientAddress)}
        </Num>
        {memo ? (
          <View style={styles.memoReview}>
            <Label>Memo</Label>
            <Txt variant="small" tone="muted">
              {memo}
            </Txt>
          </View>
        ) : null}
      </Card>

      <View
        style={styles.feeLine}
        accessible
        accessibilityLabel={
          sponsored
            ? `${gasCopy.sponsoredTitle}. ${gasCopy.sponsoredBody}`
            : 'You pay the BTC gas for this transaction.'
        }
      >
        <Icon name="shield" size={15} color={sponsored ? brand.violet400 : semanticText.warning} />
        <Txt variant="small" tone="muted" style={styles.feeText}>
          {sponsored
            ? 'Gasless. You sign; Maren’s relayer submits it and pays the BTC gas.'
            : 'This transaction is not relayed, so you pay the BTC gas yourself.'}
        </Txt>
      </View>

      <PillButton
        label={`Send ${formatMusd(amountWei)}`}
        onPress={onConfirm}
        badge={<Icon name="arrowUpRight" size={15} color={base.onAccent} />}
        accessibilityHint="Requires Face ID, then waits for an on-chain receipt."
      />
    </>
  );
}

/** The stepper's back affordance and step title. A tab panel, so it steps rather than pushes. */
function StepHeader({
  title,
  onBack,
  backLabel,
}: {
  title: string;
  onBack: () => void;
  backLabel: string;
}) {
  return (
    <View style={styles.stepHeader}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        style={({ pressed }) => [styles.backDisc, pressed && styles.pressed]}
        hitSlop={8}
      >
        <Icon name="chevronLeft" size={18} color={text.primary} />
      </Pressable>
      <Label style={styles.stepTitle}>{title}</Label>
      {/* A spacer the width of the disc, so the title reads optically centred. */}
      <View style={styles.backDiscSpacer} />
    </View>
  );
}

function RequestPanel() {
  const address = useAppStore((s) => s.address);
  const handle = useAppStore((s) => s.handle);
  const [amount, setAmount] = useState('');
  const [open, setOpen] = useState(false);

  const amountWei = parseMusd(amount);

  return (
    <>
      <Card style={styles.panel}>
        <Label>Request a specific amount (optional)</Label>
        <View style={styles.amountRow}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={text.subtle}
            keyboardType="decimal-pad"
            style={styles.amountInput}
            accessibilityLabel="Requested amount in MUSD"
          />
          <Num size="numericSm" tone="musd">
            MUSD
          </Num>
        </View>
        <Txt variant="small" tone="muted" style={styles.memoCount}>
          {amountWei > 0n
            ? `Your code will request ${formatMusd(amountWei)}.`
            : 'Leave blank to let the sender choose the amount.'}
        </Txt>
      </Card>

      <PillButton
        label="Show my receive code"
        onPress={() => setOpen(true)}
        badge={<Icon name="scan" size={15} color={base.onAccent} />}
        accessibilityHint="Opens a sheet with your QR code, handle and address."
      />

      <ReceiveSheet
        visible={open}
        onClose={() => setOpen(false)}
        handle={handle}
        address={address}
        amount={amountWei > 0n ? amount : undefined}
      />
    </>
  );
}

/**
 * The receive sheet — the request flow raised into a bottom sheet, matching the reference
 * "Receive" screen. Grabber, centred title, the QR enlarged in a clean white field, an
 * info card of real values, and a pill action row.
 *
 * `Save QR` is deliberately absent: there is no honest one without pulling in a
 * media-library dependency and a photos permission, and the brief is explicit that a
 * stubbed action is worse than a missing one. Copy and Share both do exactly what they
 * say — Share hands off the very payload the QR encodes, built by the same module the
 * scanner parses with, so the two can never drift.
 */
function ReceiveSheet({
  visible,
  onClose,
  handle,
  address,
  amount,
}: {
  visible: boolean;
  onClose: () => void;
  handle: string | null;
  address: string | null;
  amount?: string;
}) {
  const insets = useSafeAreaInsets();
  const network = useAppStore((s) => s.network);
  const [copied, setCopied] = useState(false);

  const payload = buildPaymentPayload(handle ?? address ?? '', amount);
  // Mezo's testnet is named Matsnet; the label is the real network, not a placeholder.
  const networkLabel = network === 'mainnet' ? 'Mezo Mainnet' : 'Mezo Matsnet';

  const copyAddress = async () => {
    await Clipboard.setStringAsync(address ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1_800);
  };

  const shareQr = async () => {
    try {
      await Share.share({ message: payload });
    } catch {
      // The user dismissed the system share sheet; nothing to recover.
    }
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.sheetBackdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close receive sheet"
      >
        {/* Inner press is swallowed so a tap on the sheet body does not dismiss it. */}
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + space.xl }]}
          onPress={() => {}}
          accessibilityViewIsModal
        >
          <View style={styles.grabber} />

          <Txt variant="h3" style={styles.sheetTitle}>
            Receive MUSD
          </Txt>
          <Txt variant="small" tone="muted" style={styles.sheetSubtitle}>
            {handle
              ? `Anyone with Maren can scan this to pay ${handle}.`
              : 'Anyone with Maren can scan this to pay you.'}
          </Txt>

          <View style={styles.qrField}>
            <QRCode
              value={payload}
              size={200}
              backgroundColor={base.onAccent}
              color={text.primary}
              quietZone={8}
            />
          </View>

          <Card tone="inset" padded={false} style={styles.receiveInfo}>
            <StatRow label="Network" value={<Txt variant="small">{networkLabel}</Txt>} />
            {handle ? (
              <StatRow label="Handle" value={<Txt variant="small">{handle}</Txt>} last={!address} />
            ) : null}
            {address ? (
              <StatRow
                label="Address"
                value={
                  <Num size="numericSm" tone="muted">
                    {shortAddress(address, 10, 8)}
                  </Num>
                }
                last
              />
            ) : null}
          </Card>

          {amount ? (
            <Txt variant="small" tone="muted" style={styles.receiveAmountNote}>
              This code requests {formatMusd(parseMusd(amount))}.
            </Txt>
          ) : null}

          <View style={styles.receiveActions}>
            <PillButton
              label={copied ? 'Copied' : 'Copy address'}
              variant="secondary"
              block={false}
              style={styles.receiveAction}
              onPress={copyAddress}
              accessibilityHint="Copies your full Mezo address to the clipboard."
            />
            <PillButton
              label="Share QR"
              variant="secondary"
              block={false}
              style={styles.receiveAction}
              onPress={shareQr}
              accessibilityHint="Opens the system share sheet with your payment link."
            />
          </View>

          <Txt variant="small" tone="muted" style={styles.qrCaption}>
            They pay no BTC gas either, because the relayer covers both sides.
          </Txt>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** UTF-8 byte length, for the 80-byte on-chain memo cap. */
function utf8Length(s: string): number {
  let bytes = 0;
  for (const char of s) {
    const cp = char.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Parse a decimal MUSD string to 1e18 wei without going through a float. */
function parseMusd(input: string): bigint {
  const cleaned = input.replace(/,/g, '').trim();
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return 0n;
  const [whole = '0', frac = ''] = cleaned.split('.');
  const padded = (frac + '000000000000000000').slice(0, 18);
  try {
    return BigInt(whole || '0') * 10n ** 18n + BigInt(padded || '0');
  } catch {
    return 0n;
  }
}

const styles = StyleSheet.create({
  header: { marginBottom: space.xl },
  title: { marginTop: space.xs },
  segmented: {
    flexDirection: 'row',
    backgroundColor: base.surfaceInset,
    borderRadius: radius.pill,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    marginBottom: space.lg,
  },
  segment: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  segmentActive: { backgroundColor: base.surfaceRaised },

  // ── Stepper chrome ────────────────────────────────────────────────────────
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  backDisc: {
    width: hit.min,
    height: hit.min,
    borderRadius: radius.pill,
    backgroundColor: base.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backDiscSpacer: { width: hit.min, height: hit.min },
  stepTitle: { textAlign: 'center' },

  // ── Amount step ───────────────────────────────────────────────────────────
  amountHero: {
    alignItems: 'center',
    marginTop: space.xxl,
    marginBottom: space.lg,
    minHeight: 56,
    justifyContent: 'center',
  },
  overNote: { marginTop: space.md },
  walletPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: space.sm,
    minHeight: 36,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    marginBottom: space.xl,
  },
  walletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    // A quiet cue that this figure is your spendable MUSD; a 6px fill, so 3:1 is the bar.
    backgroundColor: semantic.musd,
  },
  padWrap: { marginBottom: space.xl },

  // ── Recipient step ────────────────────────────────────────────────────────
  panel: { marginBottom: space.xl },
  recipientRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  recipientInput: {
    flex: 1,
    minHeight: 44,
    color: text.primary,
    fontFamily: fonts.mono,
    fontSize: 15,
  },
  scanButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: base.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resolved: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  resolveNote: { marginTop: space.sm },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: base.border,
    marginVertical: space.lg,
  },
  memoInput: {
    minHeight: 44,
    color: text.primary,
    fontFamily: fonts.regular,
    fontSize: 15,
    marginTop: space.sm,
  },
  memoCount: { marginTop: space.xs },

  // ── Review step ───────────────────────────────────────────────────────────
  reviewCard: { marginBottom: space.md, gap: space.sm },
  reviewAmount: { marginTop: space.xs },
  reviewTo: { marginTop: space.xs },
  memoReview: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: base.border,
    gap: space.xs,
  },
  arrowDisc: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: space.md,
  },
  feeLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.xl,
    paddingHorizontal: space.xs,
  },
  feeText: { flex: 1 },

  // ── Request panel ─────────────────────────────────────────────────────────
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: space.sm },
  amountInput: {
    flex: 1,
    color: text.primary,
    fontFamily: fonts.monoMedium,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -0.8,
    minHeight: 52,
  },
  qrCaption: { textAlign: 'center', marginTop: space.lg, maxWidth: 300 },
  pressed: { opacity: 0.6 },

  // ── Receive sheet ─────────────────────────────────────────────────────────
  sheetBackdrop: {
    flex: 1,
    // The same near-black scrim TxSheet uses — the one place near-black survives on the
    // light theme, because a light scrim over a light page does not push it back.
    backgroundColor: 'rgba(23,20,41,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: base.surfaceRaised,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    alignItems: 'center',
    ...modalShadow,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: base.borderStrong,
    marginBottom: space.lg,
  },
  sheetTitle: { textAlign: 'center' },
  sheetSubtitle: { textAlign: 'center', marginTop: space.xs, maxWidth: 300 },
  /** A clean white rounded field the QR sits centred in, per the reference. */
  qrField: {
    marginTop: space.xl,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: base.onAccent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
  },
  receiveInfo: {
    alignSelf: 'stretch',
    marginTop: space.xl,
    paddingHorizontal: space.lg,
  },
  receiveAmountNote: { textAlign: 'center', marginTop: space.md },
  receiveActions: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.xl,
    alignSelf: 'stretch',
  },
  receiveAction: { flex: 1 },
});
