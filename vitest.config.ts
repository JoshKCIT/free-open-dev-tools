import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

// Vitest's default is one worker fewer than the processor count. On a machine with many cores that starves the heaviest
// tests (a 30 MiB font conversion, a 200 MiB inflate) of time and the run ends with a worker message timeout, so the
// count is capped at 12. On a machine with 13 cores or fewer, the cap changes nothing.
const maxWorkers = Math.min(12, Math.max(availableParallelism() - 1, 1));

export default defineConfig({
  test: {
    include: ['tools/*/test/**/*.test.ts', 'scripts/test/**/*.test.mjs', 'apps/web/test/**/*.test.{ts,tsx}'],
    environment: 'node',
    reporters: ['default'],
    maxWorkers,
    coverage: {
      provider: 'v8',
      include: ['tools/*/src/**/*.ts'],
      reporter: ['text-summary', 'json-summary', 'lcov'],
    },
  },
});
