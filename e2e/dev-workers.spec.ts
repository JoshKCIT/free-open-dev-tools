import { test, expect, type Page } from '@playwright/test';

/**
 * Behavioural proof of the glob and .gitignore tester's worker (phase 16, D-168, D-169 and D-210 b): matching runs in
 * a MODULE worker started from a blob address built into the page's own chunk, the page posts the job only after the
 * worker has reported ready, nothing is requested while it runs, a run that never answers is stopped with a plain
 * message after its time limit of page clock and not before, Cancel stops a run at once and no time-limit message
 * follows, a result that arrives after Cancel is ignored, a worker that fails after its job was posted is reported as
 * stopped, and a worker that never reports ready is stopped after 10 seconds with its own message. Beyond that table:
 * a pattern that really backtracks is stopped after 5 seconds of real time with a message that does not repeat it and
 * leaves the page usable, and the platform a browser reports never changes what a glob shows.
 *
 * A close copy in shape of e2e/security-workers.spec.ts (a Worker wrapper by composition, the page clock, a swallowed
 * job), with its own global name (__FODT_DEV_WORKERS__) and its own helpers, because a shared test helper would make
 * every importing spec run whole for every tool, and an edit to another spec would rerun its other rows in every
 * browser. One table drives the page: a worker tool adds its row to ENGINE_CASES and gets every generated test. No
 * production hook exists: the limit is crossed with Playwright's page.clock and a worker whose job is swallowed, never
 * with a genuinely slow match (the one real-time test below is the exception, and it says so).
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
    __FODT_DEV_WORKERS__?: {
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
      window.__FODT_DEV_WORKERS__ = state;

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
 * Sets the radio controls of a case before any text is filled, because choosing a mode can show or hide the fields
 * that follow. A radio is clicked by its field name and value.
 */
async function setControls(page: Page, controls: { radios?: Record<string, string> }): Promise<void> {
  for (const [field, value] of Object.entries(controls.radios ?? {})) {
    await page.locator(`input[name="${field}"][value="${value}"]`).click();
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

async function openTool(page: Page, id: string): Promise<void> {
  await page.goto(rel(`/tools/${id}`));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

function cancelButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Cancel', exact: true });
}

/** Page time in milliseconds, read from the page itself so it follows the page clock. */
async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => Date.now());
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
            window.__FODT_DEV_WORKERS__!.log.some((entry) => entry.startsWith(start!) && entry.endsWith(end!)),
          [startsWith, endsWith],
        ),
      { timeout: 15_000, intervals: [50, 100] },
    )
    .toBe(true);
}

/**
 * Fills the case's fields and starts its run, returning the page time just before the run began. A page that waits
 * for a Run press starts when the button is clicked; a page that runs as you type starts at the fill.
 */
async function startRun(page: Page, c: EngineCase): Promise<number> {
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
 * Starts the next run after a stop or a Cancel. A page that waits for a Run press is pressed again; a page that runs
 * as you type does not run again until a value changes, so the last field of the case is edited by one trailing space.
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
  return page.evaluate(() => window.__FODT_DEV_WORKERS__!.ended);
}

/**
 * One worker-backed page under test. `radios` are set first; `valid` holds the text and textarea fields to fill (field
 * name to value, in the order they are filled); `pressRun` says the page waits for a Run press; `expectOutput` is text
 * a finished run must show; `limitSeconds` and `limitMessage` are the page's own time limit and the start of the
 * message it must show when the limit is reached.
 */
interface EngineCase {
  id: string;
  radios?: Record<string, string>;
  valid: Record<string, string>;
  pressRun: boolean;
  expectOutput: string;
  limitSeconds: number;
  limitMessage: string;
}

const ENGINE_CASES: EngineCase[] = [
  {
    id: 'glob-tester',
    // Glob mode (the default mode is .gitignore rules). The page runs as you type, so the patterns are filled before
    // the paths: the run starts when the paths arrive.
    radios: { mode: 'glob' },
    valid: { patterns: 'src/**/*.ts', paths: 'src/a.ts' },
    pressRun: false,
    expectOutput: 'src/a.ts',
    limitSeconds: 5,
    limitMessage: 'Stopped after 5 seconds',
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
    await fillFields(page, c.valid);
    if (c.pressRun) await runButtonOf(page).click();
    await expect(outputArea(page)).toContainText(c.expectOutput, { timeout: 30_000 });

    const seen = await page.evaluate(() => window.__FODT_DEV_WORKERS__!);
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
      .poll(async () => (await page.evaluate(() => window.__FODT_DEV_WORKERS__!.ended)).length)
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
    // at 4 seconds would already have stopped a 5 second run.
    const early = Math.max(0, limit - 500 - used.atMost);
    await page.clock.runFor(early);
    await expect(cancelButtonOf(page)).toBeVisible();
    await expect(outputArea(page)).not.toContainText('Stopped after');
    expect(await endedWorkers(page)).toEqual([]);

    // Past the limit: stopped, with the plain message, and the timed-out worker is ended. A limit that fired at 6
    // seconds would not have stopped it yet.
    await page.clock.runFor(Math.max(1, limit + 100 - used.atLeast - early));
    await expect(outputArea(page).locator('.issue-list')).toContainText(c.limitMessage, { timeout: 5_000 });
    expect(await outputArea(page).locator('table').count()).toBe(0);
    expect(await endedWorkers(page)).toEqual([0]);
    await page.clock.resume();

    // The page still answers a script call within a second.
    const answerStart = Date.now();
    await page.evaluate(() => 1 + 1);
    expect(Date.now() - answerStart).toBeLessThan(1_000);

    // The next run works, in a new worker.
    await startNextRun(page, c);
    await expect(outputArea(page)).toContainText(c.expectOutput, { timeout: 15_000 });
    expect((await page.evaluate(() => window.__FODT_DEV_WORKERS__!.addresses)).length).toBeGreaterThanOrEqual(2);
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
    expect(await outputArea(page).locator('table').count()).toBe(0);
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
    // The worker really does its work, but its `done` message is held back, so the run is still in flight when Cancel is
    // pressed. The held message is then handed to the page afterwards, as a message that was already on its way when the
    // worker was stopped would be. The page must not show it.
    await installWorkerWrapper(page, { swallowFirstJob: false, swallowReady: false, holdFirstDone: true });
    await openTool(page, c.id);
    await setControls(page, c);

    await startRun(page, c);
    await expect(cancelButtonOf(page)).toBeVisible();
    await waitForLog(page, 'in:0:', '-done');
    expect(await outputArea(page).locator('table').count()).toBe(0);
    await cancelButtonOf(page).click();

    const note = outputArea(page).locator('.note-warn');
    await expect(note).toHaveText('Cancelled before finishing. No result was produced.');
    expect(await endedWorkers(page)).toEqual([0]);

    // The late result reaches the page's listener now.
    expect(await page.evaluate(() => window.__FODT_DEV_WORKERS__!.release())).toBe(1);
    await page.waitForTimeout(500);
    expect(await outputArea(page).locator('table').count()).toBe(0);
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
    const log = await page.evaluate(() => window.__FODT_DEV_WORKERS__!.log);
    expect(log.filter((entry) => entry.startsWith('out')).length, log.join(' | ')).toBe(0);
    expect(await endedWorkers(page)).toEqual([0]);
  });
}

test('glob-tester: a backtracking pattern stops after 5 seconds with a plain message and the page stays usable', async ({
  page,
}) => {
  // Real time, no page clock and no wrapper: the real matcher gets a pattern with eight stars and a path of 80 letters
  // a with no b in it, which makes a regular expression backtrack for far longer than a minute (50 letters took about 3
  // seconds in Node and each extra letter multiplies it), in a real worker, and the page's own 5 second limit stops it.
  // The patterns are filled first, so the run starts when the path arrives.
  const pattern = '*a*a*a*a*a*a*a*a*b';
  await openTool(page, 'glob-tester');
  await setControls(page, { radios: { mode: 'glob' } });
  const startedAt = Date.now();
  await fillFields(page, { patterns: pattern, paths: 'a'.repeat(80) + 'c' });
  await expect(cancelButtonOf(page)).toBeVisible();
  await expect(outputArea(page).locator('.issue-list')).toContainText('Stopped after 5 seconds', { timeout: 15_000 });
  const elapsed = Date.now() - startedAt;
  // Never early (the limit is 5 seconds from the posted job, which is after startedAt), and not far past it.
  expect(elapsed).toBeGreaterThanOrEqual(5_000);
  expect(elapsed).toBeLessThan(12_000);
  const message = (await outputArea(page).locator('.issue-list').innerText()).replace(/\s+/g, ' ').trim();
  expect(message).toContain(
    'Stopped after 5 seconds: a pattern took too long on one of the paths. Shorten the pattern or the path.',
  );
  // The second sentence is for a large .gitignore paste, where the cause can be the size and not one pattern.
  expect(message).toContain('A very large .gitignore paste can also take this long: try fewer rules or fewer paths.');
  // The message holds no part of the pattern or the path.
  expect(message).not.toContain('*a');
  expect(message).not.toContain('aaaa');
  expect(await outputArea(page).locator('table').count()).toBe(0);
  // The page stayed usable, and the next pattern runs in a new worker.
  const answerStart = Date.now();
  await page.evaluate(() => 1 + 1);
  expect(Date.now() - answerStart).toBeLessThan(1_000);
  await fillFields(page, { patterns: '*c' });
  await expect(outputArea(page).locator('table')).toContainText('matched', { timeout: 10_000 });
});

test('glob-tester: the platform the browser reports never changes a glob result', async ({ browser, baseURL }) => {
  // The same input is shown on three pages that report three different platforms. picomatch asks the platform when it is
  // not told, and on a Windows machine it also reads a backslash as a separator and writes a different regular
  // expression; the tool tells it not to, so the whole output (the table and the regular expressions) is identical.
  const patterns = 'src/**/*.ts\n*.{js,md}\n@(x|y).txt\n[!a]*';
  const paths = 'src/a.ts\nsrc/lib/b.ts\nREADME.md\nx.txt\nbbb\n.hidden.js';
  const shown: string[] = [];
  for (const platform of ['Win32', 'Linux x86_64', 'MacIntel']) {
    const context = await browser.newContext({ baseURL });
    try {
      await context.addInitScript((reported: string) => {
        Object.defineProperty(Navigator.prototype, 'platform', { get: () => reported, configurable: true });
      }, platform);
      const page = await context.newPage();
      await openTool(page, 'glob-tester');
      expect(await page.evaluate(() => navigator.platform)).toBe(platform);
      await setControls(page, { radios: { mode: 'glob' } });
      await fillFields(page, { patterns, paths });
      await expect(outputArea(page).locator('table')).toContainText('src/lib/b.ts', { timeout: 15_000 });
      await expect(outputArea(page)).toContainText('The regular expression each pattern becomes');
      const text = (await outputArea(page).innerText()).replace(/\s+/g, ' ');
      // A regular expression written for Windows has a character class holding a backslash and a slash.
      expect(text, platform).not.toContain('[' + String.fromCharCode(92, 92) + '/]');
      shown.push(text);
    } finally {
      await context.close();
    }
  }
  expect(shown[1]).toBe(shown[0]);
  expect(shown[2]).toBe(shown[0]);
});

test('glob-tester: the dot and ignore-case boxes never change what .gitignore mode shows', async ({ page }) => {
  // The two boxes belong to glob mode. They are ticked in glob mode, where they work, then the mode is switched to
  // .gitignore (the boxes disappear and keep their ticks) and the answer is read; then they are unticked and the
  // answer is read again. A .gitignore answer is case-sensitive and does not care about a leading dot, as git reads a
  // .gitignore file: a.log is not matched by *.LOG, A.LOG is, and so are the dotfile .hidden.LOG and a.LOG inside the
  // dot folder .cache, whether or not the dot box was ticked. (A dotfile that *.LOG does not match anyway, such as
  // .hidden.log, would not show a difference, so the dotfiles named here are ones the rule does match.)
  await openTool(page, 'glob-tester');
  await setControls(page, { radios: { mode: 'glob' } });
  await page.locator('#f-dot').check();
  await page.locator('#f-nocase').check();
  await fillFields(page, { patterns: '*.LOG', paths: 'a.log\nA.LOG\n.hidden.log\n.hidden.LOG\n.cache/a.LOG' });
  const globTable = outputArea(page).locator('table');
  await expect(globTable).toContainText('.hidden.log', { timeout: 15_000 });
  // In glob mode the two options are in force: the star reaches the dotfiles, and case is ignored. (*.LOG does not
  // reach into a folder, so the last path is not matched.)
  const globRows = (await globTable.locator('tbody tr').allInnerTexts()).map((row) => row.replace(/\s+/g, ' '));
  expect(globRows).toHaveLength(5);
  expect(globRows.slice(0, 4).every((row) => row.includes('matched') && !row.includes('not matched'))).toBe(true);
  expect(globRows[4]).toContain('not matched');

  const gitignoreRows = async (): Promise<string[]> => {
    await setControls(page, { radios: { mode: 'gitignore' } });
    await expect(page.locator('#f-dot')).toHaveCount(0);
    await expect(page.locator('#f-nocase')).toHaveCount(0);
    await expect(outputArea(page).locator('table thead')).toContainText('Decided by', { timeout: 15_000 });
    return (await outputArea(page).locator('table tbody tr').allInnerTexts()).map((row) => row.replace(/\s+/g, ' '));
  };
  const expectRows = (rows: string[]): void => {
    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain('a.log not ignored no rule matched');
    expect(rows[1]).toContain('A.LOG ignored line 1: *.LOG');
    expect(rows[2]).toContain('.hidden.log not ignored no rule matched');
    expect(rows[3]).toContain('.hidden.LOG ignored line 1: *.LOG');
    expect(rows[4]).toContain('.cache/a.LOG ignored line 1: *.LOG');
  };

  // Both boxes ticked.
  const ticked = await gitignoreRows();
  expectRows(ticked);
  // The ticks were kept while the boxes were hidden.
  await setControls(page, { radios: { mode: 'glob' } });
  await expect(page.locator('#f-dot')).toBeChecked();
  await expect(page.locator('#f-nocase')).toBeChecked();

  // Both boxes unticked: the same answer.
  await page.locator('#f-dot').uncheck();
  await page.locator('#f-nocase').uncheck();
  const unticked = await gitignoreRows();
  expectRows(unticked);
  expect(unticked).toEqual(ticked);
});
