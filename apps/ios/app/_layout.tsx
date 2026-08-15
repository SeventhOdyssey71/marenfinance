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
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              // BRAND.md §2: there is no light mode in the product UI.
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
            <Stack.Screen
              name="scan"
              options={{ presentation: 'fullScreenModal', animation: 'fade' }}
            />
          </Stack>
        </View>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: base.bg },
});
