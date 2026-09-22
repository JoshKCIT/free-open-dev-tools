import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests run against the production build, not the dev server.
 *
 * That matters for the privacy checks: a dev server injects its own websocket
 * and hot-reload requests, which would both mask a real leak and produce false
 * alarms. The build under test here is byte-for-byte what gets deployed.
 *
 * Set E2E_BASE_URL to point the same suite at a deployed site instead, which
 * is how a deployment is smoke-tested:
 *
 *   E2E_BASE_URL=https://joshkcit.github.io/free-open-dev-tools pnpm e2e
 */
const deployed = process.env.E2E_BASE_URL;
// baseURL must end in a slash, or resolving a relative path against it would
// drop the last segment of the deployment prefix.
const baseURL = (deployed ?? 'http://127.0.0.1:4173').replace(/\/?$/, '/');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/e2e.json' }]]
    : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],

  // Nothing to start when the target is already running somewhere else.
  ...(deployed
    ? {}
    : {
        webServer: {
          command: 'pnpm --filter @fodt/web run preview',
          url: 'http://127.0.0.1:4173',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
