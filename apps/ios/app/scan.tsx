import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../src/components/Icon';
import { PillButton } from '../src/components/PillButton';
import { Label, Txt } from '../src/components/Text';
import { base, cardShadow, radius, semanticText, space, text } from '../src/design/tokens';
import { parseClaimLink, parsePaymentPayload } from '../src/lib/payment';
import { stashClaimLink } from '../src/lib/claimHandoff';

/**
 * Scan to pay.
 *
 * Accepts two payload shapes and nothing else:
 *   https://maren.finance/pay?to=…&amount=…   — the code the Request screen produces
 *   a bare 0x address
 *
 * A QR code is untrusted input from a stranger, so parsing is strict and allowlisted by
 * host. Anything else is rejected with a visible reason rather than silently ignored —
 * a scanner that does nothing looks broken, and a user who thinks the scanner is broken
 * types the address by hand, which is worse.
 */
export default function Scan() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [rejected, setRejected] = useState<string | null>(null);
  const handled = useRef(false);

  /**
   * Light status bar for as long as this screen is focused, dark again the moment it is
   * not.
   *
   * Scoped to focus rather than to mount. `<StatusBar style="light" />` sets the style
   * when it mounts and does not put it back when it unmounts, so dismissing the scanner
   * left a white clock sitting on the next #F7F6FB page. The navigator's own
   * `statusBarStyle` option would restore it correctly, and it also raises inside Expo
   * Go, whose Info.plist sets `UIViewControllerBasedStatusBarAppearance` to NO — see the
   * note in app/_layout.tsx.
   */
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );

  const onScanned = ({ data }: { data: string }) => {
    if (handled.current) return;

    // A claimable-link QR (the one the Pay → Link tab shows) carries a bearer secret in its
    // fragment. It is handed to the claim screen IN MEMORY, never as a navigation param, so the
    // secret never ends up in anything URL-shaped. See lib/claimHandoff.
    const claim = parseClaimLink(data);
    if (claim) {
      handled.current = true;
      stashClaimLink(data);
      router.replace('/claim');
      return;
    }

    const parsed = parsePaymentPayload(data);
    if (!parsed) {
      setRejected('That code is not a Maren payment request or claim link.');
      return;
    }

    handled.current = true;
    router.replace({
      pathname: '/(tabs)/pay',
      params: { to: parsed.to, ...(parsed.amount ? { amount: parsed.amount } : {}) },
    });
  };

  if (!permission) {
    return <View style={styles.root} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.permission, { paddingTop: insets.top + space.xxl }]}>
        <View style={styles.permissionIcon}>
          <Icon name="scan" size={26} color={text.primary} />
        </View>
        <Txt variant="h2" style={styles.permissionTitle}>
          Camera access
        </Txt>
        <Txt variant="body" tone="muted" style={styles.permissionBody}>
          Maren uses the camera only to read payment QR codes. Nothing is recorded, stored or
          uploaded. The frame is decoded on device and discarded.
        </Txt>
        <PillButton label="Allow camera" onPress={requestPermission} style={styles.permissionCta} />
        <PillButton label="Not now" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={styles.cameraRoot}>
      {/* This screen's status bar is light rather than dark, because there is a camera
          feed behind the clock and not a #F7F6FB page. It is declared as a navigator
          option in app/_layout.tsx, not with a <StatusBar> element here: expo-status-bar
          sets the style on mount and does not put it back on unmount, so the light bar
          followed the user out of the scanner and onto the next light screen. */}
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onScanned}
      />

      {/* Reticle */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.reticle}>
          <Corner style={styles.tl} />
          <Corner style={styles.tr} />
          <Corner style={styles.bl} />
          <Corner style={styles.br} />
        </View>
        <View style={styles.hintPill}>
          <Label style={styles.hint}>Point at a Maren payment code</Label>
        </View>
      </View>

      {rejected ? (
        <View style={[styles.rejected, { bottom: insets.bottom + 120 }]} accessibilityRole="alert">
          <Icon name="alert" size={16} color={semanticText.warning} />
          <Txt variant="small" tone="muted" style={styles.rejectedText}>
            {rejected}
          </Txt>
        </View>
      ) : null}

      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Close scanner"
        style={[styles.close, { top: insets.top + space.md }]}
        hitSlop={10}
      >
        <Icon name="close" size={20} color={text.primary} />
      </Pressable>
    </View>
  );
}

function Corner({ style }: { style: object }) {
  return <View style={[styles.corner, style]} />;
}

const styles = StyleSheet.create({
  /** The permission screen is an ordinary Maren surface. */
  root: { flex: 1, backgroundColor: base.bg },
  /**
   * The live scanner is not. Behind the overlay is a camera feed, so the canvas under it
   * is near-black: it is what shows for the frame before the feed starts and if the
   * camera fails, and a white flash there would blind the reticle at exactly the moment
   * the user is trying to aim.
   */
  cameraRoot: { flex: 1, backgroundColor: '#0B0B0F' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: { width: 248, height: 248 },
  /**
   * The reticle stays white, and that is not an oversight in a light app: it is drawn
   * over a live camera feed, not over a Maren surface, so there is no theme behind it,
   * only whatever the lens is pointed at.
   *
   * White alone is not enough, though, and the light theme is what made that obvious.
   * The commonest thing a person points this at is a QR code on a white sheet of paper
   * or a bright phone screen — a white stroke on white, with nothing to separate them.
   * The drop shadow is the fix: it costs nothing against a dark scene and it is the only
   * reason the corners survive a bright one.
   */
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: base.onAccent,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
  },
  tl: { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 10 },
  tr: { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 10 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 10 },
  br: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomRightRadius: 10,
  },
  /**
   * Same problem as the corners, and a shadow will not save 12px tracked text. The hint
   * gets its own dark ground instead, so it reads at 13:1 whatever is behind it.
   */
  hintPill: {
    marginTop: space.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(11,11,15,0.62)',
  },
  hint: { color: base.onAccent },
  close: {
    position: 'absolute',
    right: space.xl,
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    // A white chip with a dark glyph, matching the header buttons on every other
    // screen. The old translucent-black chip was legible over the feed but it was the
    // only piece of the dark app left standing. The shadow is doing the same job it
    // does on the reticle: hold the edge when the scene behind it is bright.
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  /**
   * The rejected-code alert is a Maren surface, so it is opaque white: its body copy is
   * `text-muted`, and over a 90%-black panel that would have been 1.2:1 after the theme
   * move — a degraded state you cannot read is a degraded state you do not have.
   */
  rejected: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
    flexDirection: 'row',
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: base.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    ...cardShadow,
  },
  rejectedText: { flex: 1 },
  permission: { paddingHorizontal: space.xl, gap: space.md },
  permissionIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.card,
    backgroundColor: base.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  permissionTitle: { marginBottom: space.sm },
  permissionBody: { marginBottom: space.xl },
  permissionCta: { marginBottom: space.sm },
});
