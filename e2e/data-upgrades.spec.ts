import { test, expect, type Page } from '@playwright/test';

/**
 * Browser proof of the new modes the nine upgraded tools gained in phase 13 (D-180). Each upgraded tool keeps its
 * live fixture, which holds one scenario and proves the old default still works; what a tool can newly do is proven
 * here instead, one block of top-level tests per tool, every title starting with `<id>: `.
 *
 * Every expected text is written by hand from the format's own specification or from the rule the page states, never
 * copied from a run of the tool. The helpers are this file's own: a shared test helper would make every spec that
 * imports it run whole for every tool (phase 13 research, Pitfall 5).
 */
const rel = (path: string) => path.replace(/^\//, '');

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

async function openTool(page: Page, id: string): Promise<void> {
  await page.goto(rel(`/tools/${id}`));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

/**
 * Sets the radio and select controls of a case before any text is filled, because choosing a mode can show or hide
 * the fields that follow. A radio is clicked by its field name and value; a select is chosen by its id; a checkbox is
 * set to the wanted state by its id.
 */
async function setControls(
  page: Page,
  controls: {
    radios?: Record<string, string>;
    selects?: Record<string, string>;
    checks?: Record<string, boolean>;
  },
): Promise<void> {
  for (const [field, value] of Object.entries(controls.radios ?? {})) {
    await page.locator(`input[name="${field}"][value="${value}"]`).click();
  }
  for (const [field, value] of Object.entries(controls.selects ?? {})) {
    await page.locator(`#f-${field}`).selectOption(value);
  }
  for (const [field, value] of Object.entries(controls.checks ?? {})) {
    await page.locator(`#f-${field}`).setChecked(value);
  }
}

/**
 * Fills one text field and checks the value stayed. The pages are prerendered, so a field filled in the first
 * moments after load can be cleared again when the page finishes starting; the fill is repeated until it holds.
 */
async function fillField(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

declare global {
  interface Window {
    /**
     * What the Worker wrapper saw, for the upgraded tools that start a background worker (the XML formatter).
     * `addresses` and `types` list every worker the page built, in construction order, by script address and by the
     * type option it asked for; `log` lists, in the order they happened, `new:<n>`, `in:<n>:<message type>` (a
     * message the worker sent) and `out:<n>:<message type>` (a message the page sent, `out-swallowed` when the
     * wrapper dropped it); `ended` lists the position of every worker the page terminated.
     */
    __FODT_UPGRADE_WORKERS__?: { addresses: string[]; types: string[]; log: string[]; ended: number[] };
  }
}

/**
 * Installs a wrapper around the global Worker constructor, before any page script runs, so every construction, every
 * message in either direction and every terminate() call is recorded. With `swallowFirstJob`, the first worker built
 * never receives the job (as if the engine were stuck inside one synchronous call); with `swallowReady`, the first
 * worker's message listeners never see a message whose type ends with `-ready` (as if the module never finished
 * loading). Every later worker behaves normally, so the next run after a stop can be proven to work. A close copy of
 * the wrapper in e2e/data-workers.spec.ts under this file's own global name, because a shared test helper would make
 * every spec that imports it run whole for every tool.
 */
async function installWorkerWrapper(page: Page, options: { swallowFirstJob: boolean; swallowReady: boolean }) {
  await page.addInitScript(
    (modes: { swallowFirstJob: boolean; swallowReady: boolean }) => {
      const OriginalWorker = window.Worker;
      const state = {
        addresses: [] as string[],
        types: [] as string[],
        log: [] as string[],
        ended: [] as number[],
      };
      window.__FODT_UPGRADE_WORKERS__ = state;

      const typeOf = (data: unknown): string => {
        const type = (data as { type?: unknown } | null | undefined)?.type;
        return typeof type === 'string' ? type : '?';
      };

      class WrappedWorker {
        inner: Worker;
        index: number;
        swallowJob: boolean;
        swallowReady: boolean;
        wrapped = new Map<EventListenerOrEventListenerObject, EventListener>();
        constructor(scriptURL: string | URL, workerOptions?: WorkerOptions) {
          this.inner = new OriginalWorker(scriptURL, workerOptions);
          this.index = state.addresses.length;
          this.swallowJob = modes.swallowFirstJob && this.index === 0;
          this.swallowReady = modes.swallowReady && this.index === 0;
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
            return;
          }
          state.log.push(`out:${this.index}:${typeOf(args[0])}`);
          this.inner.postMessage(...args);
        }
        addEventListener(...args: Parameters<Worker['addEventListener']>): void {
          const [type, listener, listenerOptions] = args;
          if (this.swallowReady && type === 'message') {
            const filtered: EventListener = (event) => {
              if (typeOf((event as MessageEvent).data).endsWith('-ready')) return;
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
          this.inner.terminate();
        }
        dispatchEvent(event: Event): boolean {
          return this.inner.dispatchEvent(event);
        }
      }

      window.Worker = WrappedWorker as unknown as typeof Worker;
    },
    { swallowFirstJob: options.swallowFirstJob, swallowReady: options.swallowReady },
  );
}

/** Starts recording every request the page makes from now on, and returns the live list. */
function recordRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  return requests;
}

function cancelButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Cancel', exact: true });
}

/** Page time in milliseconds, read from the page itself so it follows the page clock. */
async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => Date.now());
}

/**
 * Freezes the page clock a little after `seen` and returns how much page time a timer that began between `before` and
 * `seen` has used up at that point: at least `atLeast` and at most `atMost`. Page time stands still from here until
 * `page.clock.runFor` moves it, so a limit is crossed to the millisecond, not at the speed of the machine.
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
            window.__FODT_UPGRADE_WORKERS__!.log.some((entry) => entry.startsWith(start!) && entry.endsWith(end!)),
          [startsWith, endsWith],
        ),
      { timeout: 15_000, intervals: [50, 100] },
    )
    .toBe(true);
}

async function endedWorkers(page: Page): Promise<number[]> {
  return page.evaluate(() => window.__FODT_UPGRADE_WORKERS__!.ended);
}

// ---------------------------------------------------------------------------------------------------------------
// data-convert (DATA-12): XML, CSV and TSV beside JSON, YAML and TOML
// ---------------------------------------------------------------------------------------------------------------

test('data-convert: XML with an attribute converts to JSON with the @_ prefix', async ({ page }) => {
  await openTool(page, 'data-convert');
  await setControls(page, { selects: { from: 'xml', to: 'json' } });
  await fillField(page, 'input', '<book id="1">Moby</book>');

  // XML 1.0: the attribute id and the text Moby belong to the one element book. The page's stated rule: an
  // attribute is a key starting with @_ and the text of an element that has attributes sits under #text.
  await expect(outputArea(page)).toContainText('"@_id": "1"');
  await expect(outputArea(page)).toContainText('"#text": "Moby"');
});

test('data-convert: JSON records convert to CSV with dotted keys and a nested array is refused with its path', async ({
  page,
}) => {
  await openTool(page, 'data-convert');
  await setControls(page, { selects: { from: 'json', to: 'csv' } });

  // A nested object becomes a dotted column name (the page's stated rule); the header is the first line.
  await fillField(page, 'input', '[{"user":{"name":"Ada"},"ok":true}]');
  await expect(outputArea(page)).toContainText('user.name,ok');
  await expect(outputArea(page)).toContainText('Ada,true');

  // An array inside a record cannot become a cell: the refusal names where it is, as a JSON Pointer into the input.
  await fillField(page, 'input', '[{"a":1},{"a":2,"tags":["x"]}]');
  const problems = outputArea(page).locator('.issue-list');
  await expect(problems).toContainText('/1/tags');
  await expect(problems).toContainText('cannot be flattened');
});

test('data-convert: a YAML source still converts to TSV through its worker', async ({ page }) => {
  await openTool(page, 'data-convert');
  await setControls(page, { selects: { from: 'yaml', to: 'tsv' } });
  await fillField(page, 'input', '- id: "7"\n  name: Ada\n- id: "8"\n  name: Grace\n');

  // TSV (IANA text/tab-separated-values): the first line names the fields, fields are separated by a tab and records
  // by a line break. The raw text is read, because a text matcher would fold the tab into a space.
  const output = outputArea(page).locator('pre.output');
  await expect(output).toContainText('Grace');
  expect(await output.textContent()).toContain('id\tname\n7\tAda\n8\tGrace');
});

// ---------------------------------------------------------------------------------------------------------------
// json-to-code (DATA-17): YAML and XML input beside JSON
// ---------------------------------------------------------------------------------------------------------------

test('json-to-code: YAML input gives a TypeScript interface with the same fields as the equivalent JSON', async ({
  page,
}) => {
  await openTool(page, 'json-to-code');
  await setControls(page, { selects: { inputFormat: 'yaml', language: 'typescript' } });
  // YAML 1.2 core schema: 36 is an integer and Ada is a string, exactly as the JSON {"name":"Ada","age":36} says.
  await fillField(page, 'input', 'name: Ada\nage: 36\ntags:\n  - a\n');

  await expect(outputArea(page)).toContainText('export interface Root {');
  await expect(outputArea(page)).toContainText('name: string;');
  await expect(outputArea(page)).toContainText('age: number;');
  await expect(outputArea(page)).toContainText('tags: string[];');
});

// ---------------------------------------------------------------------------------------------------------------
// json-schema-generator (DATA-18): YAML and XML samples beside JSON
// ---------------------------------------------------------------------------------------------------------------

test('json-schema-generator: an XML document gives a schema with its attribute and element properties', async ({
  page,
}) => {
  await openTool(page, 'json-schema-generator');
  await setControls(page, { selects: { inputFormat: 'xml' } });
  // XML 1.0: the attribute id and the child element name belong to the one element person. The page's stated rules:
  // an attribute is a property named @_id, and text that is written like a JSON number is read as a number.
  await fillField(page, 'samples', '<person id="1"><name>Ada</name></person>');

  await expect(outputArea(page)).toContainText('"person"');
  await expect(outputArea(page)).toContainText('"name"');
  await expect(outputArea(page)).toContainText('"@_id"');
  await expect(outputArea(page)).toContainText('"type": "integer"');
});

// ---------------------------------------------------------------------------------------------------------------
// mock-data (DATA-16): XML and YAML beside JSON, JSON Lines and CSV
// ---------------------------------------------------------------------------------------------------------------

test('mock-data: the YAML format gives the seeded records with yes kept as a string', async ({ page }) => {
  await openTool(page, 'mock-data');
  await setControls(page, { selects: { format: 'yaml' } });
  // oneOf with one choice always gives that text. YAML 1.1 reads a bare yes as a boolean, so a writer that wants it to
  // stay text writes it quoted; the id kind counts up from 1 and is a bare number.
  await fillField(page, 'fields', 'id: id\nanswer: oneOf(yes)');
  await fillField(page, 'count', '2');

  const output = outputArea(page).locator('pre.output');
  await expect(output).toContainText('answer: "yes"');
  expect(await output.textContent()).toBe('- id: 1\n  answer: "yes"\n- id: 2\n  answer: "yes"\n');
});

// ---------------------------------------------------------------------------------------------------------------
// xml-formatter (DATA-14): Canonical XML, an equivalence check and a tree beside format, minify and check
// ---------------------------------------------------------------------------------------------------------------

test('xml-formatter: Canonical XML of a document with attributes out of order gives the canonical form', async ({
  page,
}) => {
  await openTool(page, 'xml-formatter');
  await setControls(page, { radios: { mode: 'canonical' } });
  // Canonical XML 1.0 sections 2.3 and 3.3: attributes are written in lexicographic order with double quotes, and an
  // empty element is written as a start tag and an end tag.
  await fillField(page, 'input', `<doc b='2' a="1"><e/></doc>`);

  await expect(outputArea(page).locator('pre.output')).toHaveText('<doc a="1" b="2"><e></e></doc>', {
    timeout: 15_000,
  });
});

test('xml-formatter: canonicalization runs in a module worker from a blob address after ready and requests nothing', async ({
  page,
}) => {
  await installWorkerWrapper(page, { swallowFirstJob: false, swallowReady: false });
  await openTool(page, 'xml-formatter');

  // Recorded only after the page and its own chunk have loaded, so this asserts nothing is requested while running
  // the visitor's own input, not that the page itself loaded with zero requests. Format runs first, on the page, and
  // starts no worker.
  const requests = recordRequests(page);
  await fillField(page, 'input', '<a   y="2" x="1"><b/></a>');
  await expect(outputArea(page).locator('pre.output')).toContainText('<a   y="2" x="1">');
  expect(await page.evaluate(() => window.__FODT_UPGRADE_WORKERS__!.addresses.length)).toBe(0);

  await setControls(page, { radios: { mode: 'canonical' } });
  await expect(outputArea(page).locator('pre.output')).toHaveText('<a x="1" y="2"><b></b></a>', { timeout: 15_000 });

  const seen = await page.evaluate(() => window.__FODT_UPGRADE_WORKERS__!);
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
    .poll(async () => (await page.evaluate(() => window.__FODT_UPGRADE_WORKERS__!.ended)).length)
    .toBe(seen.addresses.length);

  expect(requests.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'))).toEqual([]);
});

test('xml-formatter: two documents differing only in attribute order are equivalent', async ({ page }) => {
  await openTool(page, 'xml-formatter');
  await setControls(page, { radios: { mode: 'compare' } });
  // Canonical XML 1.0 sections 2.3 and 3.3: attribute order, quote style, empty-element form and whitespace inside
  // tags are normalized, so these two documents have the same canonical form.
  await fillField(page, 'input', '<a  y="2" x="1"><b/>\n</a>');
  await fillField(page, 'second', `<a x='1' y="2"><b></b>\n</a>`);
  await expect(outputArea(page)).toContainText('Equivalent after canonicalization.', { timeout: 15_000 });

  // Changing one value is a real difference: the page says where the canonical forms first differ. In
  // `<a x="1" y="2">` the 2 is the 13th character.
  await fillField(page, 'second', '<a x="1" y="3"><b></b>\n</a>');
  await expect(outputArea(page)).toContainText(
    'Not equivalent: the canonical forms first differ at character 13 (line 1, column 13).',
    { timeout: 15_000 },
  );
  await expect(outputArea(page)).toContainText('--- first document, canonical form');
});

test('xml-formatter: the tree view opens and closes elements in the sandboxed preview and offers no Copy HTML', async ({
  page,
}) => {
  await openTool(page, 'xml-formatter');
  await setControls(page, { radios: { mode: 'tree' } });
  await fillField(page, 'input', '<a><b><c>deep</c></b><d>x</d></a>');

  // The view is the page's existing sandboxed frame: no permissions at all, so no script can run in it.
  const frameElement = outputArea(page).locator('iframe.preview-frame');
  await expect(frameElement).toHaveAttribute('sandbox', '', { timeout: 15_000 });
  const frame = outputArea(page).frameLocator('iframe.preview-frame');

  // The first two levels are open (the root a, and b and d below it); c is at the third level and starts closed.
  await expect(frame.locator('details[open]')).toHaveCount(3);
  await expect(frame.getByText('x', { exact: true })).toBeVisible();
  await expect(frame.getByText('deep', { exact: true })).toBeHidden();

  // Clicking the summary of c opens it and shows its text; clicking again closes it.
  await frame.locator('summary', { hasText: '<c>' }).click();
  await expect(frame.getByText('deep', { exact: true })).toBeVisible();
  await expect(frame.locator('details[open]')).toHaveCount(4);
  await frame.locator('summary', { hasText: '<c>' }).click();
  await expect(frame.getByText('deep', { exact: true })).toBeHidden();

  // Closing the root closes it. The element's own open state is read, because WebKit keeps a layout box for text under
  // a closed ancestor whose own details are open and so reports it as visible although nothing is painted.
  await frame.locator('summary', { hasText: '<a>' }).click();
  await expect(frame.locator('details').first()).not.toHaveAttribute('open', '');
  await frame.locator('summary', { hasText: '<a>' }).click();
  await expect(frame.locator('details').first()).toHaveAttribute('open', '');

  // The tree is a view of the document, not markup to copy: the block has no Copy HTML button, and no other copy
  // button either, because the page shows nothing else in this mode.
  expect(await outputArea(page).getByRole('button', { name: /Copy/ }).count()).toBe(0);
});

test('xml-formatter: a canonicalization past the 20 second limit stops with a plain message, not before', async ({
  page,
}) => {
  // The first worker never receives its job, so the run stays in flight like a stuck engine, and the page clock (not
  // real time) crosses the limit.
  await installWorkerWrapper(page, { swallowFirstJob: true, swallowReady: false });
  await page.clock.install();
  await openTool(page, 'xml-formatter');
  await setControls(page, { radios: { mode: 'canonical' } });

  // The run's own timer begins after `before`. Page time is frozen once the job has been posted, then moved by exact
  // amounts: the stuck run must still be running when no more than the limit minus half a second can have passed on
  // it, and must have been stopped when at least the limit plus a tenth of a second has.
  const before = await pageNow(page);
  await fillField(page, 'input', '<note>a short note</note>');
  await expect(cancelButtonOf(page)).toBeVisible();
  await waitForLog(page, 'out-swallowed:0:', '-job');
  const used = await freezeClock(page, before, await pageNow(page));
  const limit = 20_000;

  // Short of the limit: still running, no stop message, and the stuck worker is not yet ended. A limit that fired at
  // 19 seconds would already have stopped a 20 second run.
  const early = Math.max(0, limit - 500 - used.atMost);
  await page.clock.runFor(early);
  await expect(cancelButtonOf(page)).toBeVisible();
  await expect(outputArea(page)).not.toContainText('Stopped after');
  expect(await endedWorkers(page)).toEqual([]);

  // Past the limit: stopped, with the plain message, and the timed-out worker is ended. A limit that fired at 21
  // seconds would not have stopped it yet.
  await page.clock.runFor(Math.max(1, limit + 100 - used.atLeast - early));
  await expect(outputArea(page).locator('.issue-list')).toContainText(
    'Stopped after 20 seconds: this document took too long. Try a smaller document.',
    { timeout: 5_000 },
  );
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);
  expect(await endedWorkers(page)).toEqual([0]);
  await page.clock.resume();

  // The page still answers a script call within a second.
  const answerStart = Date.now();
  await page.evaluate(() => 1 + 1);
  expect(Date.now() - answerStart).toBeLessThan(1_000);

  // The next run works, in a new worker: the page runs as you type, so one more space after the root starts it.
  await fillField(page, 'input', '<note>a short note</note> ');
  await expect(outputArea(page).locator('pre.output')).toHaveText('<note>a short note</note>', { timeout: 15_000 });
  expect((await page.evaluate(() => window.__FODT_UPGRADE_WORKERS__!.addresses)).length).toBeGreaterThanOrEqual(2);
});

test('xml-formatter: Cancel stops a canonicalization at once and the next run works', async ({ page }) => {
  await installWorkerWrapper(page, { swallowFirstJob: true, swallowReady: false });
  await page.clock.install();
  await openTool(page, 'xml-formatter');
  await setControls(page, { radios: { mode: 'canonical' } });

  await fillField(page, 'input', '<note>a short note</note>');
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
  await page.clock.fastForward(21_000);
  await page.waitForTimeout(300);
  await expect(outputArea(page)).not.toContainText('Stopped after');
  await expect(note).toHaveText('Cancelled before finishing. No result was produced.');

  // The next run works: one more space after the root starts it.
  await fillField(page, 'input', '<note>a short note</note> ');
  await expect(outputArea(page).locator('pre.output')).toHaveText('<note>a short note</note>', { timeout: 15_000 });
});

test('xml-formatter: a worker that never reports ready stops after 10 seconds with a plain message', async ({
  page,
}) => {
  // The worker starts and says it is ready, but the page is never allowed to hear it, as if the module never finished
  // loading. The page must not post the job, and must stop waiting after 10 seconds of page clock.
  await installWorkerWrapper(page, { swallowFirstJob: false, swallowReady: true });
  await page.clock.install();
  await openTool(page, 'xml-formatter');
  await setControls(page, { radios: { mode: 'canonical' } });

  const before = await pageNow(page);
  await fillField(page, 'input', '<note>a short note</note>');
  await expect(cancelButtonOf(page)).toBeVisible();
  await waitForLog(page, 'in:0:', '-ready');
  // The start timer began between `before` and now. Page time is frozen, then moved by exact amounts: no message while
  // no more than 9.5 seconds can have passed, the message once at least 10.1 seconds have.
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
  const log = await page.evaluate(() => window.__FODT_UPGRADE_WORKERS__!.log);
  expect(log.filter((entry) => entry.startsWith('out')).length, log.join(' | ')).toBe(0);
  expect(await endedWorkers(page)).toEqual([0]);
});
