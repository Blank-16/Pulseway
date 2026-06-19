import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name           : 'integration',
    include        : ['tests/integration/*.integration.test.ts', 'tests/integration/*.e2e.test.ts'],
    globalSetup    : [],
    testTimeout    : 30_000,
    hookTimeout    : 30_000,
    // Run integration tests sequentially — they share DB state via truncation
    pool           : 'forks',
    poolOptions    : { forks: { singleFork: true } },
    environment    : 'node',
  },
});
