import { test, expect, type Page } from '@playwright/test';
import { writeZip } from './fixture-files';

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

/**
 * A one-sheet .xlsx package, built in the test as a store-only zip: A1 is an inline string holding the marker and B1 the
 * number 42. The parts are the ones ECMA-376 Part 1 (SpreadsheetML) needs, written as strings, so the file is real and
 * binary (a zip) while the spec carries no binary file.
 */
function markerWorkbook(): Buffer {
  const text = (value: string) => Uint8Array.from(Buffer.from(value, 'utf8'));
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const zip = writeZip([
    {
      name: '[Content_Types].xml',
      content: text(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
    },
    {
      name: '_rels/.rels',
      content: text(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      content: text(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: text(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: text(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${main}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${MARKER}</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>`,
      ),
    },
  ]);
  return Buffer.from(zip);
}

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
  {
    id: 'spreadsheet-converter',
    // The page's default mode reads a file, so no control is set first.
    file: () => ({
      name: 'marker.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: markerWorkbook(),
    }),
    pressRun: true,
    expectText: MARKER,
  },
  {
    id: 'hex-viewer',
    // The page runs as you type, so picking the file is the whole action; no control is set first. The marker is
    // exactly sixteen printable characters, so it is the whole text column of the first row, followed by the bytes 00 to 0f.
    file: () => ({
      name: 'marker.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.concat([Buffer.from(MARKER, 'ascii'), Buffer.from(Array.from({ length: 16 }, (_, i) => i))]),
    }),
    pressRun: false,
    expectText: MARKER,
  },
  {
    id: 'msgpack-cbor',
    // A CBOR text string: the head byte 0x70 is major type 3 (text) with length 16 (RFC 8949 section 3), and the
    // marker is exactly sixteen bytes. The page reads CBOR, so the format is chosen first; it runs as you type.
    file: () => ({
      name: 'marker.cbor',
      mimeType: 'application/cbor',
      buffer: Buffer.concat([Buffer.from([0x70]), Buffer.from(MARKER, 'ascii')]),
    }),
    radios: { format: 'cbor' },
    pressRun: false,
    expectText: MARKER,
  },
  {
    id: 'protobuf-decoder',
    // A message with one string field: the tag 0x0a is field 1 with the length-delimited wire type, and the length 0x10 is
    // sixteen, the size of the marker (encoding guide: a string is a LEN record). The page runs as you type.
    file: () => ({
      name: 'marker.pb',
      mimeType: 'application/octet-stream',
      buffer: Buffer.concat([Buffer.from([0x0a, 0x10]), Buffer.from(MARKER, 'ascii')]),
    }),
    pressRun: false,
    expectText: MARKER,
  },
  {
    id: 'text-encoding-fixer',
    // A legacy text file: the marker's ASCII bytes followed by the single byte 0x80, which the WHATWG Encoding Standard
    // decodes as windows-1252 to the euro sign (index-windows-1252.txt, pointer 0 is 0x20AC). Decode mode is chosen
    // first, windows-1252 is the page's default label, and the page runs as you type. Each browser decodes the
    // byte correctly by itself (the research measured Chromium, Firefox and WebKit), so this row proves the page path
    // end to end: the picked file is read in the page, shown with the right character, and goes nowhere.
    file: () => ({
      name: 'legacy.txt',
      mimeType: 'application/octet-stream',
      buffer: Buffer.concat([Buffer.from(MARKER, 'ascii'), Buffer.from([0x80])]),
    }),
    radios: { mode: 'decode' },
    pressRun: false,
    expectText: `${MARKER}€`,
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

/** The value shown beside a label in the page's list of facts (Name, Type, Size, Showing bytes). */
function factOf(page: Page, label: string) {
  return outputArea(page).locator(`dt:text-is("${label}") + dd`);
}

/** Fills a text field and checks the value stayed; a prerendered page can clear a field filled just after load. */
async function fillAndHold(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

test('hex-viewer: a file is paged with Go to byte and searched, and every match across read chunks is found and listed', async ({
  page,
}) => {
  await page.goto(rel('/tools/hex-viewer'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  // 200 KiB of zero bytes with the nine letters NEEDLEXYZ at three places: across the 64 KiB line (offset 65532, bytes
  // 65532 to 65540), across the 128 KiB line (131068) and as the last nine bytes (204791, which is 0x31ff7).
  const size = 200 * 1024;
  const file = Buffer.alloc(size);
  for (const at of [65532, 131068, size - 9]) file.write('NEEDLEXYZ', at, 'ascii');
  await page.locator('#f-file').setInputFiles({ name: 'big.bin', mimeType: 'application/octet-stream', buffer: file });

  // One page of rows from the start: 64 rows of 16 bytes, so bytes 0 to 1,023 of 204,800.
  await expect(outputArea(page)).toContainText('big.bin', { timeout: 20_000 });
  await expect(factOf(page, 'Showing bytes')).toHaveText('0 to 1,023 of 204,800 (64 rows of 16)');
  await expect(factOf(page, 'Size')).toHaveText('200.0 KB (204,800 bytes)');
  await expect(factOf(page, 'Type')).toHaveText('unknown');
  expect(await outputArea(page).locator('pre.output').innerText()).toMatch(/^00000000 {2}00 /);

  // Go to byte shows the last row only: the seven zero bytes and then the nine letters.
  await fillAndHold(page, 'position', String(size - 16));
  await expect(factOf(page, 'Showing bytes')).toHaveText(
    `${(size - 16).toLocaleString('en-US')} to 204,799 of 204,800 (64 rows of 16)`,
  );
  await expect(outputArea(page).locator('pre.output')).toContainText('|.......NEEDLEXYZ|');
  await expect(outputArea(page).locator('pre.output')).toContainText('00031ff0');

  // Searching lists all three matches, whichever chunks the browser reads the file in.
  await fillAndHold(page, 'search', 'NEEDLEXYZ');
  await expect(outputArea(page)).toContainText('Found 3 matches.', { timeout: 20_000 });
  const table = outputArea(page).locator('table');
  await expect(table).toContainText('0000fffc');
  await expect(table).toContainText('0001fffc');
  await expect(table).toContainText('00031ff7');
  await expect(table).toContainText('204791');

  // Match case on finds nothing for the wrong case; match case off finds all three again.
  await fillAndHold(page, 'search', 'needlexyz');
  await expect(outputArea(page)).toContainText('Found 0 matches.', { timeout: 20_000 });
  await page.locator('#f-matchCase').uncheck();
  await expect(outputArea(page)).toContainText('Found 3 matches.', { timeout: 20_000 });

  // A hex search for the same nine bytes finds the same three.
  await page.locator('#f-searchAs').selectOption('hex');
  await fillAndHold(page, 'search', '4e4545444c4558595a');
  await expect(outputArea(page)).toContainText('Found 3 matches.', { timeout: 20_000 });
  await expect(outputArea(page).locator('table')).toContainText('00031ff7');

  // Hex that is not pairs of digits is refused beside the rows, which stay.
  await fillAndHold(page, 'search', '4e4');
  await expect(outputArea(page).locator('.issue-list')).toContainText('Search for');
  await expect(outputArea(page).locator('.issue-list')).toContainText('character 3');
  await expect(outputArea(page).locator('pre.output')).toContainText('|.......NEEDLEXYZ|');
});

test('hex-viewer: a zero-byte file shows its name, size 0 B and type empty file with no rows, and a one-byte file shows one row at offset 00000000', async ({
  page,
}) => {
  await page.goto(rel('/tools/hex-viewer'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page
    .locator('#f-file')
    .setInputFiles({ name: 'empty.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) });
  await expect(outputArea(page)).toContainText('empty.bin', { timeout: 20_000 });
  await expect(factOf(page, 'Size')).toHaveText('0 B');
  await expect(factOf(page, 'Type')).toHaveText('empty file');
  await expect(factOf(page, 'Showing bytes')).toHaveText('none');
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);

  await page
    .locator('#f-file')
    .setInputFiles({ name: 'one.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('A', 'ascii') });
  await expect(outputArea(page)).toContainText('one.bin', { timeout: 20_000 });
  await expect(factOf(page, 'Size')).toHaveText('1 B');
  const rows = await outputArea(page).locator('pre.output').innerText();
  expect(rows.trim().split('\n')).toHaveLength(1);
  expect(rows).toMatch(/^00000000 {2}41 /);
  expect(rows).toContain('|A|');

  // A position past the last byte is refused naming Go to byte, and the empty file's only position is 0.
  await fillAndHold(page, 'position', '1');
  await expect(outputArea(page).locator('.issue-list')).toContainText('Go to byte is 1');
  await expect(outputArea(page).locator('.issue-list')).toContainText('past the end of 1 bytes');
});
