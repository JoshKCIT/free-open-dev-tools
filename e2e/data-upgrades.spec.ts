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
