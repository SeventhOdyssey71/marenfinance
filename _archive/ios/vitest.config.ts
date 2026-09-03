import { defineConfig } from 'vitest/config';

/**
 * The tests cover pure logic only — the R12 redirect assertions, the R15 receipt check,
 * the oracle staleness boundary and the QR allowlist. None of it needs a React Native
 * runtime, but two of the modules import Expo packages for their side-effecting paths,
 * so those are aliased to thin stubs rather than pulled in.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      'expo-crypto': new URL('./test/stubs/expo-crypto.ts', import.meta.url).pathname,
      'expo-web-browser': new URL('./test/stubs/expo-web-browser.ts', import.meta.url).pathname,
    },
  },
});
