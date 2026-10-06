import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { armCspProbe, describeFinding } from './csp-probe';

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

/** The members of a JSON Web Key that hold secret numbers. */
const JWK_SECRET_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi'];

/**
 * The secret lines the page shows: every line of 40 or more Base64 characters inside a block whose label says it is
 * private (the PEM bodies and the 70 column body of the OpenSSH private key), and every secret member of a private JWK
 * block that is at least 40 characters long (its d value, and for RSA p, q, dp, dq and qi). The test fails when none is
 * found, so a page that stopped showing its key cannot pass by looking for nothing.
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
    if (text.trim().startsWith('{')) {
      const jwk = JSON.parse(text) as Record<string, unknown>;
      for (const member of JWK_SECRET_MEMBERS) {
        const value = jwk[member];
        if (typeof value === 'string' && value.length >= 40) markers.push(value);
      }
    }
  }
  expect(markers.length, 'the private block holds no line of 40 or more Base64 characters').toBeGreaterThan(0);
  return markers;
}

// Base64 bodies of two throwaway keys made for tests (copied from tools/key-converter/test/fixtures/keys.ts; none is used
// anywhere). The armour is built from parts in the tests, never written whole.
const RSA_2048_PKCS8_LINES = [
  'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC8OD4NyBF1ojre',
  'GaB51UMcCeZ53WhAtNOlIK75dj+fIiv/CLYIVd6U8AYgKb1NLFJ/tFt9gb7RPOoZ',
  'HDEAZCbVcu0S9tnoh0iwzasN2+Rwg5AHYCO4QxCpQUpayAFodZarLdl/MKqn0mmt',
  'fhQsxyDif0vhJFVR5y4p7mEqWsqr8rpq6X/uXaQ3qMuDUy/v726lApZpF6RPngsQ',
  'RnCuUe3VvtH+oCRcrseToCn+SfLILJ3/jDj5mbN92HRInRyfhJYdUm4Z9bCoAhpF',
  'xnj+n6dpNCfs8I8UtJit36/etJQq/e1JTDW2pXn3YySPoKkVIskPOsQ4+lsIylaY',
  'xtpcRIuzAgMBAAECggEAA8yTfWi5PX7G9xOyWF3fIGeXa4Sguumgz1eftdusAL90',
  '/uKt9fDHG4oqvXx03I6/+DbrlSweGLrE3jk3nf083BhumPA69BrC81qmEL4MWDRi',
  'SbEoQhW3IODMqj9uPoMHxbBuZZxVstR9mz8NE4hOGB70qPiNm6fHF+6UBIGs+e0q',
  'nnR49K3WsNGzh0ROMgdj097AZMsnqm14xu665lvAa9cEmJ/6UOctngZx3DuLUo8U',
  'OR0Ojgd2Ty6WYPw+V38tD8ngBLJYH1q0eQSJsHn6527FeZnEU4+dkjbWX0bnlZqd',
  'pAuhtNyzhHggH083kRzf01gon871R3Qy4PgG0u3JsQKBgQDn8YUswYjxxJuAXb0I',
  'uCQUyu5jQsBxxxDnHos+EIUBexaqVwQkQytBCWQZ5vaPDPqWgdRSB6+TC96xppXB',
  '4YteaKWixwJVjqjdTJVDCofsCsPd7vor7WnhlV3/0SORr5lHExaSVZD6tNqhsBut',
  'L68VOMauUjnXOeOLGyhOBdLpEQKBgQDPvcjxQUFSTU2rdqQHm9yquhFPdcXWJFgC',
  'vbyFM6fPLcVjrxw4sjzSIuF7yP/PDXZSJ3MB3ETS8Xai0P/GplPv0YW1HpCABg/U',
  'TF+NS2dbn6eO2MqReKXOpFApPcwPtFjkyRskI22jYjYVpDQEo0c0MtT7jmRx7Jyc',
  'Xg+bNyLIgwKBgFkTf1LF7OL038d3uI5tsaWuncjPLPtFOS+Zol4ul/YOoJDApF2M',
  '0kLC6YetFMmxcVd1+uWaAArYBylw0ZjJFu4mAF64USQsipuausQpejPjmn9UNQ3D',
  'uuMgqx4A4skjiBkssoF2jRxLcp+f87EaXAIpcNwnxgDrQYD96Ae24t4RAoGBALp/',
  'Q60qiwzq70Z2LQ3TpAf1IOM39NKpMAXN9jeSxxzcl29FXk2b3bQ8sjbhnJ1yFX3t',
  'gnbyGytQsNO8U1MwMPyEGcge11THnGBX7BQ51GFR9CfugfSU3i2kH37WxqJ2orNJ',
  'w77uu1fJLIrDLhvXxW2cEM6A57XK2FIcs2AB4I0nAoGBAKrimYurAvkP0t4fsLjR',
  'mbN2qOv71Uht+I3jDyrogALERrOg682EDVG1ooJyjhtSVAsegdiKlyDr6gyrBUi7',
  '4AUgk/HP9PQSqMI3pqvAJt5BeIKRGVu4906QIIgP/BpdTuvJGnw30Q42DaVMHEbg',
  '4XNcPApM8ffLI6ZLLdlbkU/T',
];
const ED25519_OPENSSH_LINES = [
  'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW',
  'QyNTUxOQAAACC/cp/JIEDEtDIGhhy545tvJ0SuEdqDiMCaSJ4cL0SpZAAAAJBKvA5bSrwO',
  'WwAAAAtzc2gtZWQyNTUxOQAAACC/cp/JIEDEtDIGhhy545tvJ0SuEdqDiMCaSJ4cL0SpZA',
  'AAAEBd7g9NSqiupdGBDFhobOGQDwSLW0yMwgKUUu0NAUlA579yn8kgQMS0MgaGHLnjm28n',
  'RK4R2oOIwJpInhwvRKlkAAAAB2ZpeHR1cmUBAgMEBQY=',
];

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

/** The text of the output block whose label contains `label`. */
async function blockText(page: Page, label: string): Promise<string> {
  const block = outputArea(page)
    .locator('.output-block')
    .filter({ has: page.locator('.output-label', { hasText: label }) });
  return await block.locator('pre.output').first().innerText();
}

for (const c of KEY_CASES) {
  test(`key-converter: the ${c.name} JWK d value and every OpenSSH private body line are among the secrets looked for`, async ({
    page,
  }) => {
    await page.goto(rel('/tools/key-converter'));
    await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
    await setControls(page, { selects: { keyType: c.keyType } });
    await runButtonOf(page).click();
    await expect(outputArea(page)).toContainText('OpenSSH private key', { timeout: 30_000 });
    const markers = await privateMarkers(page);
    const jwk = JSON.parse(await blockText(page, 'Private key, JWK')) as { d: string };
    expect(markers, 'the d value of the private JWK is not among the markers').toContain(jwk.d);
    const sshLines = (await blockText(page, 'OpenSSH private key'))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[A-Za-z0-9+/=]{40,}$/.test(line));
    expect(sshLines.length, 'the OpenSSH private key shows no body line').toBeGreaterThan(0);
    for (const line of sshLines)
      expect(markers, 'an OpenSSH private body line is not among the markers').toContain(line);
  });
}

/**
 * Pasted keys. Each is put together here from Base64 pieces and armour built from parts, typed into the page in Convert
 * mode and run; the markers are the key's own body lines plus every secret line and member the page then shows.
 */
interface PastedCase {
  name: string;
  /** The pasted text, built from its pieces. */
  text: () => string;
  /** The Base64 lines of the key itself, which are looked for as well as what the page shows. */
  lines: string[];
  /** What the page says it read the paste as. */
  readAs: string;
}

const PASTED_CASES: PastedCase[] = [
  {
    name: 'RSA PKCS8',
    text: () =>
      '-----' +
      'BEGIN ' +
      'PRIVATE KEY-----\n' +
      RSA_2048_PKCS8_LINES.join('\n') +
      '\n-----' +
      'END ' +
      'PRIVATE KEY-----\n',
    lines: RSA_2048_PKCS8_LINES,
    readAs: 'PKCS#8 private key',
  },
  {
    name: 'OpenSSH',
    text: () =>
      '-----' +
      'BEGIN ' +
      'OPENSSH PRIVATE KEY-----\n' +
      ED25519_OPENSSH_LINES.join('\n') +
      '\n-----' +
      'END ' +
      'OPENSSH PRIVATE KEY-----\n',
    lines: ED25519_OPENSSH_LINES,
    readAs: 'OpenSSH private key',
  },
];

for (const c of PASTED_CASES) {
  test(`key-converter: a pasted ${c.name} private key never reaches a request, storage, the console, the title or the address`, async ({
    page,
  }) => {
    await page.goto(rel('/tools/key-converter'));
    await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

    // Recorded only after the page and its own chunk have loaded, so this asserts nothing leaves while the key is typed,
    // read and shown.
    const recording = recordEverything(page);

    await setControls(page, { radios: { mode: 'convert' } });
    await fillAndHold(page, 'input', c.text());
    await fillAndHold(page, 'comment', 'secret-check');
    await runButtonOf(page).click();
    await expect(outputArea(page)).toContainText('secret-check', { timeout: 30_000 });
    await expect(outputArea(page)).toContainText(c.readAs);

    const markers = [...c.lines, ...(await privateMarkers(page))];
    await assertNothingLeft(page, recording, markers);
  });
}

/**
 * Runs `body` with the address of a local HTTP server that records every request it receives, then waits a moment for a
 * stray request to land, and returns what the server saw. A certificate that names this server in the addresses it carries
 * (CRL, OCSP, CA issuers, policy statement, URI name) would show up here if the page requested one of them. Written here,
 * the shape copied from e2e/data-files.spec.ts.
 */
async function withRecordingServer(body: (address: string, port: number) => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    response.end('x');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await body(`http://127.0.0.1:${port}`, port);
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return seen;
}

// The DER of the certificate called canary in tools/certificate-decoder/test/fixtures/certs.ts, made by OpenSSL 3.5.5 with
// the recipe tools/certificate-decoder/test/fixtures/make-fixtures.sh (a P-256 certificate whose subject is
// CN=FODT-SECURITY-CANARY and whose CRL, OCSP, CA issuers, policy statement and URI name all use 127.0.0.1:65535).
const CANARY_DER_B64 = [
  'MIICijCCAjCgAwIBAgIUFwdJOn5g/Y5LdY92rZ4HMzcZfiwwCgYIKoZIzj0EAwIw',
  'HzEdMBsGA1UEAwwURk9EVC1TRUNVUklUWS1DQU5BUlkwHhcNMjYxMDAzMDQzODAw',
  'WhcNMzYwOTMwMDQzODAwWjAfMR0wGwYDVQQDDBRGT0RULVNFQ1VSSVRZLUNBTkFS',
  'WTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABFkWXKw1rwtfB5ostBPImPfCQvF3',
  'GWEYK3syNup3PAsaUarywX2rFwT8AB6gOhbLSivhYngMmI/Gd4HqZRCNHlajggFI',
  'MIIBRDAMBgNVHRMBAf8EAjAAMD4GA1UdEQQ3MDWCE2NhbmFyeS5leGFtcGxlLnRl',
  'c3SGHmh0dHA6Ly8xMjcuMC4wLjE6NjU1MzUvc2FuLXVyaTArBgNVHR8EJDAiMCCg',
  'HqAchhpodHRwOi8vMTI3LjAuMC4xOjY1NTM1L2NybDBmBggrBgEFBQcBAQRaMFgw',
  'JwYIKwYBBQUHMAGGG2h0dHA6Ly8xMjcuMC4wLjE6NjU1MzUvb2NzcDAtBggrBgEF',
  'BQcwAoYhaHR0cDovLzEyNy4wLjAuMTo2NTUzNS9pc3N1ZXIuY3J0MEAGA1UdIAQ5',
  'MDcwNQYJKwYBBAGGjR8BMCgwJgYIKwYBBQUHAgEWGmh0dHA6Ly8xMjcuMC4wLjE6',
  'NjU1MzUvY3BzMB0GA1UdDgQWBBSzFLM7ld8o0Jq2UqCEtSrG7hB/2zAKBggqhkjO',
  'PQQDAgNIADBFAiEAmT2zn85WO7jiw6Pll804a7BcT1PGRoRelDOTFdj7x7ICIEax',
  'ogjvYjOoPNhLyfc6VhA8ZBPpZDaCZlL8F+0Urr/6',
].join('');

/** The text of the host and port the canary certificate names, which the recording test replaces with the server's. */
const CANARY_HOST = '127.0.0.1:65535';

/**
 * The canary certificate's DER with its five addresses pointed at a local recording server. An ephemeral port always has
 * five digits, so the replacement keeps every length; the signature no longer matches, and the page never checks it.
 */
function canaryForServer(port: number): Buffer {
  const portText = String(port);
  expect(portText.length, 'the recording server did not get a five digit port').toBe(5);
  const bytes = Buffer.from(CANARY_DER_B64, 'base64');
  const needle = Buffer.from(CANARY_HOST);
  const replacement = Buffer.from(`127.0.0.1:${portText}`);
  expect(replacement.length).toBe(needle.length);
  let found = 0;
  for (let at = bytes.indexOf(needle); at >= 0; at = bytes.indexOf(needle, at + needle.length)) {
    replacement.copy(bytes, at);
    found++;
  }
  expect(found, 'the canary certificate names its address five times').toBe(5);
  return bytes;
}

const CANARY_SUBJECT = 'FODT-SECURITY-CANARY';

test('certificate-decoder: a certificate naming a local server in its CRL, OCSP, CA issuers, policy and URI fields is shown as text and the server receives nothing', async ({
  page,
}) => {
  // Armed before the page loads: the page policy refuses a request to any address the certificate names before it is
  // made, so a refused attempt shows only here, never at the recording server or as a request.
  const probe = await armCspProbe(page);
  const seen = await withRecordingServer(async (address, port) => {
    await page.goto(rel('/tools/certificate-decoder'));
    await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

    // Recorded only after the page and its own chunk have loaded, so this asserts nothing leaves while the certificate is
    // pasted, read and shown.
    const recording = recordEverything(page);

    await fillAndHold(page, 'input', canaryForServer(port).toString('base64'));
    await expect(outputArea(page)).toContainText(`CN=${CANARY_SUBJECT}`, { timeout: 20_000 });
    // Every address the certificate names is on the page as characters.
    for (const path of ['crl', 'ocsp', 'issuer.crt', 'cps', 'san-uri']) {
      await expect(outputArea(page)).toContainText(`${address}/${path}`);
    }
    // Nothing in the output can load or open an address: no link, image, frame, script, form, object or embedded content.
    expect(await outputArea(page).locator('img, iframe, script, link, form, a[href], object, embed').count()).toBe(0);

    await page.waitForTimeout(500);
    await assertNothingLeft(page, recording, [CANARY_SUBJECT]);
  });
  // The server the certificate names saw no request at all.
  expect(seen).toEqual([]);
  // And nothing tried one: the page raised no policy violation.
  expect(probe.findings().map(describeFinding), 'the page tried a request its policy refused').toEqual([]);
});

test('certificate-decoder: a DER certificate opened through the file picker is read in the page and nothing leaves it', async ({
  page,
}) => {
  await page.goto(rel('/tools/certificate-decoder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
  const recording = recordEverything(page);

  const der = Buffer.from(CANARY_DER_B64, 'base64');
  // The file is binary DER (it begins with the byte 0x30), so only a page that reads the picked bytes can show its subject.
  expect(der[0]).toBe(0x30);
  await page.locator('#f-file').setInputFiles({ name: 'canary.der', mimeType: 'application/pkix-cert', buffer: der });
  await expect(outputArea(page)).toContainText(`CN=${CANARY_SUBJECT}`, { timeout: 20_000 });
  await expect(outputArea(page)).toContainText('Certificates read');
  expect(await outputArea(page).locator('img, iframe, script, link, form, a[href], object, embed').count()).toBe(0);

  await page.waitForTimeout(500);
  // The subject, the first line of the certificate's Base64 and the file's own name are looked for everywhere.
  await assertNothingLeft(page, recording, [CANARY_SUBJECT, CANARY_DER_B64.slice(0, 60), 'canary.der']);
});

/** PEM armour built from parts, around Base64 lines; no whole armour line is ever written in this file. */
function armourOf(label: string, lines: string[]): string {
  return '-----' + 'BEGIN ' + label + '-----\n' + lines.join('\n') + '\n-----' + 'END ' + label + '-----\n';
}

/** The hex forms of a DER body that the page may show or be given: lower case, upper case and colon separated. */
function hexMarkers(der: Buffer, bytes: number): string[] {
  const hex = der.subarray(0, bytes).toString('hex');
  const colons = hex.match(/../g)!.join(':');
  return [hex, hex.toUpperCase(), colons.toUpperCase(), colons];
}

test('certificate-decoder: a certificate pasted as hex is read in the page, and its hex, its serial and its fingerprints never leave it', async ({
  page,
}) => {
  await page.goto(rel('/tools/certificate-decoder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
  const recording = recordEverything(page);

  // The certificate as a run of hex digits, the form a command that prints DER as hex gives.
  const der = Buffer.from(CANARY_DER_B64, 'base64');
  await fillAndHold(page, 'input', der.toString('hex'));
  await expect(outputArea(page)).toContainText(`CN=${CANARY_SUBJECT}`, { timeout: 20_000 });

  // What the page shows in hex: every fingerprint it prints (colon separated pairs), read from the page itself.
  const shown = await outputArea(page).innerText();
  const fingerprints = shown.match(/(?:[0-9A-F]{2}:){15,}[0-9A-F]{2}/g) ?? [];
  expect(fingerprints.length, 'the page shows no fingerprint').toBeGreaterThanOrEqual(3);
  const markers = [
    ...hexMarkers(der, 40),
    ...fingerprints,
    ...fingerprints.map((fingerprint) => fingerprint.replace(/:/g, '').toLowerCase()),
  ];

  await page.waitForTimeout(500);
  await assertNothingLeft(page, recording, markers);
});

test('certificate-decoder: a private key pasted beside a certificate is skipped, never shown, and never leaves the page', async ({
  page,
}) => {
  await page.goto(rel('/tools/certificate-decoder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
  const recording = recordEverything(page);

  const certificateLines = CANARY_DER_B64.match(/.{1,64}/g)!;
  const pasted = armourOf('CERTIFICATE', certificateLines) + armourOf('PRIVATE KEY', RSA_2048_PKCS8_LINES);
  await fillAndHold(page, 'input', pasted);
  await expect(outputArea(page)).toContainText(`CN=${CANARY_SUBJECT}`, { timeout: 20_000 });
  // The page says a private key block was skipped, and shows none of it.
  await expect(outputArea(page)).toContainText(/PRIVATE KEY block.*ignored and is not shown/);
  const shown = await outputArea(page).innerText();
  for (const line of RSA_2048_PKCS8_LINES)
    expect(shown.includes(line), 'a private key line is on the page').toBe(false);

  await page.waitForTimeout(500);
  await assertNothingLeft(page, recording, [CANARY_SUBJECT, ...RSA_2048_PKCS8_LINES]);
});

test('certificate-decoder: a private key pasted alone is not decoded, not shown, and never leaves the page', async ({
  page,
}) => {
  await page.goto(rel('/tools/certificate-decoder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
  const recording = recordEverything(page);

  await fillAndHold(page, 'input', armourOf('PRIVATE KEY', RSA_2048_PKCS8_LINES));
  // The page answers in words, whatever they are, and then the output holds none of the key.
  await expect(outputArea(page).locator('.issue-list, .note-info, .note-warn').first()).toBeVisible({
    timeout: 20_000,
  });
  const shown = await outputArea(page).innerText();
  for (const line of RSA_2048_PKCS8_LINES)
    expect(shown.includes(line), 'a private key line is on the page').toBe(false);
  expect(await outputArea(page).locator('pre.output').count()).toBe(0);

  await page.waitForTimeout(500);
  await assertNothingLeft(page, recording, RSA_2048_PKCS8_LINES);
});

// The RFC 4226 and RFC 6238 test secret (the ASCII text 12345678901234567890) as the Base32 text an app is given, written in
// groups of four so the typed text also shows that spaces are skipped.
const TOTP_SEED_GROUPED = 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ';

test('totp-generator: the secret, the otpauth link and the QR code never reach a request, storage, the console, the title or the address', async ({
  page,
}) => {
  await page.goto(rel('/tools/totp-generator'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  // Recorded only after the page and its own chunk have loaded, so this asserts nothing leaves while the secret is typed,
  // the codes are made and the link and its QR code are drawn.
  const recording = recordEverything(page);

  await setControls(page, { selects: { digits: '8' } });
  await fillAndHold(page, 'secret', TOTP_SEED_GROUPED);
  await fillAndHold(page, 'issuer', 'Example Corp');
  await fillAndHold(page, 'account', 'alice@example.com');
  await expect(outputArea(page)).toContainText('otpauth://totp/', { timeout: 20_000 });

  // The secret as typed, as one run of characters, the whole link the page shows and the value after secret=.
  const link = (await blockText(page, 'otpauth link')).trim();
  const secretParam = /[?&]secret=([A-Z2-7]+)/.exec(link)?.[1] ?? '';
  expect(secretParam.length, 'the link shows no secret parameter').toBeGreaterThanOrEqual(32);
  const markers = [TOTP_SEED_GROUPED, TOTP_SEED_GROUPED.replace(/ /g, ''), link, secretParam];

  // The QR code is an image whose source is a data address, so drawing it asks for nothing, and nothing in the output
  // offers to save, open or load anything: no download attribute, no link, no other image, one frame that allows nothing.
  const images = outputArea(page).locator('img');
  expect(await images.count(), 'one picture, the QR code').toBe(1);
  expect(await images.first().getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(await outputArea(page).locator('[download], a[href]').count(), 'something offers a download or a link').toBe(
    0,
  );
  // The seconds left are a countdown on the page itself (a timer with no live region), not a preview frame.
  expect(await outputArea(page).locator('iframe').count(), 'the output holds a frame').toBe(0);
  const countdown = outputArea(page).locator('.countdown');
  expect(await countdown.count(), 'one countdown').toBe(1);
  expect(await countdown.getAttribute('role'), 'the countdown is a timer').toBe('timer');
  expect(await outputArea(page).locator('script, link, form, object, embed').count()).toBe(0);

  await page.waitForTimeout(500);
  await assertNothingLeft(page, recording, markers);
});

test('totp-generator: with no time typed the codes come from this device clock', async ({ page }) => {
  // The page clock reads 59 seconds after 1970 and stays there, before the page loads, so the answer does not depend on
  // when the test runs.
  await page.clock.install({ time: 59_000 });
  await page.clock.setFixedTime(59_000);
  await page.goto(rel('/tools/totp-generator'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await setControls(page, { selects: { digits: '8' } });
  await fillAndHold(page, 'secret', TOTP_SEED_GROUPED);
  // Nothing was typed in At this time, so the only time source is the page clock: RFC 6238 Appendix B gives 94287082
  // for this secret, SHA-1 and 8 digits at 59 seconds.
  await expect(page.locator('#f-at')).toHaveValue('');
  await expect(outputArea(page)).toContainText("1970-01-01 00:00:59 UTC (this device's clock)", { timeout: 20_000 });
  await expect(outputArea(page).locator('tr', { hasText: 'current (step 1)' })).toContainText('94287082');
});

test('key-converter: an unexpected failure while a key is made shows one fixed sentence and none of the engine text', async ({
  page,
}) => {
  // The engine's key generator is made to fail with a text of its own, as a browser bug or an extension might. The page
  // must not show that text, because an engine message is not under this page's control.
  await page.addInitScript(() => {
    const subtle = window.crypto.subtle;
    const original = subtle.generateKey.bind(subtle) as (...args: unknown[]) => Promise<unknown>;
    (subtle as unknown as { generateKey: unknown }).generateKey = async (...args: unknown[]) => {
      if ((args[0] as { name?: string } | undefined)?.name === 'ECDSA') throw new Error('engine-failure-text-4417');
      return original(...args);
    };
  });
  await page.goto(rel('/tools/key-converter'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
  await setControls(page, { selects: { keyType: 'ecdsa-p256' } });
  await runButtonOf(page).click();
  await expect(outputArea(page).locator('.issue-list')).toContainText('The key could not be made.', {
    timeout: 30_000,
  });
  await expect(outputArea(page)).not.toContainText('engine-failure-text-4417');
});
