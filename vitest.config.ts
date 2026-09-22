import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tools/*/test/**/*.test.ts', 'scripts/test/**/*.test.mjs'],
    environment: 'node',
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['tools/*/src/**/*.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
    },
  },
});
