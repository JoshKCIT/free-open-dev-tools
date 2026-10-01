import { test, expect, type Page } from '@playwright/test';

/**
 * The browser proof, shared by every data tool of phase 13 that opens a real file, that the file stays in the page
 * (D-177): a real binary file is chosen through the file picker, the tool reads it and shows what is inside, and
 * nothing of it is found anywhere it should not be. Every file carries the same marker text, MARKER, as its content,
 * and a recorder of this spec's own checks that no request, console message, page error, storage entry, cookie or page
 * address holds the marker, that every request goes to the page's own origin or is a data or blob address, and that
 * no IndexedDB database, Cache Storage entry or private file system entry exists afterwards.
 *
 * Why a spec of its own and not a new file kind in the privacy harness: the harness can attach only the kinds in
 * e2e/fixture-files.ts, and adding a kind means editing that file, which makes every spec that imports it run whole
 * for every tool (phase 13 research, "Corrections to the locked context"). Each file here is built in code from a
 * base64 literal or from bytes, and the harness keeps proving the paths it can reach with a text file or typed input.
 *
 * One table drives every page: a file tool adds its row to FILE_CASES and gets the generated test below. The helpers
 * are written here, never imported from another spec (a shared test helper would make every importing spec run whole);
 * their shape is copied from e2e/archive-toolkit.spec.ts (own byte builders and recorder) and e2e/formatters.spec.ts.
 * The only thing a row may import from a shared test file is `writeZip` and `crc32` from ./fixture-files.
 */
const rel = (path: string) => path.replace(/^\//, '');

/** The text every file of this spec carries, and the text no request, message, storage entry or address may hold. */
const MARKER = 'FODT-DATA-CANARY';

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

function runButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

/**
 * Sets the radio and select controls of a row before any text is filled, because choosing a mode can show or hide
 * the fields that follow. A radio is clicked by its field name and value; a select is chosen by its id.
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

/** Everything the recorder has seen since it was started. */
interface Recording {
  requests: { url: string; method: string; postData: string }[];
  consoleTexts: string[];
  pageErrors: string[];
}

/** Starts recording every request (address, method and body), console message and page error from now on. */
function recordEverything(page: Page): Recording {
  const recording: Recording = { requests: [], consoleTexts: [], pageErrors: [] };
  page.on('request', (request) => {
    recording.requests.push({ url: request.url(), method: request.method(), postData: request.postData() ?? '' });
  });
  page.on('console', (message) => recording.consoleTexts.push(message.text()));
  page.on('pageerror', (error) => recording.pageErrors.push(error.message));
  return recording;
}

/** Whether a piece of text holds the marker, as written or percent-encoded. */
function holdsMarker(text: string): boolean {
  return text.includes(MARKER) || text.includes(encodeURIComponent(MARKER));
}

/**
 * Asserts the file went nowhere. Requests: each goes to the page's own origin or is a data or blob address, and none
 * holds the marker in its address or body. Messages: none holds the marker. Storage: localStorage, sessionStorage and
 * cookies hold no marker, the page address holds none, no IndexedDB database or Cache Storage entry exists, and the
 * private file system root has no entries (each only where the browser offers the interface).
 */
async function assertNothingLeft(page: Page, recording: Recording): Promise<void> {
  const origin = new URL(page.url()).origin;
  for (const request of recording.requests) {
    const own =
      request.url.startsWith('data:') || request.url.startsWith('blob:') || request.url.startsWith(`${origin}/`);
    expect(own, `a request left the page's own origin: ${request.method} ${request.url.slice(0, 80)}`).toBe(true);
    expect(holdsMarker(request.url), `a request address holds the marker: ${request.url.slice(0, 80)}`).toBe(false);
    expect(holdsMarker(request.postData), `a request body holds the marker: ${request.url.slice(0, 80)}`).toBe(false);
  }
  for (const text of [...recording.consoleTexts, ...recording.pageErrors]) {
    expect(holdsMarker(text), `a console message or page error holds the marker: ${text.slice(0, 80)}`).toBe(false);
  }
  expect(holdsMarker(page.url()), 'the page address holds the marker').toBe(false);
  expect(holdsMarker(JSON.stringify(await page.context().cookies())), 'a cookie holds the marker').toBe(false);

  const inPage = await page.evaluate(async () => {
    const read = (store: Storage): string => {
      const entries: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i) ?? '';
        entries.push(`${key}=${store.getItem(key) ?? ''}`);
      }
      return entries.join('\n');
    };
    const result = {
      local: read(window.localStorage),
      session: read(window.sessionStorage),
      databases: [] as string[],
      caches: [] as string[],
      privateFiles: [] as string[],
    };
    const indexed = window.indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> };
    if (typeof indexed.databases === 'function') {
      result.databases = (await indexed.databases()).map((db) => db.name ?? '(unnamed)');
    }
    if (typeof window.caches !== 'undefined') result.caches = await window.caches.keys();
    const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
    if (typeof storage?.getDirectory === 'function') {
      try {
        const root = await storage.getDirectory();
        // Iterating a directory handle is not in every TypeScript library the project builds with.
        const entries = (root as unknown as { keys: () => AsyncIterable<string> }).keys();
        for await (const name of entries) result.privateFiles.push(name);
      } catch {
        // A browser that refuses the private file system to this page has nothing stored in it by this page.
      }
    }
    return result;
  });
  expect(holdsMarker(inPage.local), 'localStorage holds the marker').toBe(false);
  expect(holdsMarker(inPage.session), 'sessionStorage holds the marker').toBe(false);
  expect(inPage.databases, 'an IndexedDB database exists').toEqual([]);
  expect(inPage.caches, 'a Cache Storage entry exists').toEqual([]);
  expect(inPage.privateFiles, 'the private file system holds entries').toEqual([]);
}

/** Bytes of a base64 text, so a binary file is written in the spec as readable text. */
function fromBase64(parts: string[]): Buffer {
  return Buffer.from(parts.join(''), 'base64');
}

/**
 * One file tool under test. `file` builds the file to pick; `radios` and `selects` are set first; `fill` holds the text
 * fields to fill (field name to value); `pressRun` says the page waits for a Run press; `expectText` is the text the
 * page must show from inside the file (it is MARKER for every row, so a leak would be found).
 */
interface FileCase {
  id: string;
  file: () => { name: string; mimeType: string; buffer: Buffer };
  radios?: Record<string, string>;
  selects?: Record<string, string>;
  fill?: Record<string, string>;
  pressRun: boolean;
  expectText: string;
}

/**
 * A SQLite database whose one row, notes(1, MARKER), holds the marker. Made once, from Python 3.14.3 with its SQLite
 * 3.50.4 (standard library only), by this script, and written here as the base64 of the resulting 1024 bytes:
 *
 *   import base64, sqlite3
 *   con = sqlite3.connect('notes.sqlite')
 *   con.execute('PRAGMA page_size=512')
 *   con.execute('CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)')
 *   con.execute("INSERT INTO notes(id, body) VALUES (1, 'FODT-DATA-CANARY')")
 *   con.commit(); con.close()
 *   print(base64.b64encode(open('notes.sqlite', 'rb').read()).decode('ascii'))
 */
const NOTES_SQLITE_BASE64 = [
  'U1FMaXRlIGZvcm1hdCAzAAIAAQEAQCAgAAAAAgAAAAIAAAAAAAAAAAAAAAEAAAAEAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAC6KFA0AAAABAbMAAbMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAASwEGFxcXAXd0YWJsZW5vdGVzbm90ZXMCQ1JFQVRFIFRBQkxFIG5vdGVzKGlkIElOVEVHRVIgUFJJTUFSWSBLRVksIGJv',
  'ZHkgVEVYVCkNAAAAAQHrAAHrAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABMBAwAt',
  'Rk9EVC1EQVRBLUNBTkFSWQ==',
];

const FILE_CASES: FileCase[] = [
  {
    id: 'sqlite-viewer',
    file: () => ({
      name: 'notes.sqlite',
      mimeType: 'application/vnd.sqlite3',
      buffer: fromBase64(NOTES_SQLITE_BASE64),
    }),
    fill: { sql: 'select body from notes;' },
    pressRun: true,
    expectText: MARKER,
  },
];

for (const c of FILE_CASES) {
  test(`${c.id}: a real file opened through the file picker is read in the page and nothing leaves it`, async ({
    page,
  }) => {
    await page.goto(rel(`/tools/${c.id}`));
    await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
    const recording = recordEverything(page);

    await setControls(page, c);
    await page.locator('#f-file').setInputFiles(c.file());
    for (const [name, value] of Object.entries(c.fill ?? {})) await page.locator(`#f-${name}`).fill(value);
    if (c.pressRun) await runButtonOf(page).click();
    await expect(outputArea(page)).toContainText(c.expectText, { timeout: 20_000 });

    // A moment for any request the result could trigger after it is shown.
    await page.waitForTimeout(500);
    await assertNothingLeft(page, recording);
  });
}
