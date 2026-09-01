import { useRef, useState } from 'react';
import { Modal, Pressable, Share, StyleSheet, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import type { Hex } from 'viem';
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
import { isSponsored, type CreatedRefs } from '../../src/chain/actions';
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
import { buildClaimLink, buildPaymentPayload } from '../../src/lib/payment';
import { useAppStore } from '../../src/state/store';
import { createPrivateKey, deriveAddress } from '../../src/wallet/keystore';

type Tab = 'send' | 'request' | 'split' | 'link';

const TAB_LABELS: Record<Tab, string> = {
  send: 'Send',
  request: 'Request',
  split: 'Split',
  link: 'Link',
};

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
        {(['send', 'request', 'split', 'link'] as Tab[]).map((t) => {
          const active = t === tab;
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={TAB_LABELS[t]}
              style={[styles.segment, active && styles.segmentActive]}
            >
              <Txt variant="small" tone={active ? 'primary' : 'muted'}>
                {TAB_LABELS[t]}
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
      ) : tab === 'request' ? (
        <RequestPanel />
      ) : tab === 'split' ? (
        <SplitPanel onScan={() => router.push('/scan')} />
      ) : (
        <LinkPanel />
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

/**
 * Request — two honest ways to ask for MUSD.
 *
 * "Show my receive code" is the existing local QR: no chain, the sender scans and chooses to
 * pay. "Create request" records the ask on-chain through `createRequest` (relayed, so gasless)
 * and hands back a shareable pay link. Both share the one amount field, and the on-chain
 * request is the durable record — it shows in Activity as "Requested MUSD" and carries the id
 * the chain assigned.
 */
function RequestPanel() {
  const address = useAppStore((s) => s.address);
  const handle = useAppStore((s) => s.handle);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ requestId?: bigint } | null>(null);

  const amountWei = parseMusd(amount);
  const noteBytes = utf8Length(note);

  const runner = useTxRunner((refs?: CreatedRefs) => setCreated({ requestId: refs?.requestId }));

  if (created) {
    return (
      <RequestShare
        requestId={created.requestId}
        amount={amount}
        amountWei={amountWei}
        handle={handle}
        address={address}
        onDone={() => {
          setCreated(null);
          setAmount('');
          setNote('');
        }}
      />
    );
  }

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

        <View style={styles.divider} />

        <Label>Note (optional)</Label>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="What is this for?"
          placeholderTextColor={text.muted}
          maxLength={80}
          style={styles.memoInput}
          accessibilityLabel="Request note"
          accessibilityHint="Recorded on-chain with the request. Maximum 80 bytes."
        />
        <Txt variant="small" tone="muted" style={styles.memoCount}>
          {noteBytes}/80 bytes · written on-chain with an on-chain request
        </Txt>
      </Card>

      <PillButton
        label="Create request"
        onPress={() =>
          runner.run(
            { type: 'request', musdWei: amountWei, memo: note.trim() || undefined },
            `Request ${formatMusd(amountWei)}`,
          )
        }
        disabled={amountWei <= 0n}
        badge={<Icon name="arrowRight" size={15} color={base.onAccent} />}
        accessibilityHint="Records the request on Mezo. Gasless. Then shows a link to share."
      />

      <PillButton
        label="Show my receive code"
        variant="secondary"
        onPress={() => setOpen(true)}
        style={styles.secondaryAction}
        accessibilityHint="Opens a sheet with your QR code, handle and address. No chain, instant."
      />

      <ReceiveSheet
        visible={open}
        onClose={() => setOpen(false)}
        handle={handle}
        address={address}
        amount={amountWei > 0n ? amount : undefined}
      />

      <TxSheet runner={runner} />
    </>
  );
}

/**
 * The share step for a created request. The QR and link encode a pay-to-me payload the
 * scanner already understands, so a payer needs nothing new to pay it. The request id is the
 * on-chain record; when it could not be read from the receipt the flow says so plainly rather
 * than inventing a number.
 */
function RequestShare({
  requestId,
  amount,
  amountWei,
  handle,
  address,
  onDone,
}: {
  requestId?: bigint;
  amount: string;
  amountWei: bigint;
  handle: string | null;
  address: string | null;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const payload = buildPaymentPayload(handle ?? address ?? '', amount);

  const copyLink = async () => {
    await Clipboard.setStringAsync(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_800);
  };

  return (
    <View style={styles.shareStack}>
      <View style={styles.shareHead}>
        <Label>Requesting</Label>
        <Musd wei={amountWei} size="numericLg" dimFraction align="left" />
        <Txt variant="small" tone="muted" style={styles.shareSub}>
          {requestId !== undefined
            ? `Recorded on Mezo as request #${requestId.toString()}. Share this to get paid.`
            : 'Recorded on Mezo. Find it in Activity. Share this to get paid.'}
        </Txt>
      </View>

      <View style={[styles.qrField, styles.selfCenter]}>
        <QRCode
          value={payload}
          size={190}
          backgroundColor={base.onAccent}
          color={text.primary}
          quietZone={8}
        />
      </View>

      <View style={styles.shareActions}>
        <PillButton
          label={copied ? 'Copied' : 'Copy link'}
          variant="secondary"
          block={false}
          style={styles.receiveAction}
          onPress={copyLink}
          accessibilityHint="Copies the payment link to the clipboard."
        />
        <PillButton
          label="Share link"
          variant="secondary"
          block={false}
          style={styles.receiveAction}
          onPress={() => Share.share({ message: payload }).catch(() => {})}
          accessibilityHint="Opens the system share sheet with the payment link."
        />
      </View>

      <PillButton label="Done" onPress={onDone} style={styles.shareDone} />
    </View>
  );
}

/* ─── Split ──────────────────────────────────────────────────────────────── */

const MAX_SPLIT = 64; // MarenPay.MAX_SPLIT_RECIPIENTS
const HANDLE_RE = /^@[a-z0-9_]{3,32}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

interface SplitRow {
  id: number;
  to: string;
  amount: string;
}

/**
 * Split — pay several people in one signed call.
 *
 * The contract's `split` takes addresses, so any `@handle` is resolved on Confirm through the
 * same MarenRegistry read the Send stepper uses; a handle that does not resolve stops the
 * submit with a named error rather than being sent to a guessed address. Split IS on the
 * relayer's allowlist, so it is gasless, and the review step says so from the same predicate
 * the submit routes by.
 */
function SplitPanel({ onScan }: { onScan: () => void }) {
  const { data: balances } = useBalances();
  const handle = useAppStore((s) => s.handle);

  const nextId = useRef(2);
  const [rows, setRows] = useState<SplitRow[]>([
    { id: 0, to: '', amount: '' },
    { id: 1, to: '', amount: '' },
  ]);
  const [memo, setMemo] = useState('');
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const runner = useTxRunner(() => {
    setRows([
      { id: nextId.current++, to: '', amount: '' },
      { id: nextId.current++, to: '', amount: '' },
    ]);
    setMemo('');
    setStep('edit');
    setError(null);
  });

  const setRow = (id: number, patch: Partial<SplitRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((rs) =>
      rs.length >= MAX_SPLIT ? rs : [...rs, { id: nextId.current++, to: '', amount: '' }],
    );
  const removeRow = (id: number) => setRows((rs) => rs.filter((r) => r.id !== id));

  const total = rows.reduce((sum, r) => sum + parseMusd(r.amount), 0n);
  const overBalance = balances !== undefined && total > balances.musdWei;
  const rowValid = (r: SplitRow) => {
    const to = r.to.trim();
    return parseMusd(r.amount) > 0n && (ADDRESS_RE.test(to) || HANDLE_RE.test(to));
  };
  const allValid = rows.length > 0 && rows.every(rowValid);
  const canContinue = allValid && total > 0n && !overBalance;

  const onConfirm = async () => {
    setResolving(true);
    setError(null);
    const recipients: string[] = [];
    for (const r of rows) {
      const to = r.to.trim();
      if (ADDRESS_RE.test(to)) {
        recipients.push(to);
        continue;
      }
      const resolved = await resolveHandle(to);
      if (!resolved) {
        setError(`No such handle on this network: ${to}`);
        setResolving(false);
        return;
      }
      recipients.push(resolved.address);
    }
    const amounts = rows.map((r) => parseMusd(r.amount));
    setResolving(false);
    runner.run(
      { type: 'split', recipients, amounts, memo: memo.trim() || undefined },
      `Split ${formatMusd(total)} across ${rows.length}`,
    );
  };

  if (step === 'review') {
    const sponsored = isSponsored({ type: 'split', recipients: [], amounts: [], memo });
    return (
      <View style={styles.reviewStack}>
        <StepHeader title="Review split" onBack={() => setStep('edit')} backLabel="Back to editing" />

        <Card style={styles.reviewCard}>
          <Label>{handle ? `From ${handle}` : 'From you'}</Label>
          <View style={styles.reviewAmount}>
            <Musd wei={total} size="numericLg" dimFraction align="left" />
          </View>
          <Txt variant="small" tone="muted">
            {rows.length} recipients, each paid directly. Nothing is pooled.
          </Txt>
        </Card>

        <Card padded={false}>
          {rows.map((r, i) => {
            const to = r.to.trim();
            return (
              <StatRow
                key={r.id}
                label={ADDRESS_RE.test(to) ? shortAddress(to) : to}
                value={<Musd wei={parseMusd(r.amount)} size="numericSm" plain />}
                last={i === rows.length - 1}
              />
            );
          })}
        </Card>

        {memo ? (
          <Card style={styles.reviewCard}>
            <Label>Memo</Label>
            <Txt variant="small" tone="muted">
              {memo}
            </Txt>
          </Card>
        ) : null}

        {error ? (
          <Txt
            variant="small"
            style={[styles.errorNote, { color: semanticText.danger }]}
            accessibilityRole="alert"
          >
            {error}
          </Txt>
        ) : null}

        <FeeLine sponsored={sponsored} />

        <PillButton
          label={`Send ${formatMusd(total)}`}
          onPress={onConfirm}
          loading={resolving}
          badge={<Icon name="arrowUpRight" size={15} color={base.onAccent} />}
          accessibilityHint="Resolves handles, then requires Face ID and waits for a receipt."
        />

        <TxSheet runner={runner} />
      </View>
    );
  }

  return (
    <View style={styles.editStack}>
      {rows.map((r, i) => (
        <Card key={r.id} style={styles.splitRow}>
          <View style={styles.splitRowHead}>
            <Label>{`Recipient ${i + 1}`}</Label>
            {rows.length > 1 ? (
              <Pressable
                onPress={() => removeRow(r.id)}
                accessibilityRole="button"
                accessibilityLabel={`Remove recipient ${i + 1}`}
                style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                hitSlop={8}
              >
                <Icon name="close" size={16} color={text.muted} />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.recipientRow}>
            <TextInput
              value={r.to}
              onChangeText={(t) => setRow(r.id, { to: t })}
              placeholder="@handle or 0x address"
              placeholderTextColor={text.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.recipientInput}
              accessibilityLabel={`Recipient ${i + 1}`}
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

          <View style={styles.splitAmountRow}>
            <TextInput
              value={r.amount}
              onChangeText={(t) => setRow(r.id, { amount: t.replace(/[^0-9.]/g, '') })}
              placeholder="0.00"
              placeholderTextColor={text.subtle}
              keyboardType="decimal-pad"
              style={styles.splitAmountInput}
              accessibilityLabel={`Amount for recipient ${i + 1} in MUSD`}
            />
            <Num size="numericSm" tone="musd">
              MUSD
            </Num>
          </View>
        </Card>
      ))}

      {rows.length < MAX_SPLIT ? (
        <Pressable
          onPress={addRow}
          accessibilityRole="button"
          accessibilityLabel="Add another recipient"
          style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
        >
          <Icon name="plus" size={16} color={text.primary} />
          <Txt variant="small">Add recipient</Txt>
        </Pressable>
      ) : null}

      <View style={styles.totalRow}>
        <Txt variant="small" tone="muted">
          Total
        </Txt>
        <Musd wei={total} size="numericMd" dimFraction plain />
      </View>
      {overBalance ? (
        <Txt
          variant="small"
          style={[styles.errorNote, { color: semanticText.danger }]}
          accessibilityRole="alert"
        >
          More than your MUSD balance.
        </Txt>
      ) : null}

      <PillButton
        label="Review split"
        onPress={() => setStep('review')}
        disabled={!canContinue}
        badge={<Icon name="arrowRight" size={15} color={base.onAccent} />}
        accessibilityHint="Go to reviewing the recipients before you send."
      />
    </View>
  );
}

/* ─── Claimable link ─────────────────────────────────────────────────────── */

type LinkStep = 'amount' | 'details' | 'review';

const EXPIRY_OPTIONS = [
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
] as const;

/**
 * Claimable link — escrow MUSD to whoever opens the link.
 *
 * THE SECRET IS A ONE-TIME PRIVATE KEY generated on this device. Its address is what goes
 * on-chain as `linkKey`; the key itself never touches the chain and never leaves this device
 * except inside the link the user chooses to share. It is generated at Confirm, held in a ref
 * (never state that renders, never a log), and used once the transaction confirms to build the
 * claim URL, which is shown a single time.
 *
 * createLink is NOT on the relayer's allowlist, so this ONE Pay action self-submits and the
 * user pays the BTC gas. The review step says so — it reads the same `isSponsored` predicate
 * the submit path routes by, which returns false here, so the copy cannot drift from the rail.
 */
function LinkPanel() {
  const { data: balances } = useBalances();

  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [expiryDays, setExpiryDays] = useState(7);
  const [step, setStep] = useState<LinkStep>('amount');
  const [issued, setIssued] = useState<{ claimUrl: string | null; expiry: number } | null>(null);

  // The bearer secret. A ref, so it never lands in a rendered value or a log; cleared on reset.
  const secretRef = useRef<Hex | null>(null);
  const expiryRef = useRef<number>(0);

  const amountWei = parseMusd(amount);
  const overBalance = balances !== undefined && amountWei > balances.musdWei;
  const amountOk = amountWei > 0n && !overBalance;

  const runner = useTxRunner((refs?: CreatedRefs) => {
    const secret = secretRef.current;
    const claimUrl =
      secret && refs?.linkId !== undefined ? buildClaimLink(refs.linkId, secret) : null;
    setIssued({ claimUrl, expiry: expiryRef.current });
    secretRef.current = null;
  });

  const reset = () => {
    setIssued(null);
    setAmount('');
    setMemo('');
    setExpiryDays(7);
    setStep('amount');
    secretRef.current = null;
  };

  const confirm = () => {
    const secret = createPrivateKey();
    secretRef.current = secret;
    const linkKey = deriveAddress(secret);
    const expiry = nowSeconds() + expiryDays * 86_400;
    expiryRef.current = expiry;
    runner.run(
      {
        type: 'link-create',
        linkKey,
        musdWei: amountWei,
        expiry: BigInt(expiry),
        memo: memo.trim() || undefined,
      },
      `Create a ${formatMusd(amountWei)} link`,
    );
  };

  if (issued) {
    return <LinkIssued issued={issued} amountWei={amountWei} onDone={reset} />;
  }

  if (step === 'amount') {
    return (
      <AmountStep
        amount={amount}
        setAmount={setAmount}
        balances={balances}
        overBalance={overBalance}
        canContinue={amountOk}
        onContinue={() => setStep('details')}
      />
    );
  }

  if (step === 'details') {
    const memoBytes = utf8Length(memo);
    return (
      <View style={styles.editStack}>
        <StepHeader title="Link details" onBack={() => setStep('amount')} backLabel="Back to amount" />

        <Card style={styles.panel}>
          <Label>Expires after</Label>
          <Txt variant="small" tone="muted" style={styles.memoCount}>
            Unclaimed after this, you can reclaim the MUSD. Sooner is safer.
          </Txt>
          <View style={styles.expiryChips} accessibilityRole="radiogroup">
            {EXPIRY_OPTIONS.map((opt) => {
              const active = opt.days === expiryDays;
              return (
                <Pressable
                  key={opt.days}
                  onPress={() => setExpiryDays(opt.days)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Expires after ${opt.label}`}
                  style={[styles.expiryChip, active && styles.expiryChipActive]}
                >
                  <Txt variant="small" tone={active ? 'primary' : 'muted'}>
                    {opt.label}
                  </Txt>
                </Pressable>
              );
            })}
          </View>

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
          onPress={() => setStep('review')}
          badge={<Icon name="arrowRight" size={15} color={base.onAccent} />}
          accessibilityHint="Go to reviewing the link before you fund it."
        />
      </View>
    );
  }

  // review
  const sponsored = isSponsored({ type: 'link-create', linkKey: '', musdWei: amountWei, expiry: 0n });
  const expiryDate = new Date((nowSeconds() + expiryDays * 86_400) * 1000);
  return (
    <View style={styles.reviewStack}>
      <StepHeader title="Review link" onBack={() => setStep('details')} backLabel="Back to details" />

      <Card style={styles.reviewCard}>
        <Label>You escrow</Label>
        <View style={styles.reviewAmount}>
          <Musd wei={amountWei} size="numericLg" dimFraction align="left" />
        </View>
        <Txt variant="small" tone="muted">
          Held by MarenPay until claimed. Reclaimable by you after {formatDate(expiryDate)}.
        </Txt>
      </Card>

      {memo ? (
        <Card style={styles.reviewCard}>
          <Label>Memo</Label>
          <Txt variant="small" tone="muted">
            {memo}
          </Txt>
        </Card>
      ) : null}

      <FeeLine sponsored={sponsored} />

      <PillButton
        label={`Fund ${formatMusd(amountWei)} link`}
        onPress={confirm}
        badge={<Icon name="arrowUpRight" size={15} color={base.onAccent} />}
        accessibilityHint="Requires Face ID, then waits for an on-chain receipt. You pay the BTC gas."
      />

      <TxSheet runner={runner} />
    </View>
  );
}

/**
 * The issued link. The secret-bearing URL is shown exactly once — there is no way to recover
 * it after this screen, by design, because the app never stores it. Reclaim lives here too,
 * gated on the chosen expiry: the contract reverts before it, so the button is disabled with
 * the date stated rather than letting the user pay gas to discover the revert.
 */
function LinkIssued({
  issued,
  amountWei,
  onDone,
}: {
  issued: { claimUrl: string | null; expiry: number };
  amountWei: bigint;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const linkId = issued.claimUrl ? readLinkId(issued.claimUrl) : null;
  const reclaimable = nowSeconds() >= issued.expiry;

  // A reclaimed link is spent, so a delivered reclaim clears this screen back to a clean
  // start rather than leaving the dead claim link and QR sitting there as if still payable.
  const reclaimRunner = useTxRunner(() => onDone());
  const expiryDate = new Date(issued.expiry * 1000);

  const copy = async () => {
    if (!issued.claimUrl) return;
    await Clipboard.setStringAsync(issued.claimUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_800);
  };

  return (
    <View style={styles.shareStack}>
      <View style={styles.shareHead}>
        <Label>Link funded</Label>
        <Musd wei={amountWei} size="numericLg" dimFraction align="left" />
        <Txt variant="small" tone="muted" style={styles.shareSub}>
          Anyone with this link can claim it once. Share it only with the person you mean to pay.
        </Txt>
      </View>

      {issued.claimUrl ? (
        <>
          <View style={[styles.qrField, styles.selfCenter]}>
            <QRCode
              value={issued.claimUrl}
              size={190}
              backgroundColor={base.onAccent}
              color={text.primary}
              quietZone={8}
            />
          </View>

          <Card tone="inset" style={styles.linkField}>
            <Txt variant="small" tone="muted" style={styles.linkText} numberOfLines={3}>
              {issued.claimUrl}
            </Txt>
          </Card>

          <View style={styles.shareActions}>
            <PillButton
              label={copied ? 'Copied' : 'Copy link'}
              variant="secondary"
              block={false}
              style={styles.receiveAction}
              onPress={copy}
              accessibilityHint="Copies the one-time claim link to the clipboard."
            />
            <PillButton
              label="Share link"
              variant="secondary"
              block={false}
              style={styles.receiveAction}
              onPress={() => Share.share({ message: issued.claimUrl ?? '' }).catch(() => {})}
              accessibilityHint="Opens the system share sheet with the one-time claim link."
            />
          </View>
        </>
      ) : (
        <Card style={styles.reviewCard}>
          <Txt variant="small" tone="muted">
            The link was funded on Mezo, but its id could not be read from the receipt, so the
            claim link cannot be shown here. Find it in Activity to reclaim after it expires.
          </Txt>
        </Card>
      )}

      <View style={styles.reclaimBlock}>
        {reclaimable && linkId !== null ? (
          <PillButton
            label="Reclaim the MUSD"
            variant="secondary"
            tone="danger"
            onPress={() =>
              reclaimRunner.run({ type: 'link-reclaim', linkId }, `Reclaim ${formatMusd(amountWei)}`)
            }
            accessibilityHint="Takes an unclaimed link back. Requires Face ID. You pay the BTC gas."
          />
        ) : (
          <Txt variant="small" tone="muted" style={styles.reclaimNote}>
            You can reclaim this if it is unclaimed after {formatDate(expiryDate)}.
          </Txt>
        )}
      </View>

      <PillButton label="Done" onPress={onDone} style={styles.shareDone} />

      <TxSheet runner={reclaimRunner} />
    </View>
  );
}

/** Read the `id` back out of a claim URL, for the reclaim call. */
function readLinkId(claimUrl: string): bigint | null {
  try {
    const id = new URL(claimUrl).searchParams.get('id');
    return id !== null && /^\d+$/.test(id) ? BigInt(id) : null;
  } catch {
    return null;
  }
}

/**
 * The clock, read in a module-level helper rather than in a component body.
 *
 * `Date.now()` is impure, and the render-purity lint (rightly) refuses it inside a component;
 * the app reads the clock from helpers like this one instead, the same way `activity.tsx`
 * groups its rows. The values here are display-only or gate a button, so a read at render time
 * is exactly what is wanted — the expiry copy and the reclaim gate reflect the current moment.
 */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** A short, unambiguous date for expiry copy. */
function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The one gas statement, derived — never typed. It reads the same `isSponsored` predicate the
 * submit path routes by, so it flips with the rail rather than lying: gasless for the relayed
 * actions, "you pay the BTC gas" for the self-submitted link.
 */
function FeeLine({ sponsored }: { sponsored: boolean }) {
  return (
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
          : 'This action is not relayed, so you sign and pay the BTC gas yourself.'}
      </Txt>
    </View>
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

  // ── Shared stacks for the new flows ─────────────────────────────────────────
  // Screen already scrolls, so these are plain vertical stacks, not nested ScrollViews.
  editStack: { gap: space.md },
  reviewStack: { gap: space.md },
  shareStack: { gap: space.lg },
  secondaryAction: { marginTop: space.md },
  errorNote: { paddingHorizontal: space.xs },

  // ── Split ───────────────────────────────────────────────────────────────────
  splitRow: { gap: space.sm },
  splitRowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  removeButton: {
    width: hit.min,
    height: hit.min,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  splitAmountRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  splitAmountInput: {
    flex: 1,
    color: text.primary,
    fontFamily: fonts.monoMedium,
    fontSize: 22,
    lineHeight: 28,
    minHeight: 44,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: hit.min,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    borderStyle: 'dashed',
    backgroundColor: base.surfaceInset,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
    marginTop: space.sm,
  },

  // ── Share / issued ──────────────────────────────────────────────────────────
  shareHead: { alignItems: 'center', gap: space.sm, marginTop: space.lg },
  shareSub: { textAlign: 'center', maxWidth: 320 },
  selfCenter: { alignSelf: 'center' },
  shareActions: { flexDirection: 'row', gap: space.md, alignSelf: 'stretch' },
  shareDone: { marginTop: space.sm },
  linkField: { alignSelf: 'stretch' },
  linkText: { fontFamily: fonts.mono, lineHeight: 19 },
  reclaimBlock: { marginTop: space.sm },
  reclaimNote: { textAlign: 'center' },

  // ── Claimable link details ──────────────────────────────────────────────────
  expiryChips: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  expiryChip: {
    flex: 1,
    minHeight: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
  },
  expiryChipActive: { backgroundColor: base.surfaceRaised, borderColor: base.borderStrong },
});
