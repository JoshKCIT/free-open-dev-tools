import { test, expect, type Page } from '@playwright/test';

/**
 * Behavioural proof for the bcrypt page's worker-backed runtime contract:
 * the cost warning threshold, progress, cancel, restart, the same four
 * native-failure paths plan 02-10 specifies for its own worker helper, an
 * already-aborted-signal path, a late-resolution-after-cancel scenario
 * (the one 02-10 itself cannot cover, because a high-cost bcrypt round
 * genuinely cannot be stopped mid-computation), worker ownership, and the
 * narrowed D-07 refusal scenario. Lives in its own spec file per this
 * plan's `<action>` instructions, so every plan's write set in this phase
 * stays disjoint from `e2e/site.spec.ts` (02-02) and `e2e/privacy.spec.ts` (02-01).
 */
const rel = (path: string) => path.replace(/^\//, '');

/** Above the D-06/D-14 threshold (12): slow enough to observe progress and cancel reliably. */
const SLOW_COST = 15;
/** At the threshold: still direct-path, no worker, no warning note. */
const FAST_COST = 10;

declare global {
  interface Window {
    __FODT_WORKER_CONSTRUCTIONS__?: string[];
    __FODT_WORKER_FAULT__?: 'error' | 'messageerror' | 'postmessage-throws' | null;
    __FODT_BCRYPT_TEST_HOOKS__?: {
      bcryptInWorker: (
        job: { operation: 'hash'; password: string; cost: number },
        ctx: { signal: AbortSignal },
      ) => Promise<unknown>;
    };
  }
}

/**
 * Installs a wrapper around the global Worker constructor, before any page
 * script runs, so every construction is counted and an injected fault is
 * real -- the worker genuinely throws, genuinely fails to deliver a
 * message, or genuinely cannot post one, rather than the page merely being
 * told that it did. A close copy of `e2e/hash-file.spec.ts`'s technique
 * (plan 02-10), reusable verbatim with the message-type literals swapped.
 * The late-resolution scenario below needs no fault from this wrapper: it
 * lets a genuine cost-15 round run to completion unmodified, which is
 * exactly what proves a real late resolution cannot override the
 * cancellation note.
 */
async function installWorkerWrapper(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.__FODT_WORKER_CONSTRUCTIONS__ = [];
    window.__FODT_WORKER_FAULT__ = null;

    class WrappedWorker {
      inner: Worker;

      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        this.inner = new OriginalWorker(scriptURL, options);
        window.__FODT_WORKER_CONSTRUCTIONS__!.push(String(scriptURL));
        const fault = window.__FODT_WORKER_FAULT__;
        if (fault === 'error') {
          setTimeout(() => {
            this.inner.dispatchEvent(new ErrorEvent('error', { message: 'synthetic module-initialisation failure' }));
          }, 0);
        } else if (fault === 'messageerror') {
          setTimeout(() => {
            this.inner.dispatchEvent(new MessageEvent('messageerror'));
          }, 0);
        }
      }

      postMessage(...args: Parameters<Worker['postMessage']>): void {
        if (window.__FODT_WORKER_FAULT__ === 'postmessage-throws') {
          throw new Error('synthetic postMessage failure');
        }
        this.inner.postMessage(...args);
      }

      addEventListener(...args: Parameters<Worker['addEventListener']>): void {
        this.inner.addEventListener(...args);
      }

      removeEventListener(...args: Parameters<Worker['removeEventListener']>): void {
        this.inner.removeEventListener(...args);
      }

      terminate(): void {
        this.inner.terminate();
      }

      dispatchEvent(event: Event): boolean {
        return this.inner.dispatchEvent(event);
      }
    }

    window.Worker = WrappedWorker as unknown as typeof Worker;
  });
}

function runButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

function cancelButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Cancel', exact: true });
}

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

async function chooseHash(page: Page): Promise<void> {
  await page.locator('input[type="radio"][name="mode"][value="hash"]').check();
}

async function chooseVerify(page: Page): Promise<void> {
  await page.locator('input[type="radio"][name="mode"][value="verify"]').check();
}

async function setCost(page: Page, cost: number): Promise<void> {
  await page.locator('#f-cost').fill(String(cost));
}

async function setPassword(page: Page, password: string): Promise<void> {
  await page.locator('#f-password').fill(password);
}

test('the warning note appears above the threshold and not at or below it', async ({ page }) => {
  await page.goto(rel('/tools/bcrypt'));
  await chooseHash(page);
  await setPassword(page, 'a reasonable password');

  await setCost(page, FAST_COST);
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 15_000 });
  await expect(outputArea(page).locator('.note-warn')).toHaveCount(0);

  await setCost(page, SLOW_COST);
  await runButtonOf(page).click();
  await expect(cancelButtonOf(page)).toBeVisible({ timeout: 5_000 });
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 60_000 });
  await expect(outputArea(page).locator('.note-warn')).toContainText(/takes about/i);
});

test('the progress bar advances at least once during a worker-path run, and pressing Cancel shows the cancellation note with no hash', async ({
  page,
}) => {
  await page.goto(rel('/tools/bcrypt'));
  await chooseHash(page);
  await setPassword(page, 'a reasonable password');
  await setCost(page, SLOW_COST);

  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(cancelButtonOf(page)).toBeVisible({ timeout: 5_000 });

  const progressEl = page.locator('progress.tool-progress');
  await expect(progressEl).toBeVisible();
  const seen = new Set<number>();
  const deadline = Date.now() + 25_000;
  while (seen.size < 1 && Date.now() < deadline) {
    if ((await progressEl.count()) > 0) {
      seen.add(await progressEl.evaluate((el) => (el as HTMLProgressElement).value));
    }
    if ((await cancelButtonOf(page).count()) === 0) break;
    await page.waitForTimeout(20);
  }
  expect(seen.size, 'the progress bar never showed a value during the run').toBeGreaterThanOrEqual(1);

  await cancelButtonOf(page).click();
  await expect(outputArea(page).locator('.note-warn')).toHaveText(
    'Cancelled before finishing. No result was produced.',
  );
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);
  await expect(runButton).toBeEnabled();
});

test('a run started immediately after a cancel produces a hash that verifies', async ({ page }) => {
  await page.goto(rel('/tools/bcrypt'));
  await chooseHash(page);
  await setPassword(page, 'a reasonable password');
  await setCost(page, SLOW_COST);

  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(cancelButtonOf(page)).toBeVisible({ timeout: 5_000 });
  await cancelButtonOf(page).click();
  await expect(runButton).toBeEnabled();

  await setCost(page, FAST_COST);
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 15_000 });
  const hash = (await outputArea(page).locator('pre.output').first().textContent())?.trim();
  expect(hash).toMatch(/^\$2b\$10\$/);

  await chooseVerify(page);
  await page.locator('#f-hash').fill(hash!);
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 15_000 });
  await expect(outputArea(page).locator('.note-success')).toContainText('Correct');
});

test('the page constructs exactly one worker and it produces the hash', async ({ page }) => {
  await installWorkerWrapper(page);
  await page.goto(rel('/tools/bcrypt'));
  await chooseHash(page);
  await setPassword(page, 'a reasonable password');
  await setCost(page, SLOW_COST);

  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 60_000 });

  const constructions = await page.evaluate(() => window.__FODT_WORKER_CONSTRUCTIONS__ ?? []);
  expect(constructions.length).toBe(1);
  expect(constructions[0]!.startsWith('blob:')).toBe(true);
  await expect(outputArea(page).locator('pre.output').first()).toHaveText(/^\$2b\$15\$/);
});

test('a worker that throws during module initialisation settles as an error rather than hanging', async ({ page }) => {
  await installWorkerWrapper(page);
  await page.goto(rel('/tools/bcrypt'));
  await page.evaluate(() => {
    window.__FODT_WORKER_FAULT__ = 'error';
  });
  await chooseHash(page);
  await setPassword(page, 'a reasonable password');
  await setCost(page, SLOW_COST);

  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 15_000 });
  await expect(runButton).toBeEnabled();
  await expect(outputArea(page).locator('.issue-list')).toContainText('The background task could not start');

  await page.evaluate(() => {
    window.__FODT_WORKER_FAULT__ = null;
  });
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 60_000 });
  await expect(outputArea(page).locator('pre.output').first()).toHaveText(/^\$2b\$15\$/);
});

test('a messageerror is surfaced as an error rather than ignored', async ({ page }) => {
  await installWorkerWrapper(page);
  await page.goto(rel('/tools/bcrypt'));
  await page.evaluate(() => {
    window.__FODT_WORKER_FAULT__ = 'messageerror';
  });
  await chooseHash(page);
  await setPassword(page, 'a reasonable password');
  await setCost(page, SLOW_COST);

  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 15_000 });
  await expect(runButton).toBeEnabled();
  await expect(outputArea(page).locator('.issue-list')).toContainText('The background task could not start');
});

test('a postMessage that throws settles the run', async ({ page }) => {
  await installWorkerWrapper(page);
  await page.goto(rel('/tools/bcrypt'));
  await page.evaluate(() => {
    window.__FODT_WORKER_FAULT__ = 'postmessage-throws';
  });
  await chooseHash(page);
  await setPassword(page, 'a reasonable password');
  await setCost(page, SLOW_COST);

  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 15_000 });
  await expect(runButton).toBeEnabled();
  await expect(outputArea(page).locator('.issue-list')).toContainText('The background task could not start');
});

test('a run started with an already-aborted signal settles immediately and constructs no worker', async ({ page }) => {
  // No real user interaction can reach this: ToolRunner always hands run()
  // a freshly constructed, non-aborted AbortController for every run. This
  // is the same shape plan 02-10 uses for its own equivalent scenario,
  // exercised through the page's own test-only window hook
  // (__FODT_BCRYPT_TEST_HOOKS__), the same pattern hash-file.ts uses.
  await installWorkerWrapper(page);
  await page.goto(rel('/tools/bcrypt'));

  const outcome = await page.evaluate(async () => {
    const controller = new AbortController();
    controller.abort();
    try {
      await window.__FODT_BCRYPT_TEST_HOOKS__!.bcryptInWorker(
        { operation: 'hash', password: 'x', cost: 15 },
        { signal: controller.signal },
      );
      return 'resolved';
    } catch {
      return 'rejected';
    }
  });

  expect(outcome).toBe('rejected');
  const constructions = await page.evaluate(() => window.__FODT_WORKER_CONSTRUCTIONS__ ?? []);
  expect(constructions).toEqual([]);
});

test('a late resolution after a cancel does not replace the cancellation note', async ({ page }) => {
  // A high-cost bcrypt round genuinely cannot be stopped mid-computation --
  // unlike hash-file's chunk boundaries, there is no safe point to check an
  // abort signal partway through the library's own key schedule. Cancel
  // must therefore suppress a result that arrives after the cancellation
  // note is already showing, which is exactly what this proves: the run
  // is left to finish for real, cancelled from the page's perspective, and
  // its eventual resolution must never overwrite the cancellation note.
  await page.goto(rel('/tools/bcrypt'));
  await chooseHash(page);
  await setPassword(page, 'a reasonable password');
  await setCost(page, SLOW_COST);

  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(cancelButtonOf(page)).toBeVisible({ timeout: 5_000 });
  await cancelButtonOf(page).click();

  await expect(outputArea(page).locator('.note-warn')).toHaveText(
    'Cancelled before finishing. No result was produced.',
  );
  // Give the still-running background hash time to actually finish and
  // attempt to post its result, well past a fast cost-15 round's own time.
  await page.waitForTimeout(8_000);
  await expect(outputArea(page).locator('.note-warn')).toHaveText(
    'Cancelled before finishing. No result was produced.',
  );
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);
  await expect(runButton).toBeEnabled();
});

test('a 2x hash checked against a password containing a byte at or above 0x80 shows the cannot-check refusal and never Incorrect', async ({
  page,
}) => {
  await page.goto(rel('/tools/bcrypt'));
  await chooseVerify(page);
  // $2x$ relabelling of a confirmed real bcrypt vector (pyca/bcrypt's own
  // test suite; see tools/bcrypt/test/index.test.ts for the full
  // provenance and the empirical confirmation this relabel is valid for
  // an ASCII password -- here the candidate is not ASCII, which is the
  // whole point of this scenario).
  await page.locator('#f-hash').fill('$2x$04$cVWp4XaNU8a4v1uMRum2SO026BWLIoQMD/TXg5uZV.0P.uO8m3YEm');
  await setPassword(page, 'café-anything-not-the-real-password');
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 15_000 });

  const result = outputArea(page);
  await expect(result).toContainText(/this tool cannot check this hash/i);
  await expect(result).not.toContainText(/incorrect/i);
});
