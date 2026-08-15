import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Pin the trace root to the monorepo root so Next does not walk up and pick a
// stray lockfile from a parent directory.
const monorepoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: monorepoRoot,
  // @maren/sdk ships TypeScript source rather than a build step, so Next has to compile
  // it the same way it compiles the app. It is the one place the chain constants live,
  // and a duplicate compiled copy is exactly how those drift.
  transpilePackages: ['@maren/sdk'],
  experimental: {
    optimizePackageImports: ['@paper-design/shaders-react'],
  },
  webpack: (config) => {
    /**
     * `wagmi/connectors` is a single barrel with no subpath exports, so importing
     * `injected` and `walletConnect` also drags in the Base Account connector →
     * `@base-org/account` → `@coinbase/cdp-sdk` → a family of optional `@x402/*`
     * peers nobody in this app installs. Webpack resolves those eagerly and the
     * build fails on modules no code path in Maren can reach.
     *
     * Cutting the subtree at its root is honest about what is happening: Maren
     * offers exactly two connectors and Base Account is not one of them. If it ever
     * becomes one, install `@base-org/account`'s optional peers and delete this.
     */
    config.resolve.alias = {
      ...config.resolve.alias,
      '@base-org/account': false,
      /**
       * The same shape of problem, from two more optional dependencies that only
       * exist for environments Maren is not:
       *
       * - `@react-native-async-storage/async-storage` — MetaMask's SDK reaches for it
       *   to persist a session in React Native. In a browser it falls back to
       *   localStorage, so the import is unreachable here.
       * - `pino-pretty` — WalletConnect's logger loads it only when pretty-printing
       *   is switched on, which it never is in the browser bundle.
       *
       * Both resolve eagerly through webpack and each printed a multi-screen
       * "Module not found" trace on every single compile, which buried real errors
       * and made `next dev` slow and unreadable. Aliasing them to false is the
       * accurate statement: these code paths do not exist in this app.
       */
      '@react-native-async-storage/async-storage': false,
      'pino-pretty': false,
    };
    return config;
  },
  // Turbopack resolves independently of the webpack config above, so the same three
  // optional dependencies have to be stubbed for `next dev` as well or the traces
  // come straight back.
  turbopack: {
    resolveAlias: {
      '@base-org/account': { browser: './src/lib/empty-module.ts' },
      '@react-native-async-storage/async-storage': { browser: './src/lib/empty-module.ts' },
      'pino-pretty': { browser: './src/lib/empty-module.ts' },
    },
  },
};

export default nextConfig;
