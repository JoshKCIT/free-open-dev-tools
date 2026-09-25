import { test, expect, type Page } from '@playwright/test';

/**
 * Behavioural proof for the .htaccess page's own worker-backed htpasswd
 * path: the line is genuinely made in a worker, the password never appears
 * anywhere in the Output section, no request is made, Cancel stops a slow
 * run cleanly, and the fixed time limit stops a run that passes it. A close
 * copy of `e2e/bcrypt.spec.ts`'s technique (worker wrapping via
 * composition, per the 02-10 lesson in STATE.md), scoped to this page's
 * own three scenarios (06-06-PLAN.md Task 2).
 */
const rel = (path: string) => path.replace(/^\//, '');

const PASSWORD = 'correct horse battery staple';
const SLOW_COST = 15;
const FAST_COST = 5;

declare global {
  interface Window {
    __FODT_WORKER_CONSTRUCTIONS__?: string[];
    __FODT_HTACCESS_TEST_HOOKS__?: {
      htpasswdInWorker: (
        job: { user: string; password: string; cost: number },
        ctx: { signal: AbortSignal },
        options?: { timeLimitMs?: number },
      ) => Promise<{ line: string; warnings: string[] }>;
    };
  }
}

/**
 * Installs a wrapper around the global Worker constructor, before any page
 * script runs, so every construction is counted -- a close copy of
 * `e2e/bcrypt.spec.ts`'s `installWorkerWrapper` (composition, not a class
 * with a private field, per the 02-10 lesson).
 */
async function installWorkerWrapper(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.__FODT_WORKER_CONSTRUCTIONS__ = [];

    class WrappedWorker {
      inner: Worker;
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        this.inner = new OriginalWorker(scriptURL, options);
        window.__FODT_WORKER_CONSTRUCTIONS__!.push(String(scriptURL));
      }
      postMessage(...args: Parameters<Worker['postMessage']>): void {
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

async function choosePasswordProtect(page: Page): Promise<void> {
  await page.locator('input[type="radio"][name="protection"][value="basic"]').check();
}

async function fillCredentials(page: Page, password: string, cost: number): Promise<void> {
  await page.locator('#f-username').fill('alice');
  await page.locator('#f-password').fill(password);
  await page.locator('#f-cost').fill(String(cost));
}

test('htaccess-generator makes the htpasswd line in a worker, shows no password and makes no request', async ({
  page,
}) => {
  await installWorkerWrapper(page);

  await page.goto(rel('/tools/htaccess-generator'));
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  // Recorded only after the page and its own assets have fully loaded, so
  // this asserts no request happens while processing the visitor's own
  // input -- not that the page itself loaded with zero requests.
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await choosePasswordProtect(page);
  await fillCredentials(page, PASSWORD, FAST_COST);

  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toHaveText('Run', { timeout: 15_000 });

  const constructions = await page.evaluate(() => window.__FODT_WORKER_CONSTRUCTIONS__ ?? []);
  expect(constructions.length).toBe(1);
  expect(constructions[0]!.startsWith('blob:')).toBe(true);

  const htpasswdBlock = outputArea(page).locator('pre.output').nth(1);
  await expect(htpasswdBlock).toHaveText(/^alice:\$2y\$05\$/);

  const outputText = await outputArea(page).innerText();
  expect(outputText).not.toContain(PASSWORD);

  const offending = requests.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'));
  expect(offending).toEqual([]);
});

test('htaccess-generator Cancel stops a slow htpasswd run and the next run succeeds', async ({ page }) => {
  await page.goto(rel('/tools/htaccess-generator'));
  await choosePasswordProtect(page);
  await fillCredentials(page, PASSWORD, SLOW_COST);

  const runButton = runButtonOf(page);
  await runButton.click();
  await expect(cancelButtonOf(page)).toBeVisible({ timeout: 5_000 });
  await cancelButtonOf(page).click();

  await expect(outputArea(page).locator('.note-warn')).toHaveText(
    'Cancelled before finishing. No result was produced.',
  );
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);
  await expect(runButton).toBeEnabled();

  await page.locator('#f-cost').fill(String(FAST_COST));
  await runButton.click();
  await expect(runButton).toHaveText('Run', { timeout: 15_000 });
  const htpasswdBlock = outputArea(page).locator('pre.output').nth(1);
  await expect(htpasswdBlock).toHaveText(/^alice:\$2y\$05\$/);
});

test('htaccess-generator stops an htpasswd job that passes its time limit', async ({ page }) => {
  // No real user interaction can reach a shorter limit than the fixed
  // 60-second one: exercised through the test hook the same way
  // e2e/bcrypt.spec.ts exercises its own already-aborted-signal path.
  await installWorkerWrapper(page);
  await page.goto(rel('/tools/htaccess-generator'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  const outcome = await page.evaluate(async () => {
    const controller = new AbortController();
    try {
      await window.__FODT_HTACCESS_TEST_HOOKS__!.htpasswdInWorker(
        { user: 'alice', password: 'correct horse battery staple', cost: 15 },
        { signal: controller.signal },
        { timeLimitMs: 50 },
      );
      return { settled: 'resolved' as const };
    } catch (err) {
      return { settled: 'rejected' as const, message: err instanceof Error ? err.message : String(err) };
    }
  });

  expect(outcome.settled).toBe('rejected');
  expect(outcome.message).toMatch(/longer than 60 seconds/);
});
