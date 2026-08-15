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
  experimental: {
    optimizePackageImports: ['@paper-design/shaders-react'],
  },
};

export default nextConfig;
