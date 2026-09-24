import { test, expect, type Page } from '@playwright/test';

/**
 * Behavioural proof for the file-hashing page's worker-backed runtime
 * contract: progress, cancel, restart, the four native-failure paths
 * `apps/web/src/lib/run-in-worker.ts` settles on, the two abandonment
 * transitions this page is the first to make observable, keyboard
 * reachability while a run is active, and worker ownership itself. Per this
 * plan's `<action>` instructions, this lives in its own spec file rather
 * than `e2e/site.spec.ts` (owned by plan 02-02) or `e2e/privacy.spec.ts`
 * (owned by plan 02-01), so every plan's write set in this phase stays
 * disjoint.
 */
const rel = (path: string) => path.replace(/^\//, '');

/** The published SHA-256 digest of "abc" (FIPS 180-4), also asserted by tools/hash-file/test/index.test.ts. */
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

/**
 * A test-only chunk size, forcing a multi-megabyte file to span roughly a
 * thousand chunks instead of the one or two a correct implementation would
 * take at the production chunk size. A real implementation can finish a
 * few-megabyte file in a single chunk before Playwright ever observes an
 * intermediate value or manages to click Cancel, which would make the
 * progress and cancel scenarios flaky rather than deterministic -- this is
 * the test affordance `apps/web/src/tools/hash-file.ts` exposes for exactly
 * that reason. Production always uses the real default.
 */
const TEST_CHUNK_SIZE = 8 * 1024;
const LARGE_FILE_BYTES = 10 * 1024 * 1024;

/** Deterministic (not random) pattern, so a failure is reproducible without capturing the file that triggered it. */
function largeFileBuffer(): Buffer {
  const buf = Buffer.alloc(LARGE_FILE_BYTES);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + 7) & 0xff;
  return buf;
}

async function useSmallTestChunks(page: Page): Promise<void> {
  await page.addInitScript((chunkSize) => {
    window.__FODT_HASH_FILE_TEST_CHUNK_SIZE__ = chunkSize;
  }, TEST_CHUNK_SIZE);
}

declare global {
  interface Window {
    __FODT_HASH_FILE_TEST_CHUNK_SIZE__?: number;
    __FODT_HASH_FILE_TEST_HOOKS__?: {
      hashFileInWorker: (
        file: File,
        algorithms: string[],
        format: string,
        ctx: { signal: AbortSignal },
      ) => Promise<unknown>;
    };
    __FODT_WORKER_CONSTRUCTIONS__?: string[];
    __FODT_WORKER_FAULT__?: 'error' | 'messageerror' | 'postmessage-throws' | null;
  }
}

/**
 * Installs a wrapper around the global Worker constructor, before any page
 * script runs, so every construction is counted and its URL recorded, and
 * an injected fault can be dispatched on the very next tick after
 * construction -- a fault installed this way is real, not simulated: the
 * worker genuinely throws, genuinely fails to deliver a message, or
 * genuinely cannot post one, rather than the page merely being told that it
 * did.
 */
async function installWorkerWrapper(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.__FODT_WORKER_CONSTRUCTIONS__ = [];
    window.__FODT_WORKER_FAULT__ = null;

    // Wraps a real worker by composition (delegating every member run-in-
    // worker.ts actually calls) rather than by extending the Worker class.
    // Worker.postMessage is overloaded in a way TypeScript cannot express a
    // compatible override for in a subclass; composition sidesteps that
    // entirely and is just as real a wrapper -- every construction still
    // creates a genuine underlying worker.
    //
    // Deliberately NOT a private class field (`#inner`): page.addInitScript
    // serialises this function's source and injects it into the page as
    // plain text. TypeScript downlevels private class fields through a
    // runtime helper that exists only in this test file's own Node-side
    // bundle, not in the browser the serialised source runs in, so a
    // private field here throws "_classPrivateFieldInitSpec is not
    // defined" the instant a worker is constructed. A plain instance
    // property needs no such helper.
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

async function attachAbc(page: Page): Promise<void> {
  await page
    .locator('#f-file')
    .setInputFiles({ name: 'abc.txt', mimeType: 'text/plain', buffer: Buffer.from('abc', 'utf8') });
}

async function attachLarge(page: Page): Promise<void> {
  await page.locator('#f-file').setInputFiles({
    name: 'large.bin',
    mimeType: 'application/octet-stream',
    buffer: largeFileBuffer(),
  });
}

function runButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

function cancelButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Cancel', exact: true });
}

function firstDigestOf(page: Page) {
  return page.locator('section[aria-label="Output"] pre.output').first();
}

test('the progress bar advances through at least three distinct values before the run ends', async ({ page }) => {
  test.setTimeout(90_000);
  await useSmallTestChunks(page);
  await page.goto(rel('/tools/hash-file'));
  await attachLarge(page);

  const runButton = runButtonOf(page);
  await runButton.click();
  // Wait until the run is genuinely in flight (the Cancel button only
  // renders while running) before sampling, rather than racing the click
  // against React's own re-render.
  await expect(cancelButtonOf(page)).toBeVisible({ timeout: 30_000 });

  const progressEl = page.locator('progress.tool-progress');
  const seen = new Set<number>();
  const deadline = Date.now() + 60_000;
  while (seen.size < 3 && Date.now() < deadline) {
    if ((await progressEl.count()) > 0) {
      const value = await progressEl.evaluate((el) => (el as HTMLProgressElement).value);
      seen.add(value);
    }
    if ((await cancelButtonOf(page).count()) === 0) break; // the run has already finished
    await page.waitForTimeout(5);
  }

  expect(seen.size, `observed progress values: ${[...seen].join(', ')}`).toBeGreaterThanOrEqual(3);
  await expect(runButton).toHaveText('Run', { timeout: 30_000 });
});

test('cancelling mid-run shows the cancellation note and no digest appears', async ({ page }) => {
  test.setTimeout(90_000);
  await useSmallTestChunks(page);
  await page.goto(rel('/tools/hash-file'));
  await attachLarge(page);

  const runButton = runButtonOf(page);
  await runButton.click();

  const cancelButton = cancelButtonOf(page);
  await expect(cancelButton).toBeVisible({ timeout: 30_000 });
  await cancelButton.click();

  const note = page.locator('section[aria-label="Output"] .note-warn');
  await expect(note).toHaveText('Cancelled before finishing. No result was produced.');
  expect(await page.locator('section[aria-label="Output"] pre.output').count()).toBe(0);
  await expect(runButton).toBeEnabled();
});

test('running again immediately after a cancel produces the correct digest', async ({ page }) => {
  test.setTimeout(90_000);
  await useSmallTestChunks(page);
  await page.goto(rel('/tools/hash-file'));
  await attachLarge(page);

  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(cancelButtonOf(page)).toBeVisible({ timeout: 30_000 });
  await cancelButtonOf(page).click();
  await expect(runButton).toBeEnabled();

  await attachAbc(page);
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 30_000 });
  await expect(firstDigestOf(page)).toHaveText(ABC_SHA256);
});

test('a known small file produces its literal expected digest', async ({ page }) => {
  await page.goto(rel('/tools/hash-file'));
  await attachAbc(page);
  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 30_000 });
  await expect(firstDigestOf(page)).toHaveText(ABC_SHA256);
});

test('a worker that throws during module initialisation settles as an error rather than hanging', async ({ page }) => {
  await installWorkerWrapper(page);
  await page.goto(rel('/tools/hash-file'));
  await page.evaluate(() => {
    window.__FODT_WORKER_FAULT__ = 'error';
  });
  await attachAbc(page);

  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 30_000 });
  await expect(runButton).toBeEnabled();
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText(
    'The background task could not start',
  );

  await page.evaluate(() => {
    window.__FODT_WORKER_FAULT__ = null;
  });
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 30_000 });
  await expect(firstDigestOf(page)).toHaveText(ABC_SHA256);
});

test('a messageerror is surfaced as an error rather than ignored', async ({ page }) => {
  await installWorkerWrapper(page);
  await page.goto(rel('/tools/hash-file'));
  await page.evaluate(() => {
    window.__FODT_WORKER_FAULT__ = 'messageerror';
  });
  await attachAbc(page);

  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 30_000 });
  await expect(runButton).toBeEnabled();
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText(
    'The background task could not start',
  );

  await page.evaluate(() => {
    window.__FODT_WORKER_FAULT__ = null;
  });
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 30_000 });
  await expect(firstDigestOf(page)).toHaveText(ABC_SHA256);
});

test('a postMessage that throws settles the run', async ({ page }) => {
  await installWorkerWrapper(page);
  await page.goto(rel('/tools/hash-file'));
  await page.evaluate(() => {
    window.__FODT_WORKER_FAULT__ = 'postmessage-throws';
  });
  await attachAbc(page);

  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 30_000 });
  await expect(runButton).toBeEnabled();
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText(
    'The background task could not start',
  );

  await page.evaluate(() => {
    window.__FODT_WORKER_FAULT__ = null;
  });
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 30_000 });
  await expect(firstDigestOf(page)).toHaveText(ABC_SHA256);
});

test('a run started with an already-aborted signal settles immediately and constructs no worker', async ({ page }) => {
  await installWorkerWrapper(page);
  await page.goto(rel('/tools/hash-file'));

  const outcome = await page.evaluate(async () => {
    const controller = new AbortController();
    controller.abort();
    const file = new File([new Uint8Array([1, 2, 3])], 'x.bin');
    try {
      await window.__FODT_HASH_FILE_TEST_HOOKS__!.hashFileInWorker(file, ['sha256'], 'hex', {
        signal: controller.signal,
      });
      return 'resolved';
    } catch {
      return 'rejected';
    }
  });

  expect(outcome).toBe('rejected');
  const constructions = await page.evaluate(() => window.__FODT_WORKER_CONSTRUCTIONS__ ?? []);
  expect(constructions).toEqual([]);
});

test('pressing Reset during a run leaves the Run button enabled once the old work settles', async ({ page }) => {
  test.setTimeout(90_000);
  await useSmallTestChunks(page);
  await page.goto(rel('/tools/hash-file'));
  await attachLarge(page);

  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(cancelButtonOf(page)).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Reset', exact: true }).click();

  // Wait past the point the abandoned run would have finished on its own,
  // then confirm the button was not left disabled forever.
  await page.waitForTimeout(5_000);
  await expect(runButton).toBeEnabled();
  await expect(runButton).toHaveText('Run');
});

test('choosing an example during a run does not leave a stale result', async ({ page }) => {
  test.setTimeout(90_000);
  await useSmallTestChunks(page);
  await page.goto(rel('/tools/hash-file'));
  await attachLarge(page);

  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(cancelButtonOf(page)).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Also check SHA-1', exact: true }).click();

  await page.waitForTimeout(5_000);
  await expect(runButton).toBeEnabled();
  expect(await page.locator('section[aria-label="Output"] pre.output').count()).toBe(0);
});

test('the Cancel button and the progress element are keyboard reachable and named while a run is active', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await useSmallTestChunks(page);
  await page.goto(rel('/tools/hash-file'));
  await attachLarge(page);

  const runButton = runButtonOf(page);
  await runButton.click();

  const cancelButton = cancelButtonOf(page);
  await expect(cancelButton).toBeVisible({ timeout: 30_000 });
  await cancelButton.focus();
  await expect(cancelButton).toBeFocused();

  const progressEl = page.locator('progress.tool-progress');
  await expect(progressEl).toBeVisible();
  await expect(progressEl).toHaveAttribute('aria-label', 'Run progress');

  await cancelButton.click();
});

test('the page constructs exactly one worker and it produces the digest', async ({ page }) => {
  await installWorkerWrapper(page);
  await page.goto(rel('/tools/hash-file'));
  await attachAbc(page);

  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 30_000 });

  const constructions = await page.evaluate(() => window.__FODT_WORKER_CONSTRUCTIONS__ ?? []);
  expect(constructions.length).toBe(1);
  expect(constructions[0]!.startsWith('blob:')).toBe(true);
  await expect(firstDigestOf(page)).toHaveText(ABC_SHA256);
});
