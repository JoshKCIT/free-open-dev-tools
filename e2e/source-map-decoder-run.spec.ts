import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * The browser proof for the Source Map Stack Trace Decoder page's three run guarantees (21-10, D-253 a, D-255 a): Cancel
 * stops a decode at once with no half answer and the next run works; a decode still running at 20 seconds of page time
 * is stopped by the page with the fixed sentence and no answer, and not at 19 seconds; and every run gets a new background
 * task that is ended when its run ends. The same file runs on chromium, firefox, webkit and mobile-chrome.
 *
 * There is no hook in the page for a shorter limit: the 20 second limit is a plain constant in
 * apps/web/src/lib/run-source-map-decoder-in-worker.ts and this file never changes it. The stuck run comes from the
 * input instead: the largest decode the decoder's limits allow (tools/source-map-decoder/src/limits.ts), four map files of
 * about 20 MB in all 80 MB, each holding one generated line of 3,999,000 segments whose columns run downward so that the
 * decoder has to sort them, and a trace with one frame in each. The maps are built here at run time and written to a
 * temporary folder (Playwright cannot attach more than 50 MB from memory). The decode really runs: it took 1.8 to 5.3
 * seconds in each of the four browsers (measured, three runs each, recorded in the 21-10 summary). That is longer than a
 * Cancel press needs, but not reliably longer than the page clock steps of the limit test need in WebKit on Windows (a
 * single Playwright call there can take most of a second), so the first background task's `done` message is held back
 * from the page, the form D-255 a approves and e2e/dev-workers.spec.ts uses: the run stays in flight for as long as the
 * test needs, while the decode itself, the Cancel, the 20 second limit and the page are the real ones.
 * The 20 second stop is crossed with Playwright's page clock: it is frozen once the job has been posted and moved by
 * exact amounts from the moment the task said ready, which is when the page's timer began (19 seconds old: still running;
 * 21 seconds old: stopped). The background task keeps its own real time, so moving the page clock never changes it.
 *
 * A Worker wrapper by composition (a close copy in shape of e2e/dev-workers.spec.ts, with its own global name and its own
 * helpers, not a shared helper) records every task the page builds, every message in each direction and every terminate.
 * The page clock is installed before the page opens. The privacy proof of this page is e2e/privacy.spec.ts.
 */
const here = dirname(fileURLToPath(import.meta.url));
const rel = (path: string) => path.replace(/^\//, '');

/** The sentence the page shows at its limit; checked against the helper's own source below so the two cannot drift. */
const LIMIT_MESSAGE =
  'Stopped after 20 seconds: the decode took too long. Try fewer or smaller maps, or a shorter trace.';
const CANCEL_NOTE = 'Cancelled before finishing. No result was produced.';

/** Segments in each big map: below the 4,000,000 the decoder keeps per map, so the decode is slow but allowed. */
const SEGMENTS = 3_999_000;
/** How many big maps: 4 x about 20 MB stays under the 80 MiB the maps may total. */
const BIG_MAPS = 4;

declare global {
  interface Window {
    /**
     * What the wrapper saw. `log` lists, in the order they happened, `new:<n>` (a task built), `in:<n>:<type>` (a message
     * the task sent), `out:<n>:<type>` (a message the page sent) and `end:<n>` (the page terminated the task).
     */
    __FODT_SMD_WORKERS__?: { log: string[]; ended: number[]; readyAt: number[] };
  }
}

interface LiveFixture {
  steps: { action: string; field?: string; value?: string }[];
}

/** The small valid trace and map of the live fixture, so this file and the first-use check cannot disagree. */
function smallRun(): { trace: string; maps: string } {
  const live = JSON.parse(readFileSync(join(here, 'live-fixtures', 'source-map-decoder.json'), 'utf8')) as LiveFixture;
  const field = (name: string): string => {
    const value = live.steps.find((step) => step.action === 'fill' && step.field === name)?.value;
    if (value === undefined) throw new Error(`the live fixture has no ${name} to fill`);
    return value;
  };
  return { trace: field('trace'), maps: field('maps') };
}

/** One value as the base64 VLQ digits a source map's mappings use. */
function vlq(value: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    out += alphabet[digit];
  } while (rest > 0);
  return out;
}

/** A map whose one generated line holds `segments` segments with the columns running downward from the last to 0. */
function bigMap(file: string): Buffer {
  const mappings = vlq(SEGMENTS - 1) + 'AAA' + ',DAAA'.repeat(SEGMENTS - 1);
  return Buffer.from(JSON.stringify({ version: 3, file, sources: ['a.ts'], names: [], mappings }), 'utf8');
}

/** Writes the big maps to a temporary folder and returns their paths with the trace that names one frame in each. */
function bigInput(): { dir: string; paths: string[]; trace: string; total: number } {
  const dir = mkdtempSync(join(tmpdir(), 'fodt-smd-'));
  const paths: string[] = [];
  const frames: string[] = [];
  let total = 0;
  for (let k = 0; k < BIG_MAPS; k++) {
    const bytes = bigMap(`slow${k}.js`);
    const path = join(dir, `slow${k}.js.map`);
    writeFileSync(path, bytes);
    paths.push(path);
    total += bytes.length;
    frames.push(`    at f${k} (https://example.test/assets/slow${k}.js:1:${Math.floor(SEGMENTS / 2)})`);
  }
  return { dir, paths, trace: ['Error: slow', ...frames].join('\n'), total };
}

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

function runButton(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

function cancelButton(page: Page) {
  return page.getByRole('button', { name: 'Cancel', exact: true });
}

/**
 * Installs a wrapper around the global Worker constructor, before any page script runs, so every construction, every
 * message in either direction and every terminate() call is recorded. The tasks do their real work. With
 * `holdFirstDone`, the first task's `done` message is not handed to the page's listener (the log still shows the task
 * said it), so the page cannot hear an answer: the run stays in flight for as long as the test needs, whatever the
 * speed of the browser (D-255 a, the way e2e/dev-workers.spec.ts holds a result back).
 */
async function installWorkerWrapper(page: Page, options: { holdFirstDone: boolean }): Promise<void> {
  await page.addInitScript((modes: { holdFirstDone: boolean }) => {
    const OriginalWorker = window.Worker;
    const state = { log: [] as string[], ended: [] as number[], readyAt: [] as number[] };
    window.__FODT_SMD_WORKERS__ = state;
    let built = 0;
    const typeOf = (data: unknown): string => {
      const type = (data as { type?: unknown } | null | undefined)?.type;
      return typeof type === 'string' ? type : '?';
    };
    class WrappedWorker {
      inner: Worker;
      index: number;
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        this.inner = new OriginalWorker(scriptURL, options);
        this.index = built++;
        state.log.push(`new:${this.index}`);
        // Registered first, so it runs before any listener the page adds.
        this.inner.addEventListener('message', (event) => {
          const kind = typeOf((event as MessageEvent).data);
          state.log.push(`in:${this.index}:${kind}`);
          // The page time at which the task said ready: the page starts its 20 second timer in its own listener for this
          // same message, in the same turn, so this is where that timer began.
          if (kind.endsWith('-ready')) state.readyAt[this.index] = Date.now();
        });
      }
      postMessage(...args: Parameters<Worker['postMessage']>): void {
        state.log.push(`out:${this.index}:${typeOf(args[0])}`);
        this.inner.postMessage(...args);
      }
      wrapped = new Map<EventListenerOrEventListenerObject, EventListener>();
      addEventListener(...args: Parameters<Worker['addEventListener']>): void {
        const [type, listener, listenerOptions] = args;
        if (modes.holdFirstDone && this.index === 0 && type === 'message') {
          const filtered: EventListener = (event) => {
            if (typeOf((event as MessageEvent).data).endsWith('-done')) return;
            if (typeof listener === 'function') listener.call(this.inner, event);
            else listener.handleEvent(event);
          };
          this.wrapped.set(listener, filtered);
          this.inner.addEventListener(type, filtered, listenerOptions);
          return;
        }
        this.inner.addEventListener(...args);
      }
      removeEventListener(...args: Parameters<Worker['removeEventListener']>): void {
        const [type, listener, listenerOptions] = args;
        const filtered = this.wrapped.get(listener);
        if (filtered) {
          this.inner.removeEventListener(type, filtered, listenerOptions);
          return;
        }
        this.inner.removeEventListener(...args);
      }
      terminate(): void {
        state.ended.push(this.index);
        state.log.push(`end:${this.index}`);
        this.inner.terminate();
      }
      dispatchEvent(event: Event): boolean {
        return this.inner.dispatchEvent(event);
      }
    }
    window.Worker = WrappedWorker as unknown as typeof Worker;
  }, options);
}

async function wrapperLog(page: Page): Promise<string[]> {
  return page.evaluate(() => [...window.__FODT_SMD_WORKERS__!.log]);
}

async function endedTasks(page: Page): Promise<number[]> {
  return page.evaluate(() => [...window.__FODT_SMD_WORKERS__!.ended]);
}

/** Waits until the wrapper's log holds an entry exactly equal to `entry`. */
async function waitForLog(page: Page, entry: string): Promise<void> {
  await expect
    .poll(async () => (await wrapperLog(page)).includes(entry), { timeout: 20_000, intervals: [25, 50] })
    .toBe(true);
}

async function openDecoder(page: Page): Promise<void> {
  await page.goto(rel('/tools/source-map-decoder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

/** Fills a text field and checks the value stayed (the pages are prerendered, so a fill in the first moments can be cleared). */
async function fillField(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Opens the big map files and pastes the trace that names one frame in each, then presses Run. */
async function startSlowRun(page: Page, input: ReturnType<typeof bigInput>): Promise<void> {
  await fillField(page, 'trace', input.trace);
  await page.locator('#f-mapFiles').setInputFiles(input.paths);
  await runButton(page).click();
}

/** Takes the big files away and runs the small valid trace and map; the decoded frames must appear. */
async function runSmallAndExpectAnswer(page: Page): Promise<void> {
  const small = smallRun();
  await page.locator('#f-mapFiles').setInputFiles([]);
  await fillField(page, 'trace', small.trace);
  await fillField(page, 'maps', small.maps);
  await runButton(page).click();
  const output = outputArea(page);
  for (const text of ['src/math.ts', '3:11', 'checkPositive', 'src/main.ts', '15:1']) {
    await expect(output).toContainText(text, { timeout: 15_000 });
  }
  await expect(output.locator('table').first()).toBeVisible();
}

/**
 * A guard on this file's own constants, not a page behaviour: the sentence and the 20 second limit are read from the
 * helper's source, so a loosened limit or a reworded sentence fails the limit test rather than silently changing what is
 * tested.
 */
function expectLimitUnchanged(): void {
  const source = readFileSync(
    join(here, '..', 'apps', 'web', 'src', 'lib', 'run-source-map-decoder-in-worker.ts'),
    'utf8',
  );
  expect(source).toContain(`'${LIMIT_MESSAGE}'`);
  expect(source).toContain('SOURCE_MAP_DECODER_TIME_LIMIT_MS = 20000;');
}

test('source-map-decoder: Cancel stops a decode at once with no half answer and the next run works', async ({
  page,
}, testInfo) => {
  // Three times the slowest measured decode (5.3 s) plus 60 s, for the temporary files, the page and the next run.
  test.setTimeout(80_000);
  const input = bigInput();
  try {
    await installWorkerWrapper(page, { holdFirstDone: true });
    await page.clock.install();
    await openDecoder(page);
    await startSlowRun(page, input);
    await expect(cancelButton(page)).toBeVisible();
    await waitForLog(page, 'out:0:source-map-decoder-job');
    expect(await endedTasks(page)).toEqual([]);

    const pressed = Date.now();
    await cancelButton(page).click();
    const note = outputArea(page).locator('.note-warn');
    await expect(note).toHaveText(CANCEL_NOTE, { timeout: 3_000 });
    const tookMs = Date.now() - pressed;
    // No half answer: nothing of a result, and the running task is ended, not forgotten.
    await expect(outputArea(page).locator('table')).toHaveCount(0);
    await expect(outputArea(page)).not.toContainText('Decoded trace');
    await expect.poll(() => endedTasks(page)).toEqual([0]);

    // Past the limit of page time later, the limit would have fired had Cancel not cleared it: it must not.
    await page.clock.fastForward(21_000);
    // Real time for anything that was still on its way to the page to arrive.
    await page.waitForTimeout(1_500);
    await expect(outputArea(page)).not.toContainText('Stopped after');
    await expect(note).toHaveText(CANCEL_NOTE);
    await expect(outputArea(page).locator('table')).toHaveCount(0);
    expect(await endedTasks(page)).toEqual([0]);

    // The next run works, from a new task.
    await runSmallAndExpectAnswer(page);
    expect(await wrapperLog(page)).toContain('new:1');
    const note2 = `${BIG_MAPS} maps of ${Math.round(input.total / BIG_MAPS)} bytes; Cancel took effect in ${tookMs} ms`;
    testInfo.annotations.push({ type: 'timing', description: note2 });
    console.log(`source-map-decoder Cancel: ${note2}`);
  } finally {
    rmSync(input.dir, { recursive: true, force: true });
  }
});

test('source-map-decoder: a decode past 20 seconds of page time stops with the fixed sentence and no answer, not before', async ({
  page,
}, testInfo) => {
  // Three times the slowest measured decode (5.3 s) plus 60 s.
  test.setTimeout(80_000);
  expectLimitUnchanged();
  const input = bigInput();
  try {
    await installWorkerWrapper(page, { holdFirstDone: true });
    await page.clock.install();
    await openDecoder(page);
    await startSlowRun(page, input);
    await expect(cancelButton(page)).toBeVisible();
    await waitForLog(page, 'out:0:source-map-decoder-job');

    // Page time is frozen a little ahead of now and moved by exact amounts from there: the 20 second timer began when
    // the task said ready, so its age is known to the millisecond. 19 seconds old, the run must still be running, with
    // no stop shown; the state is read in one call and judged after the next step. Then 2 more seconds: 21 seconds old.
    const frozenAt = (await page.evaluate(() => Date.now())) + 1_000;
    await page.clock.pauseAt(frozenAt);
    const startedAt = await page.evaluate(() => window.__FODT_SMD_WORKERS__!.readyAt[0]!);
    const age = frozenAt - startedAt;
    expect(age, 'the run was already past 19 seconds of page time before the clock was frozen').toBeLessThanOrEqual(
      19_000,
    );
    await page.clock.runFor(19_000 - age);
    const at19 = await page.evaluate(() => ({
      ended: [...window.__FODT_SMD_WORKERS__!.ended],
      text: document.querySelector('section[aria-label="Output"]')?.textContent ?? '',
      cancelOffered: [...document.querySelectorAll('button')].some((button) => button.textContent === 'Cancel'),
      age: Date.now() - window.__FODT_SMD_WORKERS__!.readyAt[0]!,
    }));
    await page.clock.runFor(2_000);
    expect(at19.age).toBe(19_000);

    // 19 seconds old: still running (Cancel offered), no stop shown, the task not ended, no answer.
    expect(at19.cancelOffered, 'the run had already ended at 19 seconds').toBe(true);
    expect(at19.text).not.toContain('Stopped after');
    expect(at19.ended).toEqual([]);

    // 21 seconds: the page stopped the run with the fixed sentence, no answer, and the task is ended.
    const output = outputArea(page);
    await expect(output.locator('.issue-list')).toHaveText(LIMIT_MESSAGE, { timeout: 5_000 });
    await expect(output.locator('table')).toHaveCount(0);
    await expect(output).not.toContainText('Decoded trace');
    expect(await endedTasks(page)).toEqual([0]);
    await expect(output).not.toContainText('Working');

    // The page answers, and the next run works from a new task.
    await page.clock.resume();
    await runSmallAndExpectAnswer(page);
    expect(await wrapperLog(page)).toContain('new:1');
    testInfo.annotations.push({ type: 'timing', description: `${BIG_MAPS} maps, ${input.total} bytes in all` });
  } finally {
    rmSync(input.dir, { recursive: true, force: true });
  }
});

test('source-map-decoder: every run starts a new background task and ends it when the run ends', async ({ page }) => {
  // Two small runs only: quick, so the default timeout of the project is not enough on a slow machine, but 60 s is.
  test.setTimeout(60_000);
  const small = smallRun();
  await installWorkerWrapper(page, { holdFirstDone: false });
  await page.clock.install();
  await openDecoder(page);
  await fillField(page, 'trace', small.trace);
  await fillField(page, 'maps', small.maps);

  const output = outputArea(page);
  await runButton(page).click();
  await expect(output).toContainText('checkPositive', { timeout: 15_000 });
  await expect.poll(() => endedTasks(page)).toEqual([0]);

  await runButton(page).click();
  await expect.poll(() => endedTasks(page)).toEqual([0, 1]);
  await expect(output).toContainText('checkPositive');

  const log = await wrapperLog(page);
  const at = (entry: string): number => log.indexOf(entry);
  // Two tasks, each built for its run: the second is built only after the first was ended, and each is ended after it
  // answered.
  expect(log.filter((entry) => entry.startsWith('new:'))).toEqual(['new:0', 'new:1']);
  expect(at('in:0:source-map-decoder-done')).toBeGreaterThan(at('out:0:source-map-decoder-job'));
  expect(at('end:0')).toBeGreaterThan(at('in:0:source-map-decoder-done'));
  expect(at('new:1')).toBeGreaterThan(at('end:0'));
  expect(at('in:1:source-map-decoder-done')).toBeGreaterThan(at('out:1:source-map-decoder-job'));
  expect(at('end:1')).toBeGreaterThan(at('in:1:source-map-decoder-done'));
  // Each job went to the task built for it: the first task was sent exactly one job, the second exactly one.
  expect(log.filter((entry) => entry === 'out:0:source-map-decoder-job')).toHaveLength(1);
  expect(log.filter((entry) => entry === 'out:1:source-map-decoder-job')).toHaveLength(1);
  expect(log.filter((entry) => entry.startsWith('new:'))).toHaveLength(2);
});
