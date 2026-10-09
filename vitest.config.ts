import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

// Vitest's default for `vitest run` (what `pnpm test`, `pnpm run verify` and CI use) is one worker fewer than the
// processor count. On a machine with many cores that starves the heaviest tests (a 30 MiB font conversion, a 200 MiB
// inflate) of time and the run ends with a worker message timeout, so the count is capped at 12. For `vitest run` on a
// machine with 13 cores or fewer, the cap changes nothing. Watch mode (`pnpm test:watch`) defaults to half the cores
// instead, so this setting does change it on any machine with 3 or more cores (4 workers become 7 on 8 cores, and 16
// become 12 on 32 cores); watch mode is a local convenience that no check runs.
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
