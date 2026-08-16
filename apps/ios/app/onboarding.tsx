import { useRef, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../src/components/Icon';
import { PillButton } from '../src/components/PillButton';
import { Label, Txt } from '../src/components/Text';
import { base, brand, gradients, radius, semantic, space } from '../src/design/tokens';
import { gasCopy } from '../src/lib/copy';

const { width } = Dimensions.get('window');

/**
 * Onboarding — three panels stating the product plainly, then wallet setup.
 *
 * BRAND.md §1 sets the voice: "calm, precise, adult… No hype words, no 'revolutionary',
 * no rocket emoji." So each panel is a plain statement of a mechanism, and the third one
 * names the constraint that makes the second true — the relayer pays BTC gas, which is
 * why the user does not need to keep a BTC balance to spend.
 *
 * It says "does not need to keep a balance", not "never needs BTC". The deposit is
 * payable and cannot be relayed, so the first transaction is the user's own. The panel
 * copy lives in `gasCopy` precisely so that caveat travels with the claim.
 *
 * The risk panel is not buried in a legal screen. ARCHITECTURE.md §3.4 requires the
 * pooled-trove risk statement to appear in the UI, so it appears before setup, not after.
 */

interface Panel {
  kicker: string;
  title: string;
  body: string;
  icon: IconName;
  accent: string;
}

const PANELS: Panel[] = [
  {
    kicker: 'One',
    title: 'Deposit Bitcoin',
    body: 'Your BTC becomes collateral on Mezo. It stays yours, it stays Bitcoin, and you keep every satoshi of the upside. Nothing is sold.',
    icon: 'vault',
    // BTC orange is permitted here: the panel is about a BTC-denominated position.
    accent: semantic.btc,
  },
  {
    kicker: 'Two',
    title: 'Draw MUSD',
    body: 'Borrow dollars against your Bitcoin at 1.00% APR, fixed for the life of the loan. Maren targets a 250% collateral ratio and refuses to let you cross 180%.',
    icon: 'earn',
    accent: semantic.musd,
  },
  {
    kicker: 'Three',
    title: gasCopy.onboardingTitle,
    body: gasCopy.onboardingBody,
    icon: 'send',
    accent: brand.violet400,
  },
];

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== page) setPage(next);
  };

  const isLast = page === PANELS.length - 1;

  const advance = () => {
    if (isLast) {
      router.push('/wallet-setup');
      return;
    }
    scroller.current?.scrollTo({ x: (page + 1) * width, animated: true });
  };

  return (
    <View style={styles.root}>
      {/* BRAND.md §5: no shader above the fold on iOS — a static gradient instead. */}
      <LinearGradient
        colors={gradients.ctaBand}
        locations={[0, 0.5, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.wash}
        pointerEvents="none"
      />

      <View style={[styles.header, { paddingTop: insets.top + space.lg }]}>
        <Txt variant="h3" style={styles.wordmark}>
          Maren
        </Txt>
        <Label>Bitcoin-backed account</Label>
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.pager}
      >
        {PANELS.map((panel, i) => (
          <View key={panel.title} style={[styles.panel, { width }]}>
            <View style={[styles.iconWell, { borderColor: `${panel.accent}44` }]}>
              <Icon name={panel.icon} size={26} color={panel.accent} />
            </View>

            <Label style={styles.kicker}>{panel.kicker} of three</Label>
            <Txt variant="h1" style={styles.title}>
              {panel.title}
            </Txt>
            <Txt variant="body" tone="muted" style={styles.body}>
              {panel.body}
            </Txt>

            {i === PANELS.length - 1 ? (
              /**
               * ARCHITECTURE.md §3.4 and SECURITY-LESSONS.md: the pooled-trove risk
               * statement must appear in the UI. Stated before setup, not after.
               */
              <View style={styles.riskNote}>
                {/* `muted`, not `subtle`: this is the risk disclosure, and #6B6B75 on
                    #0C0C0F falls under 4.5:1. Risk copy is never the dimmest text. */}
                <Txt variant="small" tone="muted">
                  Small positions share one trove. Your collateral is segregated in accounting, not
                  in custody. A drawdown faster than the keeper can respond could socialise losses.
                  Above 0.079 BTC, Maren opens you a direct trove instead, which carries no pooling
                  risk.
                </Txt>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.xl }]}>
        <View style={styles.dots} accessibilityElementsHidden>
          {PANELS.map((p, i) => (
            <View key={p.title} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>

        <PillButton
          label={isLast ? 'Set up your account' : 'Continue'}
          onPress={advance}
          badge={<Icon name="arrowRight" size={16} color="#FAFAFA" />}
          accessibilityHint={
            isLast
              ? 'Opens wallet setup, where you create or import a key.'
              : `Shows panel ${page + 2} of ${PANELS.length}.`
          }
        />

        <PillButton
          label="I already have a Maren key"
          variant="ghost"
          onPress={() => router.push('/wallet-setup/import')}
          style={styles.secondaryAction}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: base.bg },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 460 },
  header: { paddingHorizontal: space.xl, gap: space.xs },
  wordmark: { letterSpacing: -0.4 },
  pager: { flex: 1 },
  panel: {
    paddingHorizontal: space.xl,
    paddingBottom: space.xxl,
    // Centred rather than top-aligned: the three panels differ in length, and
    // top-aligning left a large dead gap under the short ones that read as a mistake
    // rather than as BRAND.md §4's deliberate whitespace.
    justifyContent: 'center',
  },
  iconWell: {
    width: 56,
    height: 56,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: base.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xl,
  },
  kicker: { marginBottom: space.md },
  title: { marginBottom: space.lg },
  body: { maxWidth: 380 },
  riskNote: {
    marginTop: space.xl,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: base.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
  },
  footer: { paddingHorizontal: space.xl, gap: space.md },
  dots: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  dotActive: { backgroundColor: brand.violet500, width: 20 },
  secondaryAction: { marginTop: -space.xs },
});
