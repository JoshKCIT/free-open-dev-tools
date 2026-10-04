import { test, expect, type Page } from '@playwright/test';

/**
 * Behavioural proof of the page-side time limit added by the orchestrator
 * amendment (2026-09-25, D-14/D-15/D-27, D-57): the installed yaml 2.9.1
 * checks duplicate mapping keys by scanning the whole mapping for every new
 * key it composes, so a flat mapping's parse time grows quadratically with
 * its key count. Measured directly against the installed package (see
 * apps/web/src/lib/run-yaml-formatter-in-worker.ts's own comment): about
 * 1.1s at 15,000 keys and 1.75s at 20,000. A run that is still going when
 * the limit arrives is stopped with a plain message instead of freezing the
 * tab, and the page keeps working normally afterwards.
 *
 * The limit is 10 seconds, not 1.5. The realistic document below parses in
 * about 0.3s in WebKit on an idle machine, but with the CPU oversubscribed 2x
 * it crossed 1.5s in 1 of 5 runs (the same load made the JavaScript
 * formatter's own 200KB TypeScript minify fail the 2026-10-03 nightly full
 * run in WebKit). 10 seconds is the value the other formatter pages use, and
 * they prove it the same way this file does: the first worker is never given
 * its job (as if the engine were stuck inside one synchronous call) and the
 * page clock is moved, instead of feeding the engine a runaway input. The
 * runaway input would have to be about 80,000 keys (an 880KB document; parse
 * time grows with the square of the key count: 6.8s at 40,000 keys, 16s at
 * 60,000, 34s at 80,000 in Node), which a faster runner could still finish
 * inside the limit.
 */
const rel = (path: string) => path.replace(/^\//, '');

declare global {
  interface Window {
    /** How many workers the page has built, and the position (in construction order) of each one it has terminated. */
    __FODT_YAML_FORMATTER_WORKERS__?: number;
    __FODT_YAML_FORMATTER_TERMINATED__?: number[];
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
    window.__FODT_YAML_FORMATTER_WORKERS__ = 0;
    window.__FODT_YAML_FORMATTER_TERMINATED__ = [];

    class WrappedWorker {
      inner: Worker;
      index: number;
      constructor(scriptURL: string | URL, workerOptions?: WorkerOptions) {
        this.inner = new OriginalWorker(scriptURL, workerOptions);
        this.index = window.__FODT_YAML_FORMATTER_WORKERS__ ?? 0;
        window.__FODT_YAML_FORMATTER_WORKERS__ = this.index + 1;
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
        window.__FODT_YAML_FORMATTER_TERMINATED__!.push(this.index);
        this.inner.terminate();
      }
      dispatchEvent(event: Event): boolean {
        return this.inner.dispatchEvent(event);
      }
    }

    window.Worker = WrappedWorker as unknown as typeof Worker;
  });
}

const terminatedWorkers = (page: Page) => page.evaluate(() => window.__FODT_YAML_FORMATTER_TERMINATED__ ?? []);
const workerCount = (page: Page) => page.evaluate(() => window.__FODT_YAML_FORMATTER_WORKERS__ ?? 0);

/** Page time in milliseconds, read from the page itself so it follows the page clock. */
const pageNow = (page: Page) => page.evaluate(() => Date.now());

/**
 * Sets a textarea's value directly through its native setter and dispatches
 * one `input` event, instead of Playwright's own `fill()`.
 *
 * Measured this session: `locator.fill()` on a ~250KB value routinely
 * exceeds a minute in this sandboxed browser environment (confirmed on an
 * unrelated page with no worker of its own, so the slowdown is Playwright's
 * own fill-then-verify implementation for a large value here, not this
 * tool's worker or its parsing). Setting the value directly and firing one
 * `input` event -- exactly what a real paste does -- completes in well
 * under a second for the same text and drives this page's own onChange
 * handler identically.
 */
async function setLargeValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/** A realistic 200KB-scale nested document: the quadratic cost is per-mapping, not per-document, so this stays far under the limit. */
function realisticSource(): string {
  const lines: string[] = [];
  for (let i = 0; i < 1200; i++) {
    lines.push(`item${i}:`);
    lines.push(`  name: Item ${i}`);
    lines.push(`  value: ${i}`);
    lines.push(`  active: true`);
  }
  return lines.join('\n') + '\n';
}

test('a run still going at 10 seconds is stopped with the time-limit message, not before, and the tab stays responsive', async ({
  page,
}) => {
  await installStuckFirstWorker(page);
  await page.clock.install();
  await page.goto(rel('/tools/yaml-formatter'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

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

test('after a run is stopped the next input runs normally in a new worker', async ({ page }) => {
  await installStuckFirstWorker(page);
  await page.clock.install();
  await page.goto(rel('/tools/yaml-formatter'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('#f-input').fill('a: 1\n');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  await page.clock.fastForward(12_000);
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 10 seconds', {
    timeout: 15_000,
  });

  await page.locator('#f-input').fill('b: 2\n');
  await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('b: 2', {
    timeout: 15_000,
  });
  expect(await workerCount(page)).toBeGreaterThanOrEqual(2);
});

test('a 200KB-scale realistic nested document parses successfully through the worker', async ({ page }) => {
  await page.goto(rel('/tools/yaml-formatter'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await setLargeValue(page, '#f-input', realisticSource());
  // Longer than the 10s worker limit on purpose, so a regression that
  // brings the limit back down fails on the page's own time-limit message
  // (checked below) rather than racing the wait.
  await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('item0', {
    timeout: 15_000,
  });
  // Realistic-sized input must not hit the pathological-input time limit.
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toHaveCount(0);
});
