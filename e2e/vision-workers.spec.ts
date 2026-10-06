import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { armCspProbe, describeFinding } from './csp-probe';
import { buildFixtureFile, writePng } from './fixture-files';

/**
 * Behavioural proof of the worker-backed pages of phase 15 (D-168, D-169 and D-201): each engine runs in a MODULE worker
 * started from a blob address built into the page's own chunk, the page posts the job only after the worker has reported
 * ready, nothing is requested while the work is done, a run that never answers is stopped with a plain message after its
 * time limit of page clock and not before, Cancel stops a run at once and no time-limit message follows, a result that
 * arrives after Cancel is ignored, and a worker that never reports ready is stopped after 10 seconds with its own
 * message.
 *
 * A close copy in shape of e2e/security-workers.spec.ts (a Worker wrapper by composition, the page clock, a swallowed
 * job), with its own global name (__FODT_VISION_WORKERS__) and its own helpers, because a shared test helper would make
 * every importing spec run whole for every tool, and an edit to the security spec would rerun its other rows in every
 * browser. One table drives the page: a worker tool adds its row to ENGINE_CASES and gets every generated test; a tool
 * whose input is a picked file lists the files to attach in `attach`. No production hook exists: the limit is crossed
 * with Playwright's page.clock and a worker whose job is swallowed, never with a genuinely slow input.
 */
const rel = (path: string) => path.replace(/^\//, '');

declare global {
  interface Window {
    /**
     * What the wrapper saw. `addresses` and `types` list every worker the page built, in construction order, by
     * script address and by the type option it asked for; `log` lists, in the order they happened, `new:<n>`,
     * `in:<n>:<message type>` (a message the worker sent) and `out:<n>:<message type>` (a message the page sent,
     * `out-swallowed` when the wrapper dropped it); `ended` lists the position of every worker the page terminated;
     * `release` hands the page every `done` message the wrapper was told to hold back and returns how many there were.
     */
    __FODT_VISION_WORKERS__?: {
      addresses: string[];
      types: string[];
      log: string[];
      ended: number[];
      release: () => number;
    };
  }
}

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

function runButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

/** Presses Run and waits until the run is over: the button says Working while the stylesheet is compiled and Run again after. */
async function runAndWait(page: Page): Promise<void> {
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toBeVisible({ timeout: 60_000 });
}

/**
 * Installs a wrapper around the global Worker constructor, before any page script runs, so every construction,
 * every message in either direction and every terminate() call is recorded. With `swallowFirstJob`, the first worker
 * built never receives the job (as if the engine were stuck inside one synchronous call); with `swallowReady`, the
 * first worker's message listeners never see a message whose type ends with `-ready` (as if the module never
 * finished loading). Every later worker behaves normally, so the next run after a stop can be proven to work.
 */
async function installWorkerWrapper(
  page: Page,
  options: {
    swallowFirstJob: boolean;
    swallowReady: boolean;
    errorAfterSwallowedJob?: boolean;
    holdFirstDone?: boolean;
  },
) {
  await page.addInitScript(
    (modes: {
      swallowFirstJob: boolean;
      swallowReady: boolean;
      errorAfterSwallowedJob: boolean;
      holdFirstDone: boolean;
    }) => {
      const OriginalWorker = window.Worker;
      const state = {
        addresses: [] as string[],
        types: [] as string[],
        log: [] as string[],
        ended: [] as number[],
        release: (): number => {
          const count = held.length;
          for (const deliver of held.splice(0)) deliver();
          return count;
        },
      };
      // The `done` messages held back for the first worker, each as a call that hands it to the page's own listener.
      const held: (() => void)[] = [];
      window.__FODT_VISION_WORKERS__ = state;

      const typeOf = (data: unknown): string => {
        const type = (data as { type?: unknown } | null | undefined)?.type;
        return typeof type === 'string' ? type : '?';
      };

      class WrappedWorker {
        inner: Worker;
        index: number;
        swallowJob: boolean;
        swallowReady: boolean;
        holdDone: boolean;
        wrapped = new Map<EventListenerOrEventListenerObject, EventListener>();
        constructor(scriptURL: string | URL, workerOptions?: WorkerOptions) {
          this.inner = new OriginalWorker(scriptURL, workerOptions);
          this.index = state.addresses.length;
          this.swallowJob = modes.swallowFirstJob && this.index === 0;
          this.swallowReady = modes.swallowReady && this.index === 0;
          this.holdDone = modes.holdFirstDone && this.index === 0;
          state.addresses.push(String(scriptURL));
          state.types.push(workerOptions?.type ?? 'classic');
          state.log.push(`new:${this.index}`);
          // Registered first, so it runs before any listener the page adds: the log shows what the worker said even
          // when the page is not allowed to hear it.
          this.inner.addEventListener('message', (event) => {
            state.log.push(`in:${this.index}:${typeOf((event as MessageEvent).data)}`);
          });
        }
        postMessage(...args: Parameters<Worker['postMessage']>): void {
          if (this.swallowJob) {
            state.log.push(`out-swallowed:${this.index}:${typeOf(args[0])}`);
            // As if the worker failed after the job was posted: the page hears an error event from it.
            if (modes.errorAfterSwallowedJob) {
              setTimeout(() => this.inner.dispatchEvent(new ErrorEvent('error', { message: 'probe' })), 0);
            }
            return;
          }
          state.log.push(`out:${this.index}:${typeOf(args[0])}`);
          this.inner.postMessage(...args);
        }
        addEventListener(...args: Parameters<Worker['addEventListener']>): void {
          const [type, listener, listenerOptions] = args;
          if ((this.swallowReady || this.holdDone) && type === 'message') {
            const deliver = (event: Event): void => {
              if (typeof listener === 'function') listener.call(this.inner, event);
              else listener.handleEvent(event);
            };
            const filtered: EventListener = (event) => {
              const kind = typeOf((event as MessageEvent).data);
              if (this.swallowReady && kind.endsWith('-ready')) return;
              // A held `done` is delivered later, by `release`, to the same listener, even after the page stopped listening.
              if (this.holdDone && kind.endsWith('-done')) {
                held.push(() => deliver(event));
                return;
              }
              deliver(event);
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
          this.inner.terminate();
        }
        dispatchEvent(event: Event): boolean {
          return this.inner.dispatchEvent(event);
        }
      }

      window.Worker = WrappedWorker as unknown as typeof Worker;
    },
    {
      swallowFirstJob: options.swallowFirstJob,
      swallowReady: options.swallowReady,
      errorAfterSwallowedJob: options.errorAfterSwallowedJob ?? false,
      holdFirstDone: options.holdFirstDone ?? false,
    },
  );
}

/** Starts recording every request the page makes from now on, and returns the live list. */
function recordRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  return requests;
}

/**
 * Sets the radio and select controls of a case before any text is filled, because choosing a mode can show or hide
 * the text fields that follow. A radio is clicked by its field name and value; a select is chosen by its id.
 */
async function setControls(
  page: Page,
  controls: { radios?: Record<string, string>; selects?: Record<string, string> },
): Promise<void> {
  for (const [field, value] of Object.entries(controls.radios ?? {})) {
    await page.locator(`input[name="${field}"][value="${value}"]`).click();
  }
  for (const [field, value] of Object.entries(controls.selects ?? {})) {
    await page.locator(`#f-${field}`).selectOption(value);
  }
}

/**
 * Fills each text field and checks the value stayed. The pages are prerendered, so a field filled in the first moments
 * after load can be cleared again when the page finishes starting; the fill is repeated until it holds.
 */
async function fillFields(page: Page, fields: Record<string, string>): Promise<void> {
  for (const [name, value] of Object.entries(fields)) {
    const field = page.locator(`#f-${name}`);
    await expect(async () => {
      await field.fill(value);
      await expect(field).toHaveValue(value, { timeout: 500 });
    }).toPass({ timeout: 10_000 });
  }
}

/**
 * Attaches the files a case lists. A page that is still starting can drop a file set in its first moments, so the
 * attachment is repeated until the page shows the file's name under the field.
 */
async function attachFiles(page: Page, c: EngineCase): Promise<void> {
  for (const a of c.attach ?? []) {
    const file = a.make();
    await expect(async () => {
      await page
        .locator(`#f-${a.field}`)
        .setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
      await expect(page.locator('.field-help', { hasText: file.name })).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 10_000 });
  }
}

async function openTool(page: Page, id: string): Promise<void> {
  await page.goto(rel(`/tools/${id}`));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

/** Page time in milliseconds, read from the page itself so it follows the page clock. */
async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => Date.now());
}

/**
 * Fills the case's fields, attaches its files and starts its run, returning the page time just before the run began. A
 * page that waits for a Run press starts when the button is clicked; a page that runs as you type starts at the fill.
 */
async function startRun(page: Page, c: EngineCase): Promise<number> {
  await attachFiles(page, c);
  if (c.pressRun) {
    await fillFields(page, c.valid);
    const before = await pageNow(page);
    await runButtonOf(page).click();
    return before;
  }
  const before = await pageNow(page);
  await fillFields(page, c.valid);
  return before;
}

function cancelButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Cancel', exact: true });
}

/**
 * Freezes the page clock a little after `seen` and returns how much page time a timer that began between `before`
 * and `seen` has used up at that point: at least `atLeast` and at most `atMost`. Page time stands still from here
 * until `page.clock.runFor` moves it, so a limit is crossed to the millisecond, not at the speed of the machine.
 */
async function freezeClock(page: Page, before: number, seen: number): Promise<{ atLeast: number; atMost: number }> {
  const pausedAt = seen + 2_000;
  await page.clock.pauseAt(pausedAt);
  return { atLeast: pausedAt - seen, atMost: pausedAt - before };
}

/** Waits until the wrapper's log holds an entry that starts and ends as given. */
async function waitForLog(page: Page, startsWith: string, endsWith: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ([start, end]) =>
            window.__FODT_VISION_WORKERS__!.log.some((entry) => entry.startsWith(start!) && entry.endsWith(end!)),
          [startsWith, endsWith],
        ),
      { timeout: 15_000, intervals: [50, 100] },
    )
    .toBe(true);
}

/**
 * Starts the next run after a stop or a Cancel. A page that waits for a Run press is pressed again (the files stay
 * attached); a page that runs as you type does not run again until a value changes, so the last field of the case is
 * edited by one trailing space.
 */
async function startNextRun(page: Page, c: EngineCase): Promise<void> {
  if (c.pressRun) {
    await runButtonOf(page).click();
    return;
  }
  const [name, value] = Object.entries(c.valid).at(-1)!;
  await fillFields(page, { [name]: value + ' ' });
}

async function endedWorkers(page: Page): Promise<number[]> {
  return page.evaluate(() => window.__FODT_VISION_WORKERS__!.ended);
}

/**
 * One worker-backed page under test. `radios` and `selects` are set first; `attach` lists the files to attach to file
 * fields before the run (each made fresh by `make`); `valid` holds the text, textarea and number fields to fill (field
 * name to value); `pressRun` says the page waits for a Run press; `expectOutput` is text a finished run must show;
 * `limitSeconds` and `limitMessage` are the page's own time limit and the start of the message it must show when the
 * limit is reached. `protocolWorkers` is how many of the workers a run builds, counted from the first, speak this
 * protocol (a ready message, then a `-job` and a `-done`); a page that also builds a worker of another kind, such as
 * PDF.js's own, after the engine one lists how many come first. Absent means every worker speaks it.
 */
interface EngineCase {
  id: string;
  radios?: Record<string, string>;
  selects?: Record<string, string>;
  attach?: { field: string; make: () => { name: string; mimeType: string; buffer: Buffer } }[];
  valid: Record<string, string>;
  pressRun: boolean;
  expectOutput: string;
  limitSeconds: number;
  limitMessage: string;
  protocolWorkers?: number;
}

/**
 * A QR code carrying FODT-VISION-WORKER, level M, as the rows of its module matrix (1 is a dark module). Made once with
 * the qrcode 1.5.4 library from the reader folder:
 *   cd tools/qr-barcode-reader && node -e "const Q=require('qrcode');const q=Q.create('FODT-VISION-WORKER',
 *   {errorCorrectionLevel:'M'});const n=q.modules.size;for(let r=0;r<n;r++){let s='';for(let c=0;c<n;c++)
 *   s+=q.modules.data[r*n+c];console.log(s)}"
 */
const QR_MATRIX = [
  '111111101010101111111',
  '100000101100001000001',
  '101110100101101011101',
  '101110101100001011101',
  '101110100011001011101',
  '100000100111101000001',
  '111111101010101111111',
  '000000001101100000000',
  '101101110101101001011',
  '100111011110110101111',
  '101101100101000011000',
  '110001001110011001101',
  '101111111110110100101',
  '000000001000011000100',
  '111111101010011111010',
  '100000101001111011010',
  '101110100111100000000',
  '101110101000110101010',
  '101110101010001101100',
  '100000100100011011000',
  '111111101000111001010',
];

/** The matrix drawn at 8 pixels a module with a 4 module quiet zone, as a real PNG file. */
function qrPng(): { name: string; mimeType: string; buffer: Buffer } {
  const scale = 8;
  const margin = 4;
  const size = QR_MATRIX.length;
  const side = (size + margin * 2) * scale;
  const rgba = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    const row = Math.floor(y / scale) - margin;
    for (let x = 0; x < side; x++) {
      const col = Math.floor(x / scale) - margin;
      const dark = row >= 0 && row < size && col >= 0 && col < size && QR_MATRIX[row]![col] === '1';
      const o = (y * side + x) * 4;
      const value = dark ? 0 : 255;
      rgba[o] = value;
      rgba[o + 1] = value;
      rgba[o + 2] = value;
      rgba[o + 3] = 255;
    }
  }
  return { name: 'worker-check.png', mimeType: 'image/png', buffer: Buffer.from(writePng(side, side, rgba)) };
}

/**
 * A PDF with a document information dictionary (its Title is the marker), written by this repository's own fixture
 * builder from ISO 32000-1 sections 7.3 and 7.5. Its name makes the copy sample-clean.pdf.
 */
function taggedPdf(): { name: string; mimeType: string; buffer: Buffer } {
  const file = buildFixtureFile('pdf', 'FODT-VISION-WORKER-PDF');
  return { name: file.name, mimeType: file.mimeType, buffer: Buffer.from(file.buffer) };
}

/**
 * Two 20 by 10 PNGs made here: both are white, and the second has a black pixel at each of seven places that are not next
 * to each other (so none of them can be taken for an anti-aliased edge). Compared at the default threshold they differ in
 * exactly 7 of 200 pixels, which is what the page must say.
 */
const COMPARE_BLACK_PIXELS = new Set(['1,1', '5,1', '9,1', '13,1', '17,1', '3,6', '11,6']);

function comparePng(name: string, black: Set<string>): { name: string; mimeType: string; buffer: Buffer } {
  const width = 20;
  const height = 10;
  const rgba = new Uint8Array(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (black.has(`${x},${y}`)) rgba.set([0, 0, 0, 255], (y * width + x) * 4);
    }
  }
  return { name, mimeType: 'image/png', buffer: Buffer.from(writePng(width, height, rgba)) };
}

const ENGINE_CASES: EngineCase[] = [
  {
    id: 'qr-barcode-reader',
    attach: [{ field: 'file', make: qrPng }],
    valid: {},
    pressRun: true,
    expectOutput: 'FODT-VISION-WORKER',
    limitSeconds: 20,
    limitMessage: 'Stopped after 20 seconds',
  },
  {
    id: 'sass-less-compiler',
    radios: { language: 'scss' },
    valid: { source: '$c: #336699;\n.a { color: $c; }' },
    pressRun: true,
    expectOutput: 'color: #336699',
    limitSeconds: 8,
    limitMessage: 'Stopped after 8 seconds',
  },
  {
    // Remove mode swallows the removal job (the first worker); the page then builds PDF.js's own worker, from a blob address
    // too, to read the copy again, which speaks PDF.js's message protocol and not this one, so only the first worker is checked.
    id: 'pdf-text-metadata',
    radios: { mode: 'remove' },
    attach: [{ field: 'file', make: taggedPdf }],
    valid: {},
    pressRun: true,
    expectOutput: 'sample-clean.pdf',
    limitSeconds: 20,
    limitMessage: 'Stopped after 20 seconds',
    protocolWorkers: 1,
  },
  {
    id: 'image-compare',
    attach: [
      { field: 'imageA', make: () => comparePng('compare-first.png', new Set()) },
      { field: 'imageB', make: () => comparePng('compare-second.png', COMPARE_BLACK_PIXELS) },
    ],
    valid: { threshold: '0.1' },
    pressRun: true,
    expectOutput: '7 of 200',
    limitSeconds: 20,
    limitMessage: 'Stopped after 20 seconds',
  },
];

for (const c of ENGINE_CASES) {
  test(`${c.id}: runs in a module worker from a blob address after it reports ready, and requests nothing`, async ({
    page,
  }) => {
    await installWorkerWrapper(page, { swallowFirstJob: false, swallowReady: false });
    await openTool(page, c.id);

    // Recorded only after the page and its own chunk have loaded, so this asserts nothing is requested while
    // running the visitor's own input -- not that the page itself loaded with zero requests.
    const requests = recordRequests(page);

    await setControls(page, c);
    await startRun(page, c);
    await expect(outputArea(page)).toContainText(c.expectOutput, { timeout: 30_000 });

    const seen = await page.evaluate(() => window.__FODT_VISION_WORKERS__!);
    expect(seen.addresses.length).toBeGreaterThanOrEqual(1);
    for (const address of seen.addresses) expect(address.startsWith('blob:')).toBe(true);
    // Every worker on the site is built as an ES module (apps/web/vite.config.ts), so the page asks for one.
    for (const type of seen.types) expect(type).toBe('module');

    // The job was posted only after the worker said it was ready, for every worker the page built that speaks the protocol.
    for (let n = 0; n < (c.protocolWorkers ?? seen.addresses.length); n++) {
      const ready = seen.log.findIndex((entry) => entry.startsWith(`in:${n}:`) && entry.endsWith('-ready'));
      const job = seen.log.findIndex((entry) => entry.startsWith(`out:${n}:`) && entry.endsWith('-job'));
      expect(ready, `worker ${n} never reported ready: ${seen.log.join(' | ')}`).toBeGreaterThanOrEqual(0);
      expect(job, `worker ${n} was never sent a job: ${seen.log.join(' | ')}`).toBeGreaterThan(ready);
    }

    // A worker that finished its job is ended too: every worker the page built has been terminated.
    await expect
      .poll(async () => (await page.evaluate(() => window.__FODT_VISION_WORKERS__!.ended)).length)
      .toBe(seen.addresses.length);

    const offending = requests.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'));
    expect(offending).toEqual([]);
  });

  test(`${c.id}: a run past the ${c.limitSeconds} second limit stops with a plain message, not before, and the page stays usable`, async ({
    page,
  }) => {
    // The first worker never receives its job, so the run stays in flight like a stuck engine, and the page clock
    // (not real time) crosses the limit.
    await installWorkerWrapper(page, { swallowFirstJob: true, swallowReady: false });
    await page.clock.install();
    await openTool(page, c.id);
    await setControls(page, c);

    // The run's own timer begins after `before`. Page time is frozen once the job has been posted, then moved by
    // exact amounts: the stuck run must still be running when no more than the limit minus half a second can have
    // passed on it, and must have been stopped when at least the limit plus a tenth of a second has.
    const before = await startRun(page, c);
    await expect(cancelButtonOf(page)).toBeVisible();

    // The limit runs from the moment the job is posted, which is after the worker said it was ready. The wrapper
    // logs the swallowed job, so the run's timer exists before the clock is frozen, with no guess about real time.
    await waitForLog(page, 'out-swallowed:0:', '-job');
    const used = await freezeClock(page, before, await pageNow(page));
    const limit = c.limitSeconds * 1000;

    // Short of the limit: still running, no stop message, and the stuck worker is not yet ended. A limit that fired
    // at 9 seconds would already have stopped a 10 second run.
    const early = Math.max(0, limit - 500 - used.atMost);
    await page.clock.runFor(early);
    await expect(cancelButtonOf(page)).toBeVisible();
    await expect(outputArea(page)).not.toContainText('Stopped after');
    expect(await endedWorkers(page)).toEqual([]);

    // Past the limit: stopped, with the plain message, and the timed-out worker is ended. A limit that fired late
    // would not have stopped it yet.
    await page.clock.runFor(Math.max(1, limit + 100 - used.atLeast - early));
    await expect(outputArea(page).locator('.issue-list')).toContainText(c.limitMessage, { timeout: 5_000 });
    expect(await outputArea(page).locator('pre.output').count()).toBe(0);
    expect(await endedWorkers(page)).toEqual([0]);
    await page.clock.resume();

    // The page still answers a script call within a second.
    const answerStart = Date.now();
    await page.evaluate(() => 1 + 1);
    expect(Date.now() - answerStart).toBeLessThan(1_000);

    // The next run works, in a new worker.
    await startNextRun(page, c);
    await expect(outputArea(page)).toContainText(c.expectOutput, { timeout: 15_000 });
    expect((await page.evaluate(() => window.__FODT_VISION_WORKERS__!.addresses)).length).toBeGreaterThanOrEqual(2);
  });

  test(`${c.id}: Cancel stops a run at once, no time-limit message follows, and the next run works`, async ({
    page,
  }) => {
    await installWorkerWrapper(page, { swallowFirstJob: true, swallowReady: false });
    await page.clock.install();
    await openTool(page, c.id);
    await setControls(page, c);

    await startRun(page, c);
    await expect(cancelButtonOf(page)).toBeVisible();
    await waitForLog(page, 'out-swallowed:0:', '-job');
    expect(await endedWorkers(page)).toEqual([]);
    await cancelButtonOf(page).click();

    const note = outputArea(page).locator('.note-warn');
    await expect(note).toHaveText('Cancelled before finishing. No result was produced.');
    expect(await outputArea(page).locator('pre.output').count()).toBe(0);
    // The cancelled worker has been terminated, not just forgotten.
    expect(await endedWorkers(page)).toEqual([0]);

    // A little past the limit of page clock later, the limit would have fired had Cancel not cleared it: it must not.
    await page.clock.fastForward((c.limitSeconds + 1) * 1000);
    await page.waitForTimeout(300);
    await expect(outputArea(page)).not.toContainText('Stopped after');
    await expect(note).toHaveText('Cancelled before finishing. No result was produced.');

    // The next run works.
    await startNextRun(page, c);
    await expect(outputArea(page)).toContainText(c.expectOutput, { timeout: 15_000 });
  });

  test(`${c.id}: a result that arrives after Cancel is ignored, and the next run works`, async ({ page }) => {
    // The worker really reads the picture, but its `done` message is held back, so the run is still in flight when Cancel is
    // pressed. The held message is then handed to the page afterwards, as a message that was already on its way when the
    // worker was stopped would be. The page must not show it.
    await installWorkerWrapper(page, { swallowFirstJob: false, swallowReady: false, holdFirstDone: true });
    await openTool(page, c.id);
    await setControls(page, c);

    await startRun(page, c);
    await expect(cancelButtonOf(page)).toBeVisible();
    await waitForLog(page, 'in:0:', '-done');
    expect(await outputArea(page).locator('pre.output').count()).toBe(0);
    await cancelButtonOf(page).click();

    const note = outputArea(page).locator('.note-warn');
    await expect(note).toHaveText('Cancelled before finishing. No result was produced.');
    expect(await endedWorkers(page)).toEqual([0]);

    // The late result reaches the page's listener now.
    expect(await page.evaluate(() => window.__FODT_VISION_WORKERS__!.release())).toBe(1);
    await page.waitForTimeout(500);
    expect(await outputArea(page).locator('pre.output').count()).toBe(0);
    await expect(outputArea(page)).not.toContainText(c.expectOutput);
    await expect(note).toHaveText('Cancelled before finishing. No result was produced.');

    // The next run works, in a new worker.
    await startNextRun(page, c);
    await expect(outputArea(page)).toContainText(c.expectOutput, { timeout: 15_000 });
  });

  test(`${c.id}: a worker that fails after its job was posted is reported as stopped, not as unable to start`, async ({
    page,
  }) => {
    // The job is posted and swallowed, and then the worker raises an error event, as a worker that crashes mid-run
    // does. The worker had started, so the page must not say it could not.
    await installWorkerWrapper(page, { swallowFirstJob: true, swallowReady: false, errorAfterSwallowedJob: true });
    await openTool(page, c.id);
    await setControls(page, c);
    await startRun(page, c);
    await expect(outputArea(page).locator('.issue-list')).toContainText('The background task stopped unexpectedly.', {
      timeout: 15_000,
    });
    await expect(outputArea(page)).not.toContainText('could not start');
    expect(await endedWorkers(page)).toEqual([0]);
  });

  test(`${c.id}: a worker that never reports ready stops after 10 seconds with a plain message`, async ({ page }) => {
    // The worker starts and says it is ready, but the page is never allowed to hear it, as if the module never
    // finished loading. The page must not post the job, and must stop waiting after 10 seconds of page clock.
    await installWorkerWrapper(page, { swallowFirstJob: false, swallowReady: true });
    await page.clock.install();
    await openTool(page, c.id);
    await setControls(page, c);

    const before = await startRun(page, c);
    await expect(cancelButtonOf(page)).toBeVisible();
    await waitForLog(page, 'in:0:', '-ready');
    // The start timer began between `before` and now. Page time is frozen, then moved by exact amounts: no message
    // while no more than 9.5 seconds can have passed, the message once at least 10.1 seconds have.
    const used = await freezeClock(page, before, await pageNow(page));

    const early = Math.max(0, 9_500 - used.atMost);
    await page.clock.runFor(early);
    await expect(outputArea(page)).not.toContainText('did not start');
    expect(await endedWorkers(page)).toEqual([]);

    await page.clock.runFor(Math.max(1, 10_100 - used.atLeast - early));
    await expect(outputArea(page).locator('.issue-list')).toContainText(
      'The background task did not start within 10 seconds. Reload the page and try again.',
      { timeout: 5_000 },
    );
    // The job was never posted, and the silent worker has been ended.
    const log = await page.evaluate(() => window.__FODT_VISION_WORKERS__!.log);
    expect(log.filter((entry) => entry.startsWith('out')).length, log.join(' | ')).toBe(0);
    expect(await endedWorkers(page)).toEqual([0]);
  });
}

/**
 * Runs `body` with the address of a local HTTP server that records every request it receives, then waits a moment for a
 * stray request to land, and returns what the server saw. A stylesheet that names this server in an import would show up
 * here if a compiler or the page requested it. Written here, the shape copied from e2e/security-secrets.spec.ts.
 */
async function withRecordingServer(body: (address: string) => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    response.end('x');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await body(`http://127.0.0.1:${port}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return seen;
}

/**
 * Every page of this site carries a policy that refuses outside requests, so a control that must show a request being
 * heard cannot be made from a tool page: the browser refuses it before it is made. The control request comes from a
 * fresh page of the same browser that no tool policy covers: a plain page served by a small local server (a page with a
 * real local address, so the browser lets it reach the local recording server). Written here, never imported from
 * another spec.
 */
async function withPlainPage(context: BrowserContext, body: (plain: Page) => Promise<void>): Promise<void> {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><html><head><meta charset="utf-8"><title>plain</title></head><body></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const plain = await context.newPage();
  try {
    await plain.goto(`http://127.0.0.1:${port}/`);
    await body(plain);
  } finally {
    await plain.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('sass-less-compiler: an import of another file or address is refused in the page and a local server receives nothing', async ({
  page,
}) => {
  // Each stylesheet names the local server in an import the compiler would have to fetch to honour: a Sass use, a Less
  // import of an address, and a plain CSS import each compiler would copy into its output untouched. Every case names
  // its own target (x3.css, x4.css), so the message of one case can never stand in for the next case's.
  const cases: { language: string; source: (address: string) => string; target: (address: string) => string }[] = [
    { language: 'scss', source: (a) => `@use "${a}/x";`, target: (a) => `${a}/x` },
    { language: 'less', source: (a) => `@import (less) "${a}/x.less";`, target: (a) => `${a}/x.less` },
    { language: 'scss', source: (a) => `@import url(${a}/x3.css);`, target: (a) => `url(${a}/x3.css)` },
    { language: 'less', source: (a) => `@import url(${a}/x4.css);`, target: (a) => `url(${a}/x4.css)` },
  ];
  // Armed before the page loads: the page policy refuses an import request before it is made, so a refused attempt
  // shows only here, never at the recording server or as a request.
  const probe = await armCspProbe(page);
  const seen = await withRecordingServer(async (address) => {
    await openTool(page, 'sass-less-compiler');
    // Recorded only after the page and its own chunk have loaded, so this asserts nothing is requested while the
    // stylesheets are compiled and refused.
    const requests = recordRequests(page);
    for (const c of cases) {
      await setControls(page, { radios: { language: c.language } });
      await fillFields(page, { source: c.source(address) });
      await runAndWait(page);
      const issues = outputArea(page).locator('.issue-list');
      await expect(issues).toContainText('Imports of other files and addresses are not supported here', {
        timeout: 30_000,
      });
      // The refusal names the position and what the import asked for, and nothing was compiled.
      await expect(issues).toContainText('line 1, column 1');
      await expect(issues).toContainText(c.target(address));
      expect(await outputArea(page).locator('pre.output').count()).toBe(0);
    }
    expect(requests.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'))).toEqual([]);
  });
  // The server the stylesheets name saw no request at all.
  expect(seen).toEqual([]);
  // And nothing tried one: the page and its compiler workers raised no policy violation.
  expect(probe.findings().map(describeFinding), 'the page tried a request its policy refused').toEqual([]);

  // The detector can fail: a page script that requests the server's address is heard by the same kind of server. The
  // tool page's own policy refuses that request, so it is made by a plain page that no tool policy covers.
  const control = await withRecordingServer(async (address) => {
    await withPlainPage(page.context(), async (plain) => {
      await plain.evaluate((target) => fetch(target, { mode: 'no-cors' }).then(() => undefined), `${address}/control`);
    });
  });
  expect(control).toEqual(['GET /control']);
});

/**
 * The body shared by the two run-limit tests of the Sass and Less page: the real Sass engine runs `source`, a loop that
 * never ends, so the worker is genuinely busy when the limit is crossed (the job is NOT swallowed). The page clock is
 * frozen after the job is posted and moved by exact amounts, so the limit is crossed to the millisecond, not at the
 * speed of the machine. The run must be stopped at the limit, the busy worker ended, the page must still answer and a
 * valid stylesheet must compile in a new worker.
 */
async function loopIsStoppedAtTheLimit(page: Page, source: string): Promise<void> {
  const base = ENGINE_CASES.find((c) => c.id === 'sass-less-compiler')!;
  const endless: EngineCase = { ...base, valid: { source } };
  await installWorkerWrapper(page, { swallowFirstJob: false, swallowReady: false });
  await page.clock.install();
  await openTool(page, endless.id);
  await setControls(page, endless);

  const before = await startRun(page, endless);
  await expect(cancelButtonOf(page)).toBeVisible();
  // The job really reached the worker: the wrapper logged it, and the worker never answers it.
  await waitForLog(page, 'out:0:', '-job');
  const used = await freezeClock(page, before, await pageNow(page));
  const limit = endless.limitSeconds * 1000;

  // Short of the limit (half a second at most): still running, no stop message, the worker not yet ended and silent.
  const early = Math.max(0, limit - 500 - used.atMost);
  await page.clock.runFor(early);
  await expect(cancelButtonOf(page)).toBeVisible();
  await expect(outputArea(page)).not.toContainText('Stopped after');
  expect(await endedWorkers(page)).toEqual([]);
  const log = await page.evaluate(() => window.__FODT_VISION_WORKERS__!.log);
  expect(
    log.filter((entry) => entry.startsWith('in:0:') && !entry.endsWith('-ready')),
    log.join(' | '),
  ).toEqual([]);

  // Past the limit (a tenth of a second at least): stopped with the plain message, and the busy worker is ended.
  await page.clock.runFor(Math.max(1, limit + 100 - used.atLeast - early));
  await expect(outputArea(page).locator('.issue-list')).toContainText(endless.limitMessage, { timeout: 5_000 });
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);
  expect(await endedWorkers(page)).toEqual([0]);
  await page.clock.resume();

  // The page still answers a script call within a second, though a loop that never ends was running a moment ago.
  const answerStart = Date.now();
  await page.evaluate(() => 1 + 1);
  expect(Date.now() - answerStart).toBeLessThan(1_000);

  // A valid stylesheet now compiles, in a new worker.
  await fillFields(page, base.valid);
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText(base.expectOutput, { timeout: 15_000 });
  expect((await page.evaluate(() => window.__FODT_VISION_WORKERS__!.addresses)).length).toBeGreaterThanOrEqual(2);
}

test('sass-less-compiler: an endless loop is stopped at the run limit and the page keeps answering', async ({
  page,
}) => {
  await loopIsStoppedAtTheLimit(page, '$i: 0;\n@while true { $i: $i + 1; }');
});

test('sass-less-compiler: a short loop that grows without end is stopped at the run limit and the page keeps answering', async ({
  page,
}) => {
  // 68 bytes of source that write a new rule on every pass: the engine's memory grows for as long as it runs (about 200
  // megabytes a second in Node), so the run limit is what keeps it from reaching gigabytes. The worker is ended and the
  // page still answers.
  await loopIsStoppedAtTheLimit(page, '@for $i from 1 through 100000000 { .a-#{$i} { b: c; d: e } }');
});

test('pdf-text-metadata: a PDF.js worker that fails to start in Text mode is reported at once as unable to start, not as too large after 20 seconds', async ({
  page,
}) => {
  // In Text mode the first worker the page builds is PDF.js's own. Its first message is swallowed and the worker then
  // raises an error event, as a worker whose module cannot be evaluated does. PDF.js attaches no error listener to a worker
  // it is given as a port, so only the page's own listener can end the read; without it the read waits for the stall
  // limit and blames the file.
  await installWorkerWrapper(page, { swallowFirstJob: true, swallowReady: false, errorAfterSwallowedJob: true });
  await openTool(page, 'pdf-text-metadata');
  await setControls(page, { radios: { mode: 'text' } });
  const c: EngineCase = {
    id: 'pdf-text-metadata',
    attach: [{ field: 'file', make: taggedPdf }],
    valid: {},
    pressRun: true,
    expectOutput: '',
    limitSeconds: 20,
    limitMessage: '',
  };
  const started = Date.now();
  await startRun(page, c);
  await expect(outputArea(page).locator('.issue-list')).toContainText('The background task could not start.', {
    timeout: 15_000,
  });
  // At once means well inside the 20 second stall limit, and the stall message is not what is shown.
  expect(Date.now() - started).toBeLessThan(15_000);
  await expect(outputArea(page)).not.toContainText('Stopped after 20 seconds');
  await expect(outputArea(page)).not.toContainText('unusually large or complex');
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);
  // The failed worker has been ended, and the page is usable: the next run (a new worker) reads the file.
  expect(await endedWorkers(page)).toEqual([0]);
  await runButtonOf(page).click();
  await expect(outputArea(page)).toContainText('--- Page 1 ---', { timeout: 30_000 });
});
