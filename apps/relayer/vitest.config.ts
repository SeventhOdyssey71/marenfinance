import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Anvil-backed integration tests need headroom for a cold fork.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Every test builds its own config from an explicit env object; nothing may
    // leak in from the developer's shell. See test/setup.ts.
    setupFiles: ['./test/setup.ts'],
  },
});
