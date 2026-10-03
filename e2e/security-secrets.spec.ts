import { test, expect, type Page } from '@playwright/test';

/**
 * Behavioural proof, for the security tools of phase 14, that a key or a secret stays in the page (D-187): a private key
 * the page has just generated, a private key or a 2FA secret that was pasted, and an otpauth link, are never found in any
 * request address or body, in the console, in a page error, in the page address or title, in a cookie, in local or
 * session storage, in IndexedDB, in Cache Storage or in the private file system, and every request goes to the page's
 * own origin or is a data or blob address.
 *
 * Why a spec of its own and not the privacy harness: the harness types one fixed canary string into text fields and
 * cannot know the bytes of a key the page generates, so the spec reads the secret from the page after Run and then looks
 * for exactly those bytes everywhere. Editing the harness would also rerun every tool, which a changed-only push avoids.
 * The helpers are written here and never imported from another spec (a shared test helper would make every importing
 * spec run whole for every tool); their shape is copied from e2e/data-files.spec.ts, where the same checks look for a
 * fixed marker, and here they look for markers read from the page. Each tool of the phase adds its tests below, titled
 * with its id.
 */
const rel = (path: string) => path.replace(/^\//, '');

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

function runButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

/**
 * Sets the radio and select controls before any text is filled, because choosing a mode can show or hide the fields that
 * follow. A radio is clicked by its field name and value; a select is chosen by its id.
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
 * Fills a text field and checks the value stayed. The pages are prerendered, so a field filled in the first moments after
 * load can be cleared again when the page finishes starting; the fill is repeated until it holds.
 */
async function fillAndHold(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
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

/** Whether a piece of text holds any marker, as written or percent-encoded. */
function holdsAny(text: string, markers: string[]): boolean {
  return markers.some((marker) => text.includes(marker) || text.includes(encodeURIComponent(marker)));
}

/**
 * Asserts the secret went nowhere. Requests: each goes to the page's own origin or is a data or blob address, and none
 * holds a marker in its address or body. Messages: no console message or page error holds a marker. Everything else: the
 * page address, the document title, cookies, localStorage and sessionStorage hold none, no IndexedDB database or Cache
 * Storage entry exists, and the private file system root has no entries (each only where the browser offers the
 * interface). The list of markers must not be empty, so a silent pass is impossible.
 */
async function assertNothingLeft(page: Page, recording: Recording, markers: string[]): Promise<void> {
  expect(markers.length, 'there is no secret to look for').toBeGreaterThan(0);
  const origin = new URL(page.url()).origin;
  for (const request of recording.requests) {
    const own =
      request.url.startsWith('data:') || request.url.startsWith('blob:') || request.url.startsWith(`${origin}/`);
    expect(own, `a request left the page's own origin: ${request.method} ${request.url.slice(0, 80)}`).toBe(true);
    expect(holdsAny(request.url, markers), `a request address holds a secret: ${request.url.slice(0, 80)}`).toBe(false);
    expect(holdsAny(request.postData, markers), `a request body holds a secret: ${request.url.slice(0, 80)}`).toBe(
      false,
    );
  }
  for (const text of [...recording.consoleTexts, ...recording.pageErrors]) {
    expect(holdsAny(text, markers), 'a console message or page error holds a secret').toBe(false);
  }
  expect(holdsAny(page.url(), markers), 'the page address holds a secret').toBe(false);
  expect(holdsAny(await page.title(), markers), 'the document title holds a secret').toBe(false);
  expect(holdsAny(JSON.stringify(await page.context().cookies()), markers), 'a cookie holds a secret').toBe(false);

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
  expect(holdsAny(inPage.local, markers), 'localStorage holds a secret').toBe(false);
  expect(holdsAny(inPage.session, markers), 'sessionStorage holds a secret').toBe(false);
  expect(inPage.databases, 'an IndexedDB database exists').toEqual([]);
  expect(inPage.caches, 'a Cache Storage entry exists').toEqual([]);
  expect(inPage.privateFiles, 'the private file system holds entries').toEqual([]);
}

/**
 * The secret lines the page shows: every line of 40 or more Base64 characters inside a block whose label says it is
 * private. The test fails when none is found, so a page that stopped showing its key cannot pass by looking for nothing.
 */
async function privateMarkers(page: Page): Promise<string[]> {
  const blocks = outputArea(page)
    .locator('.output-block')
    .filter({ has: page.locator('.output-label', { hasText: /private/i }) });
  await expect(blocks.first(), 'no private block is shown').toBeVisible();
  const markers: string[] = [];
  for (const text of await blocks.locator('pre.output').allInnerTexts()) {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (/^[A-Za-z0-9+/=]{40,}$/.test(trimmed)) markers.push(trimmed);
    }
  }
  expect(markers.length, 'the private block holds no line of 40 or more Base64 characters').toBeGreaterThan(0);
  return markers;
}

/** One key kind under test: the name in the test title and the value of the key type menu. */
interface KeyCase {
  name: string;
  keyType: string;
}

const KEY_CASES: KeyCase[] = [
  { name: 'Ed25519', keyType: 'ed25519' },
  { name: 'ECDSA P-256', keyType: 'ecdsa-p256' },
  { name: 'RSA 2048', keyType: 'rsa-2048' },
];

for (const c of KEY_CASES) {
  test(`key-converter: a generated ${c.name} private key never reaches a request, storage, the console, the title or the address`, async ({
    page,
  }) => {
    await page.goto(rel('/tools/key-converter'));
    await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

    // Recorded only after the page and its own chunk have loaded, so this asserts nothing leaves while the key is made
    // and shown, not that the page itself loaded with zero requests.
    const recording = recordEverything(page);

    await setControls(page, { selects: { keyType: c.keyType } });
    await fillAndHold(page, 'comment', 'secret-check');
    await runButtonOf(page).click();
    await expect(outputArea(page)).toContainText('secret-check', { timeout: 30_000 });

    const markers = await privateMarkers(page);
    await assertNothingLeft(page, recording, markers);
  });
}
