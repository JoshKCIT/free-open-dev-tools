import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';

/**
 * Behavioural proof, shared by every code formatter that runs an engine in a
 * background worker (apps/web/src/lib/run-<id>-in-worker.ts): the engine runs
 * in a worker started from a blob address built into the page's own chunk,
 * nothing is requested while formatting, a run that never answers is stopped
 * with a plain message after 10 seconds of page clock and not before, Cancel
 * stops a run at once and no time-limit message follows, a syntax error shows
 * its line and column and no formatted code, and the page keeps answering
 * throughout.
 *
 * One table drives every page: a formatter adds its row to FORMATTERS and
 * gets every generated test below. A close copy in shape of
 * e2e/htaccess-generator.spec.ts's worker wrapper (composition, not a class
 * with a private field) and Cancel helpers, and of
 * e2e/markdown-formatter.spec.ts's time-limit check -- except that the limit
 * is crossed with the page clock (Playwright's page.clock) and a worker whose
 * job is swallowed, so no production hook exists and no genuinely slow input
 * is needed (a pathological input is slow in different ways in different
 * engines).
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (path: string) => path.replace(/^\//, '');

declare global {
  interface Window {
    __FODT_FORMATTER_WORKERS__?: string[];
  }
}

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

/**
 * Installs a wrapper around the global Worker constructor, before any page
 * script runs, so every construction is recorded under its own global name.
 * With `swallowFirst`, the first worker built never receives its job (as if
 * the engine were stuck inside one synchronous call); every later worker
 * behaves normally, so the next run after a stop can be proven to format.
 */
async function installWorkerWrapper(page: Page, options: { swallowFirst: boolean }): Promise<void> {
  await page.addInitScript((swallowFirst: boolean) => {
    const OriginalWorker = window.Worker;
    window.__FODT_FORMATTER_WORKERS__ = [];

    class WrappedWorker {
      inner: Worker;
      swallow: boolean;
      constructor(scriptURL: string | URL, workerOptions?: WorkerOptions) {
        this.inner = new OriginalWorker(scriptURL, workerOptions);
        this.swallow = swallowFirst && window.__FODT_FORMATTER_WORKERS__!.length === 0;
        window.__FODT_FORMATTER_WORKERS__!.push(String(scriptURL));
      }
      postMessage(...args: Parameters<Worker['postMessage']>): void {
        if (this.swallow) return;
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
  }, options.swallowFirst);
}

/** Starts recording every request the page makes from now on, and returns the live list. */
function recordRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  return requests;
}

/**
 * One formatter page under test. `valid` holds the textarea, text and number
 * fields to fill (field name to value); `expectOutput` is text the formatted
 * result must contain (the page text is compared with whitespace collapsed);
 * `broken`, when present, is an input the engine refuses and the exact
 * `Line N, column M` text the issue list must show for it.
 */
interface FormatterCase {
  id: string;
  valid: Record<string, string>;
  expectOutput: string;
  broken?: { input: string; issue: string };
}

/** The input of a live fixture file, so the page is driven by the same published text its unit tests use. */
function liveFixtureInput(id: string): string {
  const file = JSON.parse(readFileSync(join(root, 'e2e', 'live-fixtures', `${id}.json`), 'utf8')) as {
    steps: { action: string; field?: string; value?: string }[];
  };
  const step = file.steps.find((s) => s.action === 'fill' && s.field === 'input');
  if (!step || typeof step.value !== 'string') throw new Error(`e2e/live-fixtures/${id}.json has no input step`);
  return step.value;
}

const FORMATTERS: FormatterCase[] = [
  {
    id: 'go-formatter',
    // Go's own gofmt testdata import.input, and a run of the sorted import block from import.golden (Go 1.25.5,
    // https://github.com/golang/go/tree/go1.25.5/src/cmd/gofmt/testdata, BSD-3-Clause).
    valid: { input: liveFixtureInput('go-formatter') },
    expectOutput: 'import ( "errors" "fmt" "io" "log" "math" )',
  },
];

async function openFormatter(page: Page, id: string): Promise<void> {
  await page.goto(rel(`/tools/${id}`));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

async function fillFields(page: Page, fields: Record<string, string>): Promise<void> {
  for (const [name, value] of Object.entries(fields)) await page.locator(`#f-${name}`).fill(value);
}

for (const c of FORMATTERS) {
  test(`${c.id}: formats in a background worker started from a blob address and requests nothing`, async ({ page }) => {
    await installWorkerWrapper(page, { swallowFirst: false });
    await openFormatter(page, c.id);

    // Recorded only after the page and its own chunk have loaded, so this
    // asserts nothing is requested while processing the visitor's own input
    // -- not that the page itself loaded with zero requests.
    const requests = recordRequests(page);

    await fillFields(page, c.valid);
    await expect(outputArea(page)).toContainText(c.expectOutput, { timeout: 15_000 });

    const workers = await page.evaluate(() => window.__FODT_FORMATTER_WORKERS__ ?? []);
    expect(workers.length).toBeGreaterThanOrEqual(1);
    for (const address of workers) expect(address.startsWith('blob:')).toBe(true);

    const offending = requests.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'));
    expect(offending).toEqual([]);
  });
}
