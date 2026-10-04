import { test, expect, type Page } from '@playwright/test';

/**
 * Fix for `.planning/WINDOWS.md` id 14: the live data-convert page parsed a
 * YAML source on the main thread, and the installed yaml package's
 * duplicate-key check scans the whole mapping for every new key it
 * composes, so a large flat mapping's parse time grows quadratically with
 * its key count -- a large enough one could freeze the tab.
 * `apps/web/src/lib/run-data-convert-in-worker.ts` moves a YAML source's
 * parse into a worker and races it against the same 10 second time limit
 * `run-yaml-formatter-in-worker.ts` uses for the identical risk in
 * yaml-formatter. JSON and TOML sources are unaffected and still run on
 * the main thread.
 *
 * The limit is 10 seconds, not 1.5: the same yaml package and the same
 * duplicate-key check made the 2026-10-03 nightly full run fail when a loaded
 * runner pushed a realistic job past 1.5 seconds. Like
 * `e2e/yaml-formatter.spec.ts`, the limit is proved with a worker that is
 * never given its job (as if the engine were stuck inside one synchronous
 * call) and a page clock that is moved, not with a runaway input: a flat
 * mapping would need about 80,000 keys (an 880KB document; 6.8s at 40,000
 * keys, 34s at 80,000 in Node), which a faster runner could still finish
 * inside the limit.
 */
const rel = (path: string) => path.replace(/^\//, '');

declare global {
  interface Window {
    /** How many workers the page has built, and the position (in construction order) of each one it has terminated. */
    __FODT_DATA_CONVERT_WORKERS__?: number;
    __FODT_DATA_CONVERT_TERMINATED__?: number[];
  }
}

/**
 * Installs a wrapper around the global Worker constructor, before any page
 * script runs. The first worker built never receives its job (so the run
 * stays in flight like a stuck engine); every later worker behaves normally,
 * so the next run after a stop can be proven to work. Every construction is
 * counted and every terminate() call is recorded by the position of the
 * worker it ends.
 */
async function installStuckFirstWorker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.__FODT_DATA_CONVERT_WORKERS__ = 0;
    window.__FODT_DATA_CONVERT_TERMINATED__ = [];

    class WrappedWorker {
      inner: Worker;
      index: number;
      constructor(scriptURL: string | URL, workerOptions?: WorkerOptions) {
        this.inner = new OriginalWorker(scriptURL, workerOptions);
        this.index = window.__FODT_DATA_CONVERT_WORKERS__ ?? 0;
        window.__FODT_DATA_CONVERT_WORKERS__ = this.index + 1;
      }
      postMessage(...args: Parameters<Worker['postMessage']>): void {
        if (this.index === 0) return;
        this.inner.postMessage(...args);
      }
      addEventListener(...args: Parameters<Worker['addEventListener']>): void {
        this.inner.addEventListener(...args);
      }
      removeEventListener(...args: Parameters<Worker['removeEventListener']>): void {
        this.inner.removeEventListener(...args);
      }
      terminate(): void {
        window.__FODT_DATA_CONVERT_TERMINATED__!.push(this.index);
        this.inner.terminate();
      }
      dispatchEvent(event: Event): boolean {
        return this.inner.dispatchEvent(event);
      }
    }

    window.Worker = WrappedWorker as unknown as typeof Worker;
  });
}

const terminatedWorkers = (page: Page) => page.evaluate(() => window.__FODT_DATA_CONVERT_TERMINATED__ ?? []);
const workerCount = (page: Page) => page.evaluate(() => window.__FODT_DATA_CONVERT_WORKERS__ ?? 0);

/** Page time in milliseconds, read from the page itself so it follows the page clock. */
const pageNow = (page: Page) => page.evaluate(() => Date.now());

test('a YAML conversion still going at 10 seconds is stopped with the time-limit message, not before, and the tab stays responsive', async ({
  page,
}) => {
  await installStuckFirstWorker(page);
  await page.clock.install();
  await page.goto(rel('/tools/data-convert'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('#f-from').selectOption('yaml');
  await page.locator('#f-to').selectOption('json');

  // Page time before the run is started: the run's own timer begins a little after this (the input debounce), so
  // no more than this much page time has passed on it at any moment measured from here.
  const before = await pageNow(page);
  await page.locator('#f-input').fill('a: 1\n');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();

  // Real time, not page time: the run's debounce has fired and its limit timer exists before the clock moves.
  await page.waitForTimeout(800);

  // 8 seconds into a stuck run: still running, no stop message, and the stuck worker is not yet ended. A limit left
  // at 1.5 seconds would already have stopped it.
  await page.clock.fastForward(Math.max(0, before + 8_000 - (await pageNow(page))));
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect(page.locator('section[aria-label="Output"]')).not.toContainText('Stopped after');
  expect(await terminatedWorkers(page)).toEqual([]);

  // 9.9 seconds in, at the most: still running. A limit that fired at 9 seconds would already have stopped it.
  await page.clock.fastForward(Math.max(0, before + 9_900 - (await pageNow(page))));
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect(page.locator('section[aria-label="Output"]')).not.toContainText('Stopped after');
  expect(await terminatedWorkers(page)).toEqual([]);

  // 12 seconds in: stopped, with the plain message, and the timed-out worker has been terminated.
  await page.clock.fastForward(Math.max(0, before + 12_000 - (await pageNow(page))));
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 10 seconds', {
    timeout: 15_000,
  });
  expect(await page.locator('section[aria-label="Output"] pre.output').count()).toBe(0);
  expect(await terminatedWorkers(page)).toEqual([0]);

  // The tab answers a script call within a second.
  const answerStart = Date.now();
  await page.evaluate(() => 1 + 1);
  expect(Date.now() - answerStart).toBeLessThan(1_000);
});

test('after a YAML conversion is stopped, the next conversion runs normally in a new worker', async ({ page }) => {
  await installStuckFirstWorker(page);
  await page.clock.install();
  await page.goto(rel('/tools/data-convert'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('#f-from').selectOption('yaml');
  await page.locator('#f-to').selectOption('json');
  await page.locator('#f-input').fill('a: 1\n');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  await page.clock.fastForward(12_000);
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 10 seconds', {
    timeout: 15_000,
  });

  // A genuinely broken worker (the exact failure mode this test guards
  // against: a bundler setting once silently dropped a worker's startup
  // code in this repo, .planning/RETROSPECTIVE.md) would never resolve
  // normal input either -- it would sit on the same timer and show the
  // same stopped message again. A working worker resolves this quickly
  // with the correct output instead.
  await page.locator('#f-input').fill('name: Ada\n');
  await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('"name": "Ada"', {
    timeout: 15_000,
  });
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toHaveCount(0);
  expect(await workerCount(page)).toBeGreaterThanOrEqual(2);
});

test('a realistic nested YAML document converts normally, well under the time limit', async ({ page }) => {
  await page.goto(rel('/tools/data-convert'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('#f-from').selectOption('yaml');
  await page.locator('#f-to').selectOption('json');
  await page.locator('#f-input').fill('name: Ada\ntags:\n  - a\n  - b\n');

  await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('"name": "Ada"', {
    timeout: 10_000,
  });
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toHaveCount(0);
});
