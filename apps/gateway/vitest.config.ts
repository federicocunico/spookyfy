import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts', 'lib/**/*.test.ts'], testTimeout: 20000, pool: 'forks' },
});
