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
    config.resolve.alias = { ...config.resolve.alias, '@base-org/account': false };
    return config;
  },
};

export default nextConfig;
