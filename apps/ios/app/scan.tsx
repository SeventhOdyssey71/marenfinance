import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../src/components/Icon';
import { PillButton } from '../src/components/PillButton';
import { Label, Txt } from '../src/components/Text';
import { base, radius, semantic, space } from '../src/design/tokens';
import { parsePaymentPayload } from '../src/lib/payment';

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

  const onScanned = ({ data }: { data: string }) => {
    if (handled.current) return;

    const parsed = parsePaymentPayload(data);
    if (!parsed) {
      setRejected('That code is not a Maren payment request.');
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
          <Icon name="scan" size={26} color="#FAFAFA" />
        </View>
        <Txt variant="h2" style={styles.permissionTitle}>
          Camera access
        </Txt>
        <Txt variant="body" tone="muted" style={styles.permissionBody}>
          Maren uses the camera only to read payment QR codes. Nothing is recorded, stored or
          uploaded — the frame is decoded on device and discarded.
        </Txt>
        <PillButton label="Allow camera" onPress={requestPermission} style={styles.permissionCta} />
        <PillButton label="Not now" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
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
        <Label style={styles.hint}>Point at a Maren payment code</Label>
      </View>

      {rejected ? (
        <View style={[styles.rejected, { bottom: insets.bottom + 120 }]} accessibilityRole="alert">
          <Icon name="alert" size={16} color={semantic.warning} />
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
        <Icon name="close" size={20} color="#FAFAFA" />
      </Pressable>
    </View>
  );
}

function Corner({ style }: { style: object }) {
  return <View style={[styles.corner, style]} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: base.bg },
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
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#FAFAFA',
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
  hint: { marginTop: space.xl, color: '#FAFAFA' },
  close: {
    position: 'absolute',
    right: space.xl,
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8,8,10,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejected: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
    flexDirection: 'row',
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: 'rgba(8,8,10,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: base.border,
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
