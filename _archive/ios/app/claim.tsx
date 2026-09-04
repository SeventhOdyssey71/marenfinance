import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { formatMusd } from '@maren/sdk';

import { Musd } from '../src/components/Money';
import { Card } from '../src/components/Card';
import { Icon } from '../src/components/Icon';
import { PillButton } from '../src/components/PillButton';
import { Screen } from '../src/components/Screen';
import { SuccessCover } from '../src/components/SuccessCover';
import { Label, Num, Txt } from '../src/components/Text';
import { TxSheet, useTxRunner } from '../src/components/TxSheet';
import { base, brand, hit, radius, semanticText, space, text } from '../src/design/tokens';
import { fonts } from '../src/design/type';
import { readLink } from '../src/data/source';
import type { LinkState } from '../src/data/types';
import { takeClaimLink } from '../src/lib/claimHandoff';
import { parseClaimLink, type ClaimLink } from '../src/lib/payment';
import { useAppStore } from '../src/state/store';

/**
 * Claim a claimable link — collect escrowed MUSD into your own wallet.
 *
 * The other half of the link created on the Pay → Link tab. A recipient opens a link
 * (pasted here, or scanned, which hands off through `claimHandoff`), and this screen reads
 * the link's on-chain state through `links(linkId)` FIRST, so what is really being collected
 * — and whether it is still collectable — is shown before anything is signed.
 *
 * THE SECRET IS A BEARER SIGNING KEY. It rides in the URL fragment, is parsed out here, and
 * is held in a ref rather than React state so it never lands in a rendered value; it is
 * dropped the moment the claim confirms. It is never logged and never leaves the device — the
 * `link-claim` action signs the claimer's OWN address with it locally (see chain/actions.ts),
 * so even an observer who saw the link cannot redirect the funds.
 *
 * claimLink IS on the relayer's allowlist, so the claim is gasless: a brand-new recipient
 * holding no BTC can still collect. That is the whole point of a claimable link.
 */
export default function Claim() {
  const router = useRouter();
  const address = useAppStore((s) => s.address);

  // The parsed link — id AND secret — held out of React state so the bearer key is never in
  // a rendered value or a snapshot. Cleared on success and on reset.
  const linkRef = useRef<ClaimLink | null>(null);

  // A scanned link is handed off in memory rather than as a route param (see lib/claimHandoff),
  // so the one-slot handoff is consumed here at first render via a lazy initialiser — never
  // with a synchronous setState in an effect. A plain paste-in visit starts empty.
  const [raw, setRaw] = useState(() => takeClaimLink() ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [claimed, setClaimed] = useState(false);

  const runner = useTxRunner(() => {
    // A delivered claim: drop the secret and show the success cover.
    linkRef.current = null;
    setClaimed(true);
  });

  const open = async (candidate: string) => {
    setError(null);
    const parsed = parseClaimLink(candidate);
    if (!parsed) {
      setError('That is not a Maren claim link. Paste the full link, including the part after #.');
      setPreview(null);
      linkRef.current = null;
      return;
    }

    setLoading(true);
    try {
      const state = await readLink(parsed.linkId);
      linkRef.current = parsed;
      setPreview({ linkId: parsed.linkId, kind: classify(state), amountWei: state.amountWei });
    } catch {
      setError('This link could not be read on Mezo. Check your connection and try again.');
      setPreview(null);
      linkRef.current = null;
    } finally {
      setLoading(false);
    }
  };

  // If a scanned link populated `raw` at mount, read its on-chain state straight away — the
  // recipient scanned to collect, not to look at a filled-in field. Runs once; a paste-in
  // visit leaves `raw` empty and does nothing. Deferred into a callback so the read's own
  // setState fires there rather than synchronously during commit (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (raw === '') return;
    const id = setTimeout(() => void open(raw), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const claim = () => {
    const link = linkRef.current;
    if (!link || !preview) return;
    runner.run(
      { type: 'link-claim', linkId: link.linkId, secret: link.secret },
      `Claim ${formatMusd(preview.amountWei)}`,
    );
  };

  const reset = () => {
    linkRef.current = null;
    setClaimed(false);
    setPreview(null);
    setError(null);
    setRaw('');
    if (router.canGoBack()) router.back();
  };

  if (claimed && preview) {
    return (
      <SuccessCover
        visible
        amountWei={preview.amountWei}
        unit="musd"
        headline="Claimed"
        subline="is now in your Maren wallet."
        onDone={reset}
      />
    );
  }

  return (
    <Screen bottomInset={space.xxl}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [styles.closeDisc, pressed && styles.pressed]}
          hitSlop={8}
        >
          <Icon name="close" size={18} color={text.primary} />
        </Pressable>
        <Label>Claim a link</Label>
        <View style={styles.closeDiscSpacer} />
      </View>

      <View style={styles.hero}>
        <View style={styles.heroMark}>
          <Icon name="wallet" size={22} color={brand.violet400} />
        </View>
        <Txt variant="h2" style={styles.title}>
          Collect your MUSD
        </Txt>
        <Txt variant="small" tone="muted" style={styles.subtitle}>
          Paste a Maren claim link. You will see what it holds before you collect it, and you pay no
          BTC gas to do so.
        </Txt>
      </View>

      <Card style={styles.panel}>
        <Label>Claim link</Label>
        <TextInput
          value={raw}
          onChangeText={(next) => {
            setRaw(next);
            setPreview(null);
            setError(null);
            linkRef.current = null;
          }}
          placeholder="https://maren.finance/claim?id=…#…"
          placeholderTextColor={text.muted}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={styles.input}
          accessibilityLabel="Claim link"
          accessibilityHint="Paste the full Maren claim link, including the secret after the # symbol."
        />
        <Pressable
          onPress={async () => {
            const clip = await Clipboard.getStringAsync();
            if (clip) {
              setRaw(clip);
              void open(clip);
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Paste from clipboard"
          style={({ pressed }) => [styles.pastePill, pressed && styles.pressed]}
          hitSlop={8}
        >
          <Icon name="copy" size={14} color={text.primary} />
          <Txt variant="small">Paste from clipboard</Txt>
        </Pressable>
      </Card>

      {error ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Icon name="alert" size={16} color={semanticText.danger} />
          <Txt variant="small" style={[styles.noticeText, { color: semanticText.danger }]}>
            {error}
          </Txt>
        </View>
      ) : null}

      {!preview ? (
        <PillButton
          label={loading ? 'Reading link…' : 'Open link'}
          onPress={() => open(raw)}
          loading={loading}
          disabled={raw.trim() === ''}
          badge={<Icon name="arrowRight" size={15} color={base.onAccent} />}
          accessibilityHint="Reads the link’s state on Mezo before you collect it."
        />
      ) : (
        <PreviewCard
          preview={preview}
          hasWallet={address !== null}
          onClaim={claim}
          onWallet={() => router.push('/wallet-setup')}
        />
      )}

      <TxSheet runner={runner} />
    </Screen>
  );
}

/** What the link is, once its on-chain state has been read. */
type PreviewKind = 'claimable' | 'claimed' | 'reclaimed' | 'expired' | 'not-found';

interface Preview {
  linkId: bigint;
  kind: PreviewKind;
  amountWei: bigint;
}

/**
 * Reduce the raw on-chain state to the one thing the screen needs to say. Order matters:
 * a settled link is settled whether or not it has also expired, and "no such link" is a
 * different sentence from "an empty link", so the zero-creator case is caught first.
 */
function classify(state: LinkState): PreviewKind {
  const ZERO = '0x0000000000000000000000000000000000000000';
  if (state.creator.toLowerCase() === ZERO) return 'not-found';
  if (state.claimed) return 'claimed';
  if (state.reclaimed) return 'reclaimed';
  if (nowSeconds() > state.expiry) return 'expired';
  return 'claimable';
}

const DEAD_COPY: Record<Exclude<PreviewKind, 'claimable'>, string> = {
  'not-found': 'No link with this id exists on this network. Check you copied the whole link.',
  claimed: 'This link has already been claimed. There is nothing left to collect.',
  reclaimed: 'The sender has reclaimed this link, so the MUSD has gone back to them.',
  expired: 'This link has expired. Only its sender can reclaim it now.',
};

function PreviewCard({
  preview,
  hasWallet,
  onClaim,
  onWallet,
}: {
  preview: Preview;
  hasWallet: boolean;
  onClaim: () => void;
  onWallet: () => void;
}) {
  if (preview.kind !== 'claimable') {
    return (
      <View style={styles.reviewStack}>
        <Card style={styles.deadCard}>
          <View style={styles.deadHead}>
            <Icon name="lock" size={16} color={semanticText.warning} />
            <Label>Not claimable</Label>
          </View>
          <Txt variant="small" tone="muted">
            {DEAD_COPY[preview.kind]}
          </Txt>
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.reviewStack}>
      <Card style={styles.amountCard}>
        <Label>This link holds</Label>
        <View style={styles.amount}>
          <Musd wei={preview.amountWei} size="numericLg" dimFraction align="left" />
        </View>
        <Num size="numericSm" tone="muted">
          Link #{preview.linkId.toString()}
        </Num>
      </Card>

      <View
        style={styles.feeLine}
        accessible
        accessibilityLabel="Gasless. Maren’s relayer submits the claim and pays the BTC gas."
      >
        <Icon name="shield" size={15} color={brand.violet400} />
        <Txt variant="small" tone="muted" style={styles.feeText}>
          Gasless. You sign; Maren’s relayer submits it and pays the BTC gas.
        </Txt>
      </View>

      {hasWallet ? (
        <PillButton
          label={`Claim ${formatMusd(preview.amountWei)}`}
          onPress={onClaim}
          badge={<Icon name="arrowDown" size={15} color={base.onAccent} />}
          accessibilityHint="Requires Face ID, then waits for an on-chain receipt."
        />
      ) : (
        <>
          <Txt variant="small" tone="muted" style={styles.walletNote}>
            You need a Maren wallet to collect this. Setting one up takes a moment and costs
            nothing.
          </Txt>
          <PillButton
            label="Set up a wallet to claim"
            onPress={onWallet}
            badge={<Icon name="arrowRight" size={15} color={base.onAccent} />}
            accessibilityHint="Opens wallet setup. You can return to this link afterwards."
          />
        </>
      )}
    </View>
  );
}

/**
 * The clock, read in a module-level helper rather than in a component body — the same
 * render-purity discipline as `app/pay.tsx`. The value gates the claimable/expired
 * split, so a read at the moment of classification is exactly what is wanted.
 */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xl,
  },
  closeDisc: {
    width: hit.min,
    height: hit.min,
    borderRadius: radius.pill,
    backgroundColor: base.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeDiscSpacer: { width: hit.min, height: hit.min },
  pressed: { opacity: 0.6 },

  hero: { alignItems: 'center', marginBottom: space.xl, gap: space.sm },
  heroMark: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(250,0,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', maxWidth: 320 },

  panel: { marginBottom: space.lg, gap: space.sm },
  input: {
    minHeight: 64,
    marginTop: space.sm,
    color: text.primary,
    fontFamily: fonts.mono,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  pastePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.sm,
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    marginTop: space.sm,
  },

  notice: {
    flexDirection: 'row',
    gap: space.sm,
    padding: space.lg,
    marginBottom: space.lg,
    borderRadius: radius.card,
    backgroundColor: base.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
  },
  noticeText: { flex: 1 },

  reviewStack: { gap: space.md },
  amountCard: { gap: space.sm },
  amount: { marginTop: space.xs },
  deadCard: { gap: space.sm },
  deadHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },

  feeLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xs,
    marginBottom: space.sm,
  },
  feeText: { flex: 1 },
  walletNote: { paddingHorizontal: space.xs },
});
