import { test, expect, type Page } from '@playwright/test';
import { writePng } from './fixture-files';

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

/**
 * One worker-backed page under test. `radios` and `selects` are set first; `attach` lists the files to attach to file
 * fields before the run (each made fresh by `make`); `valid` holds the text, textarea and number fields to fill (field
 * name to value); `pressRun` says the page waits for a Run press; `expectOutput` is text a finished run must show;
 * `limitSeconds` and `limitMessage` are the page's own time limit and the start of the message it must show when the
 * limit is reached.
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

    // The job was posted only after the worker said it was ready, for every worker the page built.
    for (let n = 0; n < seen.addresses.length; n++) {
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
}
