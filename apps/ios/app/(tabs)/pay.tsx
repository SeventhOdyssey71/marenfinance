import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { formatMusd, shortAddress } from '@maren/sdk';

import { Musd } from '../../src/components/Money';
import { Card } from '../../src/components/Card';
import { Icon } from '../../src/components/Icon';
import { PillButton } from '../../src/components/PillButton';
import { Screen } from '../../src/components/Screen';
import { Label, Num, Txt } from '../../src/components/Text';
import { TxSheet, useTxRunner } from '../../src/components/TxSheet';
import { base, brand, radius, semantic, space } from '../../src/design/tokens';
import { fonts } from '../../src/design/type';
import { resolveHandle } from '../../src/data/mock';
import type { Handle } from '../../src/data/types';
import { useBalances } from '../../src/hooks/useChainData';
import { gasCopy } from '../../src/lib/copy';
import { buildPaymentPayload } from '../../src/lib/payment';
import { useAppStore } from '../../src/state/store';

type Tab = 'send' | 'request';

/**
 * Pay — send MUSD to a @handle or address, request, and scan to pay.
 *
 * The gasless claim is made once, prominently, and it is specific: the relayer pays the
 * BTC gas, so the user pays none. TALISE-BLUEPRINT §7 #36 is explicit that we must
 * decide between "say $0 truthfully" and "show gas in sats" — every payment goes through
 * MarenForwarder, so $0 is the true statement here.
 *
 * It is true *here*. It is not true of the first deposit, which is payable and therefore
 * cannot be relayed, and the Vault screen says so just as plainly. Both screens read
 * their wording from `gasCopy` and their sponsorship from `isSponsored`, so neither can
 * quietly start promising the other's terms.
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
  const runner = useTxRunner();

  const [to, setTo] = useState(initialTo ?? '');
  const [amount, setAmount] = useState(initialAmount ?? '');
  const [memo, setMemo] = useState('');

  /**
   * Deep-linked values from the scanner arrive after mount.
   *
   * Adjusted during render against the previous prop rather than in an effect. React's
   * own guidance for "reset state when a prop changes" is this pattern; the effect
   * version renders once with the stale value and then again with the new one, which is
   * the cascading render the purity rules are pointing at.
   */
  const [seenParams, setSeenParams] = useState({ to: initialTo, amount: initialAmount });
  if (seenParams.to !== initialTo || seenParams.amount !== initialAmount) {
    setSeenParams({ to: initialTo, amount: initialAmount });
    if (initialTo) setTo(initialTo);
    if (initialAmount) setAmount(initialAmount);
  }

  /**
   * Handle resolution through MarenRegistry.
   *
   * A query rather than an effect plus two useStates. It is a keyed async read of remote
   * data, which is what the rest of the app already uses TanStack Query for — and it
   * removes the manual `alive` flag, the loading boolean, and the synchronous setState
   * in an effect that came with hand-rolling it.
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
  const canSend = recipientOk && amountWei > 0n && !overBalance;

  // MarenPay caps the on-chain memo at 80 BYTES, not characters — one emoji is four.
  // Computed directly rather than via TextEncoder, whose availability under Hermes
  // varies by version and which would silently mis-count if it were missing.
  const memoBytes = utf8Length(memo);

  return (
    <>
      {/*
        Gasless, stated up front — and stated from `gasCopy`, not typed here, so this
        screen cannot drift from what the relayer actually does.

        The affirmation is violet, not green. Green is a health colour, and BRAND.md §2
        allows health colours "only when they carry meaning"; "we pay the gas" is a
        product fact, not a position state. Violet is the brand accent and, per §2, the
        one saturated colour a default screen is allowed.
      */}
      <View
        style={styles.gasBanner}
        accessible
        accessibilityLabel={`${gasCopy.sponsoredTitle}. ${gasCopy.sponsoredBody}`}
      >
        <Icon name="shield" size={16} color={brand.violet400} />
        <View style={styles.gasBannerBody}>
          <Txt variant="small">{gasCopy.sponsoredTitle}</Txt>
          <Txt variant="small" tone="muted" style={styles.gasBannerCaption}>
            {gasCopy.sponsoredBody}
          </Txt>
        </View>
      </View>

      <Card style={styles.panel}>
        <Label>To</Label>
        <View style={styles.recipientRow}>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="@handle or 0x address"
            placeholderTextColor="#6B6B75"
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
            <Icon name="scan" size={18} color="#FAFAFA" />
          </Pressable>
        </View>

        {resolving ? (
          <Txt variant="small" tone="muted" style={styles.resolveNote}>
            Resolving handle…
          </Txt>
        ) : resolved ? (
          <View style={styles.resolved} accessible accessibilityLabel={`${resolved.handle} resolves to ${resolved.address}`}>
            <Icon name="check" size={14} color={semantic.success} />
            <Num size="numericSm" tone="muted">
              {shortAddress(resolved.address)}
            </Num>
          </View>
        ) : to.trim().startsWith('@') && to.trim().length > 1 ? (
          <Txt variant="small" style={[styles.resolveNote, { color: semantic.danger }]}>
            No such handle on this network.
          </Txt>
        ) : isAddress ? (
          <View style={styles.resolved}>
            <Icon name="check" size={14} color={semantic.success} />
            <Txt variant="small" tone="muted">
              Valid address
            </Txt>
          </View>
        ) : null}

        <View style={styles.divider} />

        <Label>Amount</Label>
        <View style={styles.amountRow}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor="#3F3F46"
            keyboardType="decimal-pad"
            style={styles.amountInput}
            accessibilityLabel="Amount in MUSD"
          />
          <Num size="numericSm" tone="musd">
            MUSD
          </Num>
        </View>

        <View style={styles.balanceRow}>
          <Txt variant="small" tone="muted">
            Available
          </Txt>
          <Pressable
            onPress={() => balances && setAmount(formatMusd(balances.musdWei, { unit: false }).replace(/,/g, ''))}
            accessibilityRole="button"
            accessibilityLabel="Use full balance"
            hitSlop={8}
          >
            {balances ? <Musd wei={balances.musdWei} size="numericSm" /> : null}
          </Pressable>
        </View>

        {overBalance ? (
          <Txt variant="small" style={[styles.resolveNote, { color: semantic.danger }]} accessibilityRole="alert">
            More than your MUSD balance.
          </Txt>
        ) : null}

        <View style={styles.divider} />

        <Label>Memo (optional)</Label>
        <TextInput
          value={memo}
          onChangeText={setMemo}
          placeholder="What is this for?"
          placeholderTextColor="#6B6B75"
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
        label={amountWei > 0n ? `Send ${formatMusd(amountWei)}` : 'Send'}
        onPress={() =>
          runner.run(
            { type: 'send', musdWei: amountWei, to: resolved?.address ?? to.trim(), memo },
            `Send ${formatMusd(amountWei)} to ${resolved?.handle ?? shortAddress(to.trim())}`,
          )
        }
        disabled={!canSend}
        badge={<Icon name="arrowUpRight" size={15} color="#FAFAFA" />}
        accessibilityHint="Requires Face ID, then waits for an on-chain receipt."
      />

      <TxSheet runner={runner} />
    </>
  );
}

function RequestPanel() {
  const address = useAppStore((s) => s.address);
  const handle = useAppStore((s) => s.handle);
  const [amount, setAmount] = useState('');
  const [copied, setCopied] = useState(false);

  const amountWei = parseMusd(amount);
  /**
   * The payload a scanner reads. An https URL rather than a `maren://` deep link, for
   * the same reason auth uses a universal link (R12): an https payload opens the real
   * app through a domain Apple verified, and degrades to a web page rather than to
   * nothing on a device without Maren installed.
   *
   * Built by the same module the scanner parses with, so the two cannot drift apart.
   */
  const payload = buildPaymentPayload(handle ?? address ?? '', amountWei > 0n ? amount : undefined);

  const copy = async () => {
    await Clipboard.setStringAsync(address ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1_800);
  };

  return (
    <>
      <Card style={styles.qrCard}>
        <View style={styles.qrFrame}>
          <QRCode
            value={payload}
            size={196}
            backgroundColor="#FAFAFA"
            color="#08080A"
            quietZone={12}
          />
        </View>

        <Txt variant="h3" style={styles.qrHandle}>
          {handle ?? 'Your account'}
        </Txt>
        {address ? (
          <Num size="numericSm" tone="muted" style={styles.qrAddress}>
            {shortAddress(address, 10, 8)}
          </Num>
        ) : null}

        <Txt variant="small" tone="muted" style={styles.qrCaption}>
          Anyone with Maren can scan this and pay you. They pay no BTC gas either — the
          relayer covers both sides.
        </Txt>
      </Card>

      <Card style={styles.panel}>
        <Label>Request a specific amount (optional)</Label>
        <View style={styles.amountRow}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor="#3F3F46"
            keyboardType="decimal-pad"
            style={styles.amountInput}
            accessibilityLabel="Requested amount in MUSD"
          />
          <Num size="numericSm" tone="musd">
            MUSD
          </Num>
        </View>
        {amountWei > 0n ? (
          <Txt variant="small" tone="muted" style={styles.memoCount}>
            The QR code above now carries {formatMusd(amountWei)}.
          </Txt>
        ) : null}
      </Card>

      <PillButton
        label={copied ? 'Address copied' : 'Copy my address'}
        variant="secondary"
        onPress={copy}
        accessibilityHint="Copies your full Mezo address to the clipboard."
      />
    </>
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
  gasBanner: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    // Violet hairline to match the violet mark; §2 keeps green for health states.
    borderColor: 'rgba(139,119,255,0.22)',
    marginBottom: space.lg,
  },
  gasBannerBody: { flex: 1 },
  gasBannerCaption: { marginTop: space.xs },
  panel: { marginBottom: space.xl },
  recipientRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  recipientInput: {
    flex: 1,
    minHeight: 44,
    color: '#FAFAFA',
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
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: space.sm },
  amountInput: {
    flex: 1,
    color: '#FAFAFA',
    fontFamily: fonts.monoMedium,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -0.8,
    minHeight: 52,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.md,
  },
  memoInput: {
    minHeight: 44,
    color: '#FAFAFA',
    fontFamily: fonts.regular,
    fontSize: 15,
    marginTop: space.sm,
  },
  memoCount: { marginTop: space.xs },
  qrCard: { alignItems: 'center', marginBottom: space.lg },
  qrFrame: {
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: '#FAFAFA',
  },
  qrHandle: { marginTop: space.xl },
  qrAddress: { marginTop: space.xs },
  qrCaption: { textAlign: 'center', marginTop: space.lg, maxWidth: 300 },
  pressed: { opacity: 0.6 },
});
