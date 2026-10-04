import { test, expect, type Page } from '@playwright/test';

/**
 * Behavioural proof of the page-side time limit (D-14/D-15/D-27, D-57) on
 * this page's own risky path: TypeScript + minify. That combination calls
 * `ts.transpileModule` the same way ts-to-js does, and 05-01 already
 * measured that call showing clear super-linear growth on a long chain of
 * string-literal `+` concatenation. Beautify (either language) and
 * JavaScript minify all measured well under 1 second on a 200KB realistic
 * input and never run in the worker, so they carry no time limit and are
 * not tested here.
 *
 * The limit is 10 seconds, not 1.5. On the 2026-10-03 nightly full run a
 * loaded runner pushed the 200KB realistic TypeScript minify in WebKit past
 * 1.5 seconds (about 0.65s on an idle machine, over 3s with the CPU
 * oversubscribed 2x), so a legitimate input hit the limit. 10 seconds is the
 * value the other formatter pages use, and they prove it the same way this
 * file does: the first worker is never given its job (as if the engine were
 * stuck inside one synchronous call) and the page clock is moved, instead of
 * feeding the engine a runaway input. A real runaway input is not a portable
 * way to cross a 10 second limit: the string-concatenation chain that ran
 * for 5 to 6 seconds in WebKit at 50,000 terms overflows WebKit's call stack
 * a little above that, before 10 seconds are up, while Node needed ~29s for
 * 60,000 terms.
 */
const rel = (path: string) => path.replace(/^\//, '');

declare global {
  interface Window {
    /** How many workers the page has built, and the position (in construction order) of each one it has terminated. */
    __FODT_JS_FORMATTER_WORKERS__?: number;
    __FODT_JS_FORMATTER_TERMINATED__?: number[];
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
    window.__FODT_JS_FORMATTER_WORKERS__ = 0;
    window.__FODT_JS_FORMATTER_TERMINATED__ = [];

    class WrappedWorker {
      inner: Worker;
      index: number;
      constructor(scriptURL: string | URL, workerOptions?: WorkerOptions) {
        this.inner = new OriginalWorker(scriptURL, workerOptions);
        this.index = window.__FODT_JS_FORMATTER_WORKERS__ ?? 0;
        window.__FODT_JS_FORMATTER_WORKERS__ = this.index + 1;
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
        window.__FODT_JS_FORMATTER_TERMINATED__!.push(this.index);
        this.inner.terminate();
      }
      dispatchEvent(event: Event): boolean {
        return this.inner.dispatchEvent(event);
      }
    }

    window.Worker = WrappedWorker as unknown as typeof Worker;
  });
}

const terminatedWorkers = (page: Page) => page.evaluate(() => window.__FODT_JS_FORMATTER_TERMINATED__ ?? []);
const workerCount = (page: Page) => page.evaluate(() => window.__FODT_JS_FORMATTER_WORKERS__ ?? 0);

/** Page time in milliseconds, read from the page itself so it follows the page clock. */
const pageNow = (page: Page) => page.evaluate(() => Date.now());

async function openTypeScriptMinify(page: Page): Promise<void> {
  await page.goto(rel('/tools/js-formatter'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
  await page.locator('input[type="radio"][name="language"][value="typescript"]').check();
  await page.locator('input[type="radio"][name="mode"][value="minify"]').check();
}

/**
 * Sets a textarea's value through the native setter and dispatches one `input`
 * event, instead of Playwright's `locator.fill()`, which types the value one
 * character (or clipboard chunk) at a time. `e2e/yaml-formatter.spec.ts`
 * documents `fill()` routinely taking over a minute on a ~200KB value; this
 * is the same fix for this file's own 200KB sample.
 */
async function setLargeValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/** Exported so terser's dead-code elimination keeps the declaration (and its name, since toplevel mangling is off). */
const SMALL_SOURCE = 'export function greet(name: string) { return name; }';

test('a TypeScript minify still running at 10 seconds is stopped with the time-limit message, not before, and the tab stays responsive', async ({
  page,
}) => {
  await installStuckFirstWorker(page);
  await page.clock.install();
  await openTypeScriptMinify(page);

  // Page time before the run is started: the run's own timer begins a little after this (the input debounce), so
  // no more than this much page time has passed on it at any moment measured from here.
  const before = await pageNow(page);
  await page.locator('#f-input').fill(SMALL_SOURCE);
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

test('after a TypeScript minify input is stopped, the next input runs normally in a new worker', async ({ page }) => {
  await installStuckFirstWorker(page);
  await page.clock.install();
  await openTypeScriptMinify(page);

  await page.locator('#f-input').fill(SMALL_SOURCE);
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  await page.clock.fastForward(12_000);
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 10 seconds', {
    timeout: 15_000,
  });

  await page.locator('#f-input').fill('export function hello(name: string) { return name; }');
  await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('function hello(', {
    timeout: 15_000,
  });
  expect(await workerCount(page)).toBeGreaterThanOrEqual(2);
});

test('a 200KB realistic TypeScript file minifies successfully through the worker', async ({ page }) => {
  await openTypeScriptMinify(page);

  let src = '';
  for (let i = 0; i < 2000; i++) {
    src += `interface I${i} { a: number; b: string; }\nexport function f${i}(x: I${i}): number { return x.a; }\n`;
  }
  await setLargeValue(page, '#f-input', src);
  // Longer than the 10s worker limit on purpose, so a regression that
  // brings the limit back down fails on the page's own time-limit message
  // (checked below) rather than racing the wait.
  await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('function f0(', {
    timeout: 15_000,
  });
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toHaveCount(0);
});
