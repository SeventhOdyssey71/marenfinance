// Must be the first import: viem's key generation reads crypto.getRandomValues, which
// Hermes does not provide. This shim installs it globally before anything else loads.
import 'react-native-get-random-values';

/**
 * A spec-compliant WHATWG URL, replacing React Native's built-in one.
 *
 * This is a security dependency, not a convenience. RN's `Libraries/Blob/URL.js` is a
 * regex approximation whose constructor never throws on malformed input and whose
 * `origin`/`protocol` getters return `''` rather than failing. Our R12 redirect
 * assertions and the QR payload allowlist are both built on exactly those getters, and
 * `src/security.test.ts` verifies them against Node's compliant implementation. Without
 * this polyfill the app would run different URL semantics than the tests prove, which
 * is the kind of gap that makes a green suite meaningless.
 */
import 'react-native-url-polyfill/auto';

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { base } from '../src/design/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden — not worth failing a launch over.
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      // A stale price is the one thing we must never paint, so nothing is served from
      // cache without a revalidation pass. See src/chain/price.ts.
      staleTime: 5_000,
    },
  },
});

export default function RootLayout() {
  /**
   * BRAND.md §3: Satoshi for UI, Geist Mono for all numerals.
   *
   * The files are bundled rather than fetched, so this cannot fail at runtime for
   * network reasons. If a face ever does fail to load, `useFonts` reports it and the
   * app falls through to the platform font — never to Inter, which §3 forbids by name.
   */
  const [fontsLoaded, fontError] = useFonts({
    'Satoshi-Regular': require('../assets/fonts/Satoshi-Regular.otf'),
    'Satoshi-Medium': require('../assets/fonts/Satoshi-Medium.otf'),
    'Satoshi-Bold': require('../assets/fonts/Satoshi-Bold.otf'),
    'Satoshi-Black': require('../assets/fonts/Satoshi-Black.otf'),
    'GeistMono-Regular': require('../assets/fonts/GeistMono-Regular.otf'),
    'GeistMono-Medium': require('../assets/fonts/GeistMono-Medium.otf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return <View style={styles.canvas} />;

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <View style={styles.canvas}>
          {/* Dark glyphs: the app canvas is #F7F6FB. The marketing site stays dark, but
              nothing in this bundle renders it. */}
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              // One canvas colour for the whole stack, so a push transition never
              // reveals a white gap behind the incoming screen.
              contentStyle: { backgroundColor: base.bg },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="wallet-setup"
              options={{ presentation: 'card', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen name="settings" options={{ presentation: 'card' }} />
            {/*
              The scanner needs a light status bar and every other screen needs a dark
              one, but that is NOT expressed here as a `statusBarStyle` screen option.
              react-native-screens implements that option by calling
              `-[UIViewController setNeedsStatusBarAppearanceUpdate]`, which raises
              unless the host app's Info.plist sets `UIViewControllerBasedStatusBarAppearance`
              to YES. Ours does — but Expo Go is a different binary and its own plist
              says NO, so the option red-screens the app in exactly the environment this
              project is verified in. scan.tsx scopes the style to focus instead.
            */}
            <Stack.Screen
              name="scan"
              options={{ presentation: 'fullScreenModal', animation: 'fade' }}
            />
            {/* Claiming a link is a self-contained errand a recipient arrives at from a
                pasted or scanned link, so it presents as a card over whatever they were on. */}
            <Stack.Screen name="claim" options={{ presentation: 'card' }} />
          </Stack>
        </View>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: base.bg },
});
