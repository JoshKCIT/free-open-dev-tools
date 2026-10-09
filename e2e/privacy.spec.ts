import { test, expect, type Locator, type Page, type Request, type TestInfo } from '@playwright/test';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtureFiles, FIXTURE_FILE_KINDS } from './fixture-files';
import { buildInlineFiles, inlineFileProblems, MARKER_PLACEHOLDER, type InlineFixtureFile } from './fixture-inline';
import { armCspProbe, describeFinding } from './csp-probe';

/**
 * Paths below are written with a leading slash because it reads better.
 *
 * A leading slash resolves against the origin, which is wrong when the site
 * is served from a subdirectory, as it is on GitHub Pages. Stripping it makes
 * the path resolve against baseURL instead, so the same suite works against a
 * local preview at the root and against a deployment under a prefix.
 */
const rel = (path: string) => path.replace(/^\//, '');

/**
 * The privacy claim, checked rather than asserted.
 *
 * For every tool page this drives the real production build, types a unique
 * canary string and a distinctive numeric tracer into every control it can
 * reach, in every mode a radio/select/checkbox can put the page into, and
 * then fails if either value escaped through any channel: a network
 * request, storage, the URL, a cookie, or the console. It also fails if the
 * page made any network request at all while processing, whatever the
 * contents.
 *
 * A tool that leaks input here blocks the release.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const toolIds = readdirSync(join(root, 'apps', 'web', 'src', 'tools'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => f.replace(/\.ts$/, ''))
  .sort();

/** Distinctive enough that it cannot appear by accident in a bundle or a log. */
function canary(id: string): string {
  return `CANARY-7f3a91-${id}-d4e8b2`;
}

/**
 * A distinctive per-tool NEGATIVE INTEGER tracer (D-18 requires an integer,
 * never a fraction). Construction, pinned exactly because Task 3's mutation
 * check recomputes this value independently and compares it to what the
 * suite prints:
 *
 *   - the literal "-"
 *   - the fixed five-digit prefix 98765
 *   - six digits folded from the tool id: sum each character's code
 *     multiplied by its ONE-BASED position in the id, modulo 1,000,000,
 *     zero-padded to six digits.
 *
 * So numericCanary('random-number') is "-98765" followed by six digits,
 * eleven characters in total.
 *
 * It is an integer (not a fraction), it is negative -- which is how the
 * runaway-loop risk is handled without breaking D-18: a field that means a
 * count, a length, a repetition or a bit width either clamps a negative
 * value or rejects it outright, none of them loops on it -- and it is long
 * and unusual enough that finding it in storage, a cookie or a URL names the
 * page it came from unambiguously.
 */
function numericCanary(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i) * (i + 1);
  const fold = String(sum % 1000000).padStart(6, '0');
  return `-98765${fold}`;
}

interface Recorder {
  requests: Request[];
  consoleText: string[];
  arm(): void;
  /** The addresses of requests that started and have neither finished nor failed. Counted whether or not the recorder is armed. */
  inFlight(): string[];
  /** The time (Date.now) of the last request event: a start, a finish or a failure. Counted whether or not the recorder is armed. */
  lastRequestEventAt(): number;
}

async function instrument(page: Page): Promise<Recorder> {
  const requests: Request[] = [];
  const consoleText: string[] = [];
  let armed = false;
  // The page's requests in flight and the time of the last request event, counted from the same page request events
  // the leak check reads (the three listeners below are the only source), from the moment the recorder exists.
  const pending = new Set<Request>();
  let lastEventAt = Date.now();

  page.on('request', (request) => {
    pending.add(request);
    lastEventAt = Date.now();
    if (armed) requests.push(request);
  });
  page.on('requestfinished', (request) => {
    pending.delete(request);
    lastEventAt = Date.now();
  });
  page.on('requestfailed', (request) => {
    pending.delete(request);
    lastEventAt = Date.now();
  });
  page.on('console', (msg) => {
    if (armed) consoleText.push(msg.text());
  });
  page.on('pageerror', (err) => {
    if (armed) consoleText.push(`pageerror: ${err.message}`);
  });

  return {
    requests,
    consoleText,
    arm() {
      armed = true;
    },
    inFlight() {
      return Array.from(pending, (request) => request.url());
    },
    lastRequestEventAt() {
      return lastEventAt;
    },
  };
}

/**
 * Waits until the page has had no request in flight for `quietMs`, judged from the requests the recorder saw.
 *
 * This replaces Playwright's own network idle wait for the last wait of a privacy test. That wait stops its timer when a
 * request starts after the page first went idle and does not start it again while the idle state is still recorded, and a
 * frame that attaches afterwards then removes the idle state for good. A page that runs a worker (every worker asks the
 * main frame for a blob address) and then shows a preview frame ends in exactly that state, and the wait never returns.
 * This is the same rule, no request in flight for 500 ms, computed from the request events the leak check already reads,
 * so it cannot be fooled by the order in which requests and frames come and go. It only waits: it adds nothing to what
 * counts as a leak, and a request the page makes while it waits is recorded as always.
 *
 * It is bounded: after `timeoutMs` it fails naming the page and the addresses still in flight, as the idle wait it
 * replaces would also have failed.
 */
async function waitForQuietNetwork(
  page: Page,
  recorder: Recorder,
  options: { quietMs: number; timeoutMs?: number },
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  for (;;) {
    if (recorder.inFlight().length === 0 && Date.now() - recorder.lastRequestEventAt() >= options.quietMs) return;
    if (Date.now() > deadline) {
      throw new Error(
        `The network on ${page.url()} was not quiet after ${options.timeoutMs ?? 60_000} ms; still in flight: ${recorder.inFlight().join(', ') || 'nothing, but requests kept starting'}`,
      );
    }
    await page.waitForTimeout(50);
  }
}

/**
 * Everything the page could have written locally that we can read back.
 *
 * The `idb:<name>` line is the original, unchanged check. Everything after
 * it is additive: for each database it also opens it read-only, enumerates
 * every object store, and reads every record with `getAll()`, bounded to a
 * small cap per store so a page that never uses IndexedDB -- which is all of
 * them today -- costs nothing beyond the `databases()` call itself. Wrapped
 * in its own try/catch so an engine that cannot do this degrades to the
 * database-name line only, rather than failing the suite.
 */
async function readStorage(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const parts: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        parts.push(`local:${key}=${localStorage.getItem(key)}`);
      }
    } catch {
      /* storage may be blocked */
    }
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i)!;
        parts.push(`session:${key}=${sessionStorage.getItem(key)}`);
      }
    } catch {
      /* storage may be blocked */
    }
    parts.push(`cookie:${document.cookie}`);
    try {
      const databases = (await indexedDB.databases?.()) ?? [];
      for (const db of databases) {
        parts.push(`idb:${db.name}`);
        if (!db.name) continue;
        try {
          const opened = await new Promise<IDBDatabase | null>((resolve) => {
            const req = indexedDB.open(db.name!);
            const timer = setTimeout(() => resolve(null), 1000);
            req.onsuccess = () => {
              clearTimeout(timer);
              resolve(req.result);
            };
            req.onerror = () => {
              clearTimeout(timer);
              resolve(null);
            };
            req.onblocked = () => {
              clearTimeout(timer);
              resolve(null);
            };
          });
          if (!opened) continue;
          for (const storeName of Array.from(opened.objectStoreNames)) {
            try {
              const tx = opened.transaction(storeName, 'readonly');
              const store = tx.objectStore(storeName);
              const records = await new Promise<unknown[]>((resolve) => {
                const req = store.getAll(undefined, 50);
                req.onsuccess = () => resolve((req.result as unknown[]) ?? []);
                req.onerror = () => resolve([]);
              });
              for (const record of records) {
                parts.push(`idb-record:${db.name}/${storeName}=${JSON.stringify(record)}`);
              }
            } catch {
              /* a store that cannot be read this way is skipped, not fatal */
            }
          }
          opened.close();
        } catch {
          /* an engine that cannot do this degrades to the database-name line above */
        }
      }
    } catch {
      /* not supported everywhere */
    }
    return parts.join('\n');
  });
}

/**
 * Fills every visible text-like input with `textValue` and every visible
 * number input with `numericValue`. Widened from the original text-only
 * version so number fields -- never canary-tested before this plan -- are
 * covered too.
 */
async function fillVisibleInputs(
  page: Page,
  textValue: string,
  numericValue: string,
): Promise<{ text: number; number: number }> {
  const textInputs = page.locator(
    'main textarea, main input[type="text"], main input[type="search"], main input:not([type])',
  );
  let text = 0;
  const textCount = await textInputs.count();
  for (let i = 0; i < textCount; i++) {
    const field = textInputs.nth(i);
    if (!(await field.isVisible())) continue;
    if (!(await field.isEditable())) continue;
    await field.fill(textValue);
    text++;
  }

  const numberInputs = page.locator('main input[type="number"]');
  let number = 0;
  const numberCount = await numberInputs.count();
  for (let i = 0; i < numberCount; i++) {
    const field = numberInputs.nth(i);
    if (!(await field.isVisible())) continue;
    if (!(await field.isEditable())) continue;
    await field.fill(numericValue);
    number++;
  }

  return { text, number };
}

/**
 * A discovered, driveable control state: a radio option, one of a checkbox's
 * two states, one option of a select, or a range moved to its maximum.
 * `field` is the stable identity -- a radio's `name`, or the `f-<name>`
 * element id ToolRunner.tsx assigns every other control type, with the
 * `f-` prefix stripped.
 */
interface ControlState {
  kind: 'radio' | 'checkbox' | 'select' | 'range';
  field: string;
  value: string;
  key: string;
}

interface QueuedState extends ControlState {
  /** The ordered control states that were in effect, beyond page defaults, when this was discovered. */
  prerequisites: ControlState[];
}

/** Every driveable control state visible right now, scanned from scratch. */
async function scanControlStates(page: Page): Promise<ControlState[]> {
  const main = page.locator('main');
  const states: ControlState[] = [];

  const radios = main.locator('input[type="radio"]');
  const radioCount = await radios.count();
  const seenRadioKeys = new Set<string>();
  for (let i = 0; i < radioCount; i++) {
    const el = radios.nth(i);
    if (!(await el.isVisible())) continue;
    const field = await el.getAttribute('name');
    const value = await el.getAttribute('value');
    if (field === null || value === null) continue;
    const key = `radio:${field}=${value}`;
    if (seenRadioKeys.has(key)) continue;
    seenRadioKeys.add(key);
    states.push({ kind: 'radio', field, value, key });
  }

  const checkboxes = main.locator('input[type="checkbox"]');
  const checkboxCount = await checkboxes.count();
  for (let i = 0; i < checkboxCount; i++) {
    const el = checkboxes.nth(i);
    if (!(await el.isVisible())) continue;
    const id = await el.getAttribute('id');
    if (!id || !id.startsWith('f-')) continue;
    const field = id.slice(2);
    for (const value of ['true', 'false']) {
      states.push({ kind: 'checkbox', field, value, key: `checkbox:${field}=${value}` });
    }
  }

  const selects = main.locator('select');
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount; i++) {
    const el = selects.nth(i);
    if (!(await el.isVisible())) continue;
    const id = await el.getAttribute('id');
    if (!id || !id.startsWith('f-')) continue;
    const field = id.slice(2);
    const options = el.locator('option');
    const optionCount = await options.count();
    for (let j = 0; j < optionCount; j++) {
      const value = await options.nth(j).getAttribute('value');
      if (value === null) continue;
      states.push({ kind: 'select', field, value, key: `select:${field}=${value}` });
    }
  }

  const ranges = main.locator('input[type="range"]');
  const rangeCount = await ranges.count();
  for (let i = 0; i < rangeCount; i++) {
    const el = ranges.nth(i);
    if (!(await el.isVisible())) continue;
    const id = await el.getAttribute('id');
    if (!id || !id.startsWith('f-')) continue;
    const field = id.slice(2);
    const max = (await el.getAttribute('max')) ?? '';
    states.push({ kind: 'range', field, value: max, key: `range:${field}=max` });
  }

  return states;
}

function locateControl(page: Page, state: ControlState) {
  const main = page.locator('main');
  const escaped = (s: string) => s.replace(/"/g, '\\"');
  if (state.kind === 'radio') {
    return main.locator(`input[type="radio"][name="${escaped(state.field)}"][value="${escaped(state.value)}"]`);
  }
  return main.locator(`#f-${escaped(state.field)}`);
}

/** Applies a control state if its control is currently visible. Returns whether it was. */
async function applyState(page: Page, state: ControlState): Promise<boolean> {
  const locator = locateControl(page, state);
  if ((await locator.count()) === 0) return false;
  const el = locator.first();
  if (!(await el.isVisible())) return false;

  switch (state.kind) {
    case 'radio':
      await el.check();
      break;
    case 'checkbox':
      if (state.value === 'true') await el.check();
      else await el.uncheck();
      break;
    case 'select':
      await el.selectOption(state.value);
      break;
    case 'range':
      await el.fill(state.value);
      break;
  }
  return true;
}

/**
 * Attaches a small synthetic file, whose BYTES are the canary itself, to
 * every visible file input. Making the file's contents the canary turns the
 * file path into a real test of whether file contents escape, rather than
 * just whether a file was picked.
 */
async function attachCanaryFiles(page: Page, value: string): Promise<number> {
  const fileInputs = page.locator('main input[type="file"]');
  const count = await fileInputs.count();
  let attached = 0;
  for (let i = 0; i < count; i++) {
    const field = fileInputs.nth(i);
    if (!(await field.isVisible())) continue;
    await field.setInputFiles({
      name: 'canary.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(value, 'utf8'),
    });
    attached++;
  }
  return attached;
}

/**
 * Attaches real files built by `buildFixtureFiles` (e2e/fixture-files.ts),
 * carrying `marker`, to the first visible file input -- every file goes to
 * that one input, since a page whose own contract accepts more than one
 * file reads them all from a single `multiple` input. Used only when a
 * fixture names `file`; reaches a file tool's real processing path with a
 * file its own header check actually accepts, which the synthetic text
 * file `attachCanaryFiles` sends would be refused before ever reaching.
 */
async function attachRealFixtureFiles(page: Page, kinds: string, marker: string): Promise<number> {
  const fileInputs = page.locator('main input[type="file"]');
  const count = await fileInputs.count();
  const built = buildFixtureFiles(kinds, marker);
  for (let i = 0; i < count; i++) {
    const field = fileInputs.nth(i);
    if (!(await field.isVisible())) continue;
    await field.setInputFiles(
      built.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.buffer) })),
    );
    return built.length;
  }
  return 0;
}

/**
 * Attaches the inline files of a fixture entry (`inlineFiles`, e2e/fixture-inline.ts), built with `marker` (the
 * page's canary) wherever a text file holds `{{MARKER}}`. One file, or a first visible file input that is `multiple`:
 * like `attachRealFixtureFiles`, every file goes to that first visible input. Several files and a first visible input
 * that takes one file (a page with one field per picture, such as two pictures to compare): the files go one to each
 * visible file input, in order, and more files than visible inputs fails the test naming the page. (A single-file input
 * refuses a list of several files outright, so no fixture could have relied on the first input taking them all.)
 */
async function attachInlineFixtureFiles(page: Page, files: InlineFixtureFile[], marker: string): Promise<number> {
  const fileInputs = page.locator('main input[type="file"]');
  const count = await fileInputs.count();
  const built = buildInlineFiles(files, marker).map((f) => ({
    name: f.name,
    mimeType: f.mimeType,
    buffer: Buffer.from(f.buffer),
  }));
  const visible: Locator[] = [];
  for (let i = 0; i < count; i++) {
    const field = fileInputs.nth(i);
    if (await field.isVisible()) visible.push(field);
  }
  const first = visible[0];
  if (!first) return 0;
  if (built.length === 1 || (await first.evaluate((el) => (el as HTMLInputElement).multiple))) {
    await first.setInputFiles(built);
    return built.length;
  }
  if (built.length > visible.length) {
    throw new Error(
      `${built.length} inline files for ${visible.length} visible file inputs that each take one file on ${page.url()}`,
    );
  }
  for (const [i, file] of built.entries()) await visible[i]!.setInputFiles(file);
  return built.length;
}

/**
 * Presses the Run button if this state rendered one, and waits for it to
 * return to its idle label -- a precise finish signal, not a sleep, because
 * the button reads the "Working…" label for the whole run
 * (ToolRunner.tsx:302) and only flips back once `execute()` resolves. A page
 * that runs as-you-type (`autoRun` true) renders no such button; that is not
 * a failure, there is simply nothing to press.
 *
 * Located by CSS class rather than accessible name, because the button's own
 * accessible name toggles between "Run" and "Working…" while it runs, which
 * would make a name-based locator stop matching the moment it is clicked.
 */
async function pressRunIfPresent(page: Page): Promise<boolean> {
  const button = page.locator('main div.toolbar button.button-primary');
  if ((await button.count()) === 0) return false;
  if (!(await button.first().isVisible())) return false;
  await button.first().click();
  await expect(button.first()).toHaveText('Run', { timeout: 60_000 });
  return true;
}

/**
 * A valid-scenario fixture: input that is actually valid for a page, so its
 * real processing path runs rather than only its input-rejection path. A
 * canary string is not valid input everywhere -- `luhn`'s parser rejects
 * anything that is not a digit or separator, so the tracer pass alone never
 * reaches its checksum. The rule for whether a page needs an entry: it does
 * when the canary string or the numeric tracer is not valid input for its
 * primary field, i.e. when the tracer pass would reach only that page's
 * input-rejection path. A page not in this table gets the tracer pass only,
 * which is correct when its canary input is already valid.
 */
interface FixtureEntry {
  /** A radio option or select value to select first, if the tool needs a specific mode. */
  mode?: { field: string; value: string };
  /** Field values to type, keyed by field name (the `f-<field>` element id). */
  values?: Record<string, string>;
  /** Whether this page has a file input at all. Pages with none must attach zero files. */
  attachesFile: boolean;
  /**
   * A comma-separated list of `FIXTURE_FILE_KINDS` (e2e/fixture-files.ts):
   * when set, the fixture pass attaches real files of these kinds (built
   * with the canary as marker) instead of the synthetic canary text file
   * `attachCanaryFiles` always sends, reaching a file tool's real
   * processing path with a file its own header check actually accepts.
   */
  file?: string;
  /**
   * Real files carried inline in the fixture JSON (e2e/fixture-inline.ts: `name`, `mimeType` and one of `base64` or
   * `text`, where `{{MARKER}}` in a text file becomes the page's canary). Used instead of `file`, with
   * `attachesFile: true`: lets a tool with its own file format ship a fixture with no shared edit.
   */
  inlineFiles?: InlineFixtureFile[];
}

/**
 * The JWT page's asymmetric fixture: a P-256 key whose private number is the SHA-256 of a fixed phrase, so it is the
 * same key on every run (the typed values, and so the coverage report, stay comparable between runs) and it is test
 * data, not a secret; it is built here rather than kept as key text. The verify token's header and payload, which
 * carry the page's canary, are rebuilt on every run; its ES256 signature was made once with this key and is kept as
 * text, because an ECDSA signature is random and a new one each run would change the typed values.
 */
const JWT_FIXTURE = (() => {
  const privateNumber = createHash('sha256')
    .update('free-open-dev-tools privacy fixture: jwt-signature ES256')
    .digest();
  // SEC 1 ECPrivateKey: version 1, the 32-byte private number, and the named curve prime256v1.
  const der = Buffer.concat([
    Buffer.from('30310201010420', 'hex'),
    privateNumber,
    Buffer.from('a00a06082a8648ce3d030107', 'hex'),
  ]);
  const key = createPrivateKey({ key: der, format: 'der', type: 'sec1' });
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    privatePem: key.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString(),
    token: [
      part({ alg: 'ES256', typ: 'JWT' }),
      part({ sub: canary('jwt-signature'), iat: 1767225600 }),
      'dJWvtWS9ok3Vq2v9xt_tC1qcxkewy62cUFITd1WjyMb8isjrjF4M6Anp2uFVnQMBzhGpv-33fbHhiKkezBuF0w',
    ].join('.'),
  };
})();

const BUILT_IN_FIXTURES: Record<string, FixtureEntry[]> = {
  // Encode mode with a synthetic file attached: reaches file reading and
  // media-type sniffing instead of the invalid-URI rejection.
  'data-uri': [{ mode: { field: 'direction', value: 'encode' }, attachesFile: true }],
  // A synthetic file attached with at least one algorithm selected: reaches the worker.
  'hash-file': [{ attachesFile: true }],
  // Hash mode, a real password, cost at its maximum: reaches the second
  // worker and the above-threshold path the malformed-hash rejection in
  // Verify mode never touches.
  bcrypt: [
    {
      mode: { field: 'mode', value: 'hash' },
      values: { password: 'correct horse battery staple', cost: '15' },
      attachesFile: false,
    },
  ],
  // Generate mode: reaches generate() (tools/uuid/src/index.ts:305) rather
  // than the invalid-UUID return in Inspect mode.
  uuid: [{ mode: { field: 'mode', value: 'generate' }, attachesFile: false }],
  // Three entries, because one successful path is not every successful path:
  // (a) Sign, HMAC, a shared secret and a payload carrying the canary as a
  // claim value; (b) Sign, an asymmetric algorithm with its private key,
  // exercising key import; (c) Verify, with a token and public key that
  // actually verify, exercising the signature check rather than only the
  // token-format rejection. The key and token are built in JWT_FIXTURE.
  'jwt-signature': [
    { mode: { field: 'mode', value: 'sign' }, values: { algorithm: 'HS256' }, attachesFile: false },
    {
      mode: { field: 'mode', value: 'sign' },
      values: { algorithm: 'ES256', keyFormat: 'pem-private', pemPrivateKey: JWT_FIXTURE.privatePem },
      attachesFile: false,
    },
    {
      mode: { field: 'mode', value: 'verify' },
      values: {
        algorithm: 'ES256',
        token: JWT_FIXTURE.token,
        keyFormat: 'pem-public',
        pemPublicKey: JWT_FIXTURE.publicPem,
      },
      attachesFile: false,
    },
  ],
  // A published, widely-reproduced Luhn-valid test number, so the checksum
  // path runs rather than the not-a-digit-or-separator rejection.
  luhn: [{ values: { input: '79927398713' }, attachesFile: false }],
  'password-generator': [{ attachesFile: false }],
  'random-string': [{ attachesFile: false }],
  'random-number': [{ attachesFile: false }],
};

/**
 * Per-tool valid-scenario fixture files, one per id, under
 * `e2e/privacy-fixtures/<id>.json`. This is what lets a later plan register
 * its own fixture without editing this file at all (Phase 3's own
 * shared_procedure, step 7): the file's name is the tool id, and its content
 * is a JSON array in the exact shape of `FixtureEntry[]`.
 *
 * Every entry must be an object with a boolean `attachesFile` and no key
 * outside `FixtureEntry`, every field must have its declared shape, and a
 * file's id must not already be declared in `BUILT_IN_FIXTURES` -- all are
 * structural mistakes that should fail loudly at collection time, naming the
 * file, not be silently ignored. (A misspelt `inlineFile` would otherwise load,
 * attach the synthetic canary file instead and pass without ever reaching the
 * tool's real file path.)
 */
function loadPrivacyFixtureFiles(): Record<string, FixtureEntry[]> {
  const dir = join(root, 'e2e', 'privacy-fixtures');
  if (!existsSync(dir)) return {};

  const result: Record<string, FixtureEntry[]> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const id = file.replace(/\.json$/, '');
    if (id in BUILT_IN_FIXTURES) {
      throw new Error(`e2e/privacy-fixtures/${file} declares an id ("${id}") already in BUILT_IN_FIXTURES.`);
    }
    const raw: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error(`e2e/privacy-fixtures/${file} must be a non-empty JSON array of fixture entries.`);
    }
    const entryProblems = raw.flatMap((entry: unknown, index) => privacyEntryProblems(file, index, entry));
    if (entryProblems.length > 0) throw new Error(entryProblems.join('\n'));
    result[id] = raw as FixtureEntry[];
  }
  return result;
}

/** The keys a privacy fixture entry may hold: exactly the fields of `FixtureEntry`. */
const ENTRY_KEYS = new Set(['mode', 'values', 'attachesFile', 'file', 'inlineFiles']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Every problem with one fixture entry, each naming the fixture file and the entry: a value that is not an object,
 * an unknown key (a misspelling would otherwise be ignored), `attachesFile` that is not a boolean, a `mode` that is
 * not `{ field, value }` strings, `values` that do not map field names to strings, a `file` that names no known
 * fixture file kind, and the inline file rules. An entry with `file` or `inlineFiles` must declare
 * `attachesFile: true`, and must not give both (they are two ways to say the same thing).
 */
function privacyEntryProblems(file: string, index: number, entry: unknown): string[] {
  const where = `e2e/privacy-fixtures/${file}: entry ${index}`;
  if (!isPlainObject(entry)) return [`${where} must be an object with a boolean "attachesFile"`];
  const problems = Object.keys(entry)
    .filter((key) => !ENTRY_KEYS.has(key))
    .map((key) => `${where} has an unknown key "${key}" (allowed: ${[...ENTRY_KEYS].join(', ')})`);
  if (typeof entry.attachesFile !== 'boolean') problems.push(`${where}.attachesFile must be true or false`);
  if (entry.mode !== undefined) {
    const mode = entry.mode;
    if (
      !isPlainObject(mode) ||
      typeof mode.field !== 'string' ||
      typeof mode.value !== 'string' ||
      Object.keys(mode).some((key) => key !== 'field' && key !== 'value')
    ) {
      problems.push(`${where}.mode must be { "field": <string>, "value": <string> } and nothing else`);
    }
  }
  if (entry.values !== undefined) {
    if (!isPlainObject(entry.values) || Object.values(entry.values).some((value) => typeof value !== 'string')) {
      problems.push(`${where}.values must map field names to strings`);
    }
  }
  if (entry.file !== undefined) {
    // Read the way `buildFixtureFiles` reads it: comma-separated, trimmed, empty pieces ignored.
    const kinds =
      typeof entry.file === 'string'
        ? entry.file
            .split(',')
            .map((kind) => kind.trim())
            .filter((kind) => kind.length > 0)
        : [];
    const unknown = kinds.filter((kind) => !(FIXTURE_FILE_KINDS as readonly string[]).includes(kind));
    if (typeof entry.file !== 'string' || kinds.length === 0 || unknown.length > 0) {
      problems.push(
        `${where}.file must be a comma-separated list of fixture file kinds${unknown.length > 0 ? ` (unknown: ${unknown.map((kind) => JSON.stringify(kind)).join(', ')})` : ''}`,
      );
    }
    if (entry.attachesFile !== true) problems.push(`${where} has file but attachesFile is not true`);
  }
  if (Object.prototype.hasOwnProperty.call(entry, 'inlineFiles')) {
    problems.push(...inlineFileProblems(entry.inlineFiles, `${where}.inlineFiles`));
    if (entry.attachesFile !== true) problems.push(`${where} has inlineFiles but attachesFile is not true`);
    if (entry.file !== undefined) problems.push(`${where} has both file and inlineFiles: give one`);
    // A text file is where the canary goes: an entry that carries text must carry the marker in at least one text file,
    // or a leak of that file's content could not be found. Base64 files carry bytes, so an all-base64 entry is fine.
    const texts = Array.isArray(entry.inlineFiles)
      ? entry.inlineFiles.filter((f): f is { text: string } => isPlainObject(f) && typeof f.text === 'string')
      : [];
    if (texts.length > 0 && !texts.some((f) => f.text.includes(MARKER_PLACEHOLDER))) {
      problems.push(
        `${where}.inlineFiles has text files but none holds ${MARKER_PLACEHOLDER}, so a leak of them could not be found`,
      );
    }
  }
  return problems;
}

const VALID_SCENARIO_FIXTURES: Record<string, FixtureEntry[]> = {
  ...BUILT_IN_FIXTURES,
  ...loadPrivacyFixtureFiles(),
};

/**
 * A page with valid-scenario fixture entries passes its privacy test only when EVERY entry completed its run, not when
 * any one did (the coverage report counts the entries and lists, by 1-based position, each one that never completed).
 * An entry that cannot complete by design is named here, by tool id, with the 1-based positions of those entries and the
 * reason, and only then does the test excuse it. The list is empty: when the rule was added, six pages had an entry that
 * never completed (a field left holding the harness marker, or a synthetic file the page cannot read), and every one of
 * them was wrong rather than stopping by design, so each was fixed in that tool's own fixture file. Put an entry here
 * only for one that, by design, stops before its run completes, and say why in the reason.
 */
const FIXTURE_ENTRIES_THAT_STOP: Record<string, { positions: number[]; reason: string }> = {};

test('every privacy fixture file is loaded and names a real tool page', () => {
  const dir = join(root, 'e2e', 'privacy-fixtures');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    expect(
      Object.prototype.hasOwnProperty.call(VALID_SCENARIO_FIXTURES, id),
      `e2e/privacy-fixtures/${file} was not merged into VALID_SCENARIO_FIXTURES under the id "${id}"`,
    ).toBe(true);
    expect(
      toolIds,
      `e2e/privacy-fixtures/${file} names a tool id ("${id}") with no page in apps/web/src/tools`,
    ).toContain(id);
  }
});

test('a malformed privacy fixture entry or inline file is refused, naming the file', () => {
  const good = { name: 'a.bin', mimeType: 'application/octet-stream', base64: 'AA==' };
  const text = { name: 'a.txt', mimeType: 'text/plain', text: 'no marker here' };
  const accepted: [string, unknown][] = [
    ['an inline base64 file', { attachesFile: true, inlineFiles: [good] }],
    ['no file at all', { attachesFile: false }],
    ['a mode and values', { mode: { field: 'mode', value: 'hash' }, values: { input: 'x' }, attachesFile: false }],
    ['two fixture file kinds', { attachesFile: true, file: 'pdf, png' }],
    ['a text file holding the marker', { attachesFile: true, inlineFiles: [{ ...text, text: 'a {{MARKER}}' }] }],
    ['a marker in one text file of two', { attachesFile: true, inlineFiles: [text, { ...text, text: '{{MARKER}}' }] }],
  ];
  for (const [what, entry] of accepted) {
    expect(privacyEntryProblems('x.json', 0, entry), `${what} must be accepted`).toEqual([]);
  }
  const refused: [string, unknown, string][] = [
    ['an empty inlineFiles array', { attachesFile: true, inlineFiles: [] }, 'inlineFiles'],
    ['both base64 and text', { attachesFile: true, inlineFiles: [{ ...good, text: 'x' }] }, 'both base64'],
    [
      'neither base64 nor text',
      { attachesFile: true, inlineFiles: [{ name: 'a', mimeType: 'text/plain' }] },
      'neither',
    ],
    ['a non-string name', { attachesFile: true, inlineFiles: [{ ...good, name: 3 }] }, '.name'],
    ['inlineFiles with attachesFile false', { attachesFile: false, inlineFiles: [good] }, 'attachesFile is not true'],
    ['inlineFiles beside file kinds', { attachesFile: true, file: 'text', inlineFiles: [good] }, 'both file and'],
    ['a misspelt inlineFiles key', { attachesFile: true, inlineFile: [good] }, 'unknown key "inlineFile"'],
    ['a misspelt attachesFile key', { attachesFile: true, attachFile: true }, 'unknown key "attachFile"'],
    ['an entry that is not an object', 'text', 'must be an object'],
    ['a missing attachesFile', { values: { input: 'x' } }, 'attachesFile must be true or false'],
    ['a mode with no value', { mode: { field: 'mode' }, attachesFile: false }, '.mode must be'],
    [
      'a mode with an extra key',
      { mode: { field: 'm', value: 'v', label: 'x' }, attachesFile: false },
      '.mode must be',
    ],
    ['a value that is a number', { values: { count: 3 }, attachesFile: false }, '.values must map'],
    ['an unknown fixture file kind', { attachesFile: true, file: 'pdf,docx' }, 'unknown: "docx"'],
    ['an empty fixture file kind list', { attachesFile: true, file: '' }, '.file must be'],
    ['file kinds with attachesFile false', { attachesFile: false, file: 'pdf' }, 'has file but attachesFile'],
    ['an empty base64 payload', { attachesFile: true, inlineFiles: [{ ...good, base64: '' }] }, 'base64 is empty'],
    ['an empty text payload', { attachesFile: true, inlineFiles: [{ ...text, text: '' }] }, 'text is empty'],
    ['text files with no marker', { attachesFile: true, inlineFiles: [good, text] }, 'none holds {{MARKER}}'],
  ];
  for (const [what, entry, says] of refused) {
    const problems = privacyEntryProblems('x.json', 0, entry);
    expect(problems.length, `${what} must be refused`).toBeGreaterThan(0);
    expect(problems.join(' '), `${what}: the message must name the file`).toContain('e2e/privacy-fixtures/x.json');
    expect(problems.join(' '), `${what}: the message must say what is wrong`).toContain(says);
  }
});

/**
 * A fixed sleep clears the 140ms auto-run debounce (ToolRunner.tsx:257) with
 * room to spare, but proves nothing about an asynchronous run in flight, and
 * a later refill can schedule a second debounce that supersedes the first
 * before it reaches the branch under test. So: sleep as a floor, then wait
 * for the observable completion signal -- the Output section's `aria-busy`
 * back at false (ToolRunner.tsx:320). The sleep alone is not the proof; the
 * signal is.
 */
/** True when a run-as-you-type page is showing output with no input problem and no crash. */
async function autoRunSucceeded(page: Page): Promise<boolean> {
  const output = page.locator('section[aria-label="Output"]');
  if ((await output.locator('.issue-list, .note-error').count()) > 0) return false;
  return (await output.locator('.panel-body > div:not(.note)').count()) > 0;
}

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(200);
  try {
    await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
      timeout: 8000,
    });
  } catch {
    // A page that never clears aria-busy is a real finding, but this helper
    // is a wait, not an assertion; the test's own checks catch a stuck page.
  }
}

function keysEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

interface VisitLogRow {
  position: number;
  key: string;
  field: string;
  value: string;
  prerequisites: string[];
}

interface CoverageReport {
  textFilled: number;
  numberFilled: number;
  checkboxStates: number;
  selectOptionsVisited: number;
  rangesMoved: number;
  radioModesVisited: number;
  discoveredAfterChange: number;
  filesAttached: number;
  runsCompleted: number;
  /** How many valid-scenario fixture entries the page has. */
  fixtureEntries: number;
  /** How many of them completed their run. */
  fixtureEntriesCompleted: number;
  /** The 1-based positions of the entries that never completed their run. */
  fixtureEntriesNotCompleted: number[];
  remaining: number;
  totalHandled: number;
  visitLog: VisitLogRow[];
  pushed: string[];
  visited: string[];
  typedValues: string[];
}

/**
 * Drives every control kind a tool page can render, in every mode, as a
 * work queue over discovered control STATES rather than three nested lists.
 *
 * A control found at first paint is seeded with an empty prerequisite path.
 * Applying any queued state can mount controls that were not in the document
 * at all (ToolRunner.tsx:263 removes an invisible field from rendering
 * entirely); the re-scan after every applied state is what discovers those
 * and enqueues their states too, each carrying the discovering entry's own
 * prerequisite path plus the discovering entry itself.
 *
 * Reset-and-replay: live-modelling this traversal against the real `uuid`
 * field definitions (and confirming it in a real browser) showed that
 * visiting Generate, then Inspect, then a queued `version=4` fails, because
 * Inspect's `visible` predicates unmount the version select along with both
 * checkboxes and the wrapper select. So every visit starts by pressing the
 * page's own Reset button (never a reload, which would re-fire page-load
 * requests after the recorder has armed), asserts the control set that comes
 * back matches the first-paint baseline, then replays the queued entry's
 * `prerequisites` in order before applying its own target state. A queued
 * control that is still not visible after that replay FAILS the test naming
 * the page, the control and the prerequisite path -- it is never skipped.
 */
async function visitEveryMode(page: Page, id: string, value: string): Promise<CoverageReport> {
  const numericValue = numericCanary(id);
  const resetButton = page.getByRole('button', { name: 'Reset', exact: true });

  const resetToDefaults = async () => {
    await resetButton.click();
    await settle(page);
  };

  await resetToDefaults();
  const baseline = await scanControlStates(page);
  const baselineKeys = new Set(baseline.map((s) => s.key));

  const pushedKeys = new Set<string>();
  const visitedKeys = new Set<string>();
  const visitLog: VisitLogRow[] = [];
  const typedValues = new Set<string>([value, numericValue]);

  let textFilled = 0;
  let numberFilled = 0;
  let checkboxStates = 0;
  let selectOptionsVisited = 0;
  let rangesMoved = 0;
  let radioModesVisited = 0;
  let discoveredAfterChange = 0;
  let filesAttached = 0;
  let runsCompleted = 0;
  const fixtureEntriesNotCompleted: number[] = [];

  const queue: QueuedState[] = [];
  const pushState = (state: ControlState, prerequisites: ControlState[]) => {
    if (pushedKeys.has(state.key)) return;
    pushedKeys.add(state.key);
    queue.push({ ...state, prerequisites });
  };

  const IMPLICIT: QueuedState = {
    kind: 'radio',
    field: '__implicit__',
    value: '',
    key: 'implicit:swept',
    prerequisites: [],
  };
  if (baseline.length === 0) {
    pushedKeys.add(IMPLICIT.key);
    queue.push(IMPLICIT);
  } else {
    for (const s of baseline) pushState(s, []);
  }

  const INTERACTION_CAP = 3000;
  let interactions = 0;

  while (queue.length > 0) {
    const entry = queue.shift()!;
    const isImplicit = entry.key === IMPLICIT.key;

    await resetToDefaults();
    interactions++;
    const afterReset = await scanControlStates(page);
    if (!keysEqual(new Set(afterReset.map((s) => s.key)), baselineKeys)) {
      throw new Error(`Reset on /tools/${id} did not return the page to its baseline control set.`);
    }

    const prereqDescriptions = entry.prerequisites.map((p) => `${p.field}=${p.value}`);
    for (const prereq of entry.prerequisites) {
      const applied = await applyState(page, prereq);
      interactions++;
      if (!applied) {
        throw new Error(
          `Queued control ${entry.field}=${entry.value} on /tools/${id} is not visible after replaying its prerequisites [${prereqDescriptions.join(', ')}]`,
        );
      }
      await settle(page);
    }

    if (!isImplicit) {
      const applied = await applyState(page, entry);
      interactions++;
      if (!applied) {
        throw new Error(
          `Queued control ${entry.field}=${entry.value} on /tools/${id} is not visible after replaying its prerequisites [${prereqDescriptions.join(', ')}]`,
        );
      }
      await settle(page);
    }

    if (interactions > INTERACTION_CAP) {
      throw new Error(
        `Control traversal on /tools/${id} exceeded ${INTERACTION_CAP} interactions without draining the queue. This page needs more than the cap, which is a finding, not something to skip past.`,
      );
    }

    const rescan = await scanControlStates(page);
    let discoveredHere = 0;
    for (const s of rescan) {
      if (!pushedKeys.has(s.key)) {
        discoveredHere++;
        pushState(s, isImplicit ? [] : [...entry.prerequisites, entry]);
      }
    }
    discoveredAfterChange += discoveredHere;

    const filled = await fillVisibleInputs(page, value, numericValue);
    textFilled += filled.text;
    numberFilled += filled.number;

    // Called from inside the visit of EVERY control state, not once per page
    // and not once per radio mode after the whole sweep -- a single Run
    // pressed at the end only ever exercises whichever mode, checkbox and
    // select state the sweep happened to leave live last (on uuid: hyphens
    // on, version v3), never the state actually under test.
    filesAttached += await attachCanaryFiles(page, value);
    if (await pressRunIfPresent(page)) runsCompleted++;
    await settle(page);

    visitedKeys.add(entry.key);
    visitLog.push({
      position: visitLog.length + 1,
      key: entry.key,
      field: entry.field,
      value: entry.value,
      prerequisites: prereqDescriptions,
    });

    if (entry.kind === 'checkbox') checkboxStates++;
    if (entry.kind === 'select') selectOptionsVisited++;
    if (entry.kind === 'range') rangesMoved++;
    if (entry.kind === 'radio' && !isImplicit) radioModesVisited++;
  }

  // The valid-scenario fixture pass: one extra visit per fixture entry,
  // after the queue has fully drained, starting from the same Reset click
  // every queued visit starts from so the fixture's mode is applied to the
  // defaults rather than to whatever state the last queued visit left
  // behind. Runs only for the handful of pages whose real processing cannot
  // be reached with the tracer alone.
  const fixtureEntries = VALID_SCENARIO_FIXTURES[id] ?? [];
  for (const [entryIndex, fixture] of fixtureEntries.entries()) {
    const fixtureEntryNumber = entryIndex + 1;
    await resetToDefaults();

    if (fixture.mode) {
      const appliedAsRadio = await applyState(page, {
        kind: 'radio',
        field: fixture.mode.field,
        value: fixture.mode.value,
        key: '',
      });
      if (!appliedAsRadio) {
        const select = page.locator(`main #f-${fixture.mode.field}`);
        if ((await select.count()) > 0 && (await select.first().isVisible())) {
          await select.first().selectOption(fixture.mode.value);
        }
      }
      await settle(page);
    }

    // Fill every other visible field with the ordinary tracers first, so a
    // field the fixture does not specifically override still carries a
    // value the leak assertions search for.
    const filled = await fillVisibleInputs(page, value, numericValue);
    textFilled += filled.text;
    numberFilled += filled.number;

    if (fixture.values) {
      for (const [field, fieldValue] of Object.entries(fixture.values)) {
        const el = page.locator(`main #f-${field}`);
        if ((await el.count()) === 0) continue;
        if (!(await el.first().isVisible())) continue;
        // A select cannot be typed into: choose the option instead. Only
        // typed text is recorded as a value the leak assertions search for.
        const tag = await el.first().evaluate((n) => n.tagName);
        if (tag === 'SELECT') {
          await el.first().selectOption(fieldValue);
          continue;
        }
        await el.first().fill(fieldValue);
        typedValues.add(fieldValue);
      }
    }

    if (fixture.inlineFiles) filesAttached += await attachInlineFixtureFiles(page, fixture.inlineFiles, value);
    else if (fixture.file) filesAttached += await attachRealFixtureFiles(page, fixture.file, value);
    else if (fixture.attachesFile) filesAttached += await attachCanaryFiles(page, value);
    // Whether THIS entry completed its run, recorded by position: a page passes only when every entry did, not when any
    // one of them did.
    let entryCompleted = false;
    if (await pressRunIfPresent(page)) {
      runsCompleted++;
      entryCompleted = true;
      await settle(page);
    } else {
      // A page that runs as you type has no Run button: the fixture counts as a
      // completed run only when the automatic run produced output without an
      // input problem or a crash, i.e. it reached the real processing path.
      await settle(page);
      if (await autoRunSucceeded(page)) {
        runsCompleted++;
        entryCompleted = true;
      }
    }
    if (!entryCompleted) fixtureEntriesNotCompleted.push(fixtureEntryNumber);
  }

  const remaining = pushedKeys.size - visitedKeys.size;
  const totalHandled = textFilled + numberFilled + visitedKeys.size - (baseline.length === 0 ? 1 : 0);

  return {
    textFilled,
    numberFilled,
    checkboxStates,
    selectOptionsVisited,
    rangesMoved,
    radioModesVisited,
    discoveredAfterChange,
    filesAttached,
    runsCompleted,
    fixtureEntries: fixtureEntries.length,
    fixtureEntriesCompleted: fixtureEntries.length - fixtureEntriesNotCompleted.length,
    fixtureEntriesNotCompleted,
    remaining,
    totalHandled,
    visitLog,
    pushed: Array.from(pushedKeys),
    visited: Array.from(visitedKeys),
    typedValues: Array.from(typedValues),
  };
}

test.describe('local processing', () => {
  test('no third-party origin is contacted when loading the site', async ({ page, baseURL }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (!url.startsWith(baseURL!)) external.push(`${request.method()} ${url}`);
    });

    for (const path of ['/', '/tools', '/catalog', '/privacy', '/about']) {
      await page.goto(rel(path));
      await page.waitForLoadState('networkidle');
    }

    expect(
      external,
      'The site must serve every asset from its own origin. A third-party request would hand that party the visitor IP address and the page they are on.',
    ).toEqual([]);
  });

  const CONDITIONAL_COVERAGE_PAGES = ['number-base', 'base64', 'uuid', 'slug-generator'];

  for (const id of toolIds) {
    test(`${id}: input never leaves the page`, async ({ page, baseURL }, testInfo: TestInfo) => {
      // The full control-state traversal, run on every mode, is far heavier
      // than a single fill-and-check pass. Raise this suite's own budget
      // rather than `playwright.config.ts`'s global 45s, which would also
      // relax the faster site tests.
      test.setTimeout(180_000);

      // The content security policy blocks a request without producing a request event, so a leak the policy
      // refuses is only visible as a violation. The probe is armed before the page loads (load-time violations
      // count); the request recorder below still arms after load.
      const csp = await armCspProbe(page);
      const recorder = await instrument(page);
      const value = canary(id);
      const numericValue = numericCanary(id);

      await page.goto(rel(`/tools/${id}`));
      await page.waitForLoadState('networkidle');
      // Everything above this line is page load. Only what follows is the tool
      // processing input, which is what the claim is about.
      recorder.arm();

      const report = await visitEveryMode(page, id, value);
      await testInfo.attach('coverage-report', {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      });

      expect(report.totalHandled, `No editable control of any kind found on /tools/${id}`).toBeGreaterThan(0);
      expect(
        report.remaining,
        `/tools/${id}: ${report.remaining} discovered control state(s) were queued but never visited`,
      ).toBe(0);

      if (CONDITIONAL_COVERAGE_PAGES.includes(id)) {
        expect(
          report.discoveredAfterChange,
          `/tools/${id}: no control was discovered only after another control changed`,
        ).toBeGreaterThanOrEqual(1);
      }

      // A page in the valid-scenario fixture table must actually reach its
      // real processing path, not just declare that it should.
      const fixtures = VALID_SCENARIO_FIXTURES[id];
      if (fixtures && fixtures.length > 0) {
        expect(report.runsCompleted, `/tools/${id}: the valid-scenario fixture never completed a Run`).toBeGreaterThan(
          0,
        );
        // Every entry, not any one: a page whose second entry never reached its real processing must not pass because
        // its first entry did.
        expect(
          report.fixtureEntries,
          `/tools/${id}: the coverage report counted a different number of fixture entries`,
        ).toBe(fixtures.length);
        const excused = FIXTURE_ENTRIES_THAT_STOP[id]?.positions ?? [];
        const notCompleted = report.fixtureEntriesNotCompleted.filter((position) => !excused.includes(position));
        expect(notCompleted, `/tools/${id}: fixture entries ${notCompleted.join(', ')} never completed a Run`).toEqual(
          [],
        );
        if (fixtures.some((f) => f.attachesFile)) {
          expect(
            report.filesAttached,
            `/tools/${id}: a fixture declares attachesFile but no file was ever attached`,
          ).toBeGreaterThan(0);
        } else {
          expect(
            report.filesAttached,
            `/tools/${id}: a file was attached on a page whose fixture declares no file input`,
          ).toBe(0);
        }
      }

      // Give auto-run, debouncing and any worker time to finish: a fixed pause, then the page's own run (the Output
      // section's aria-busy back at false), then 500 ms with no request in flight. Not Playwright's network idle wait,
      // which can hang on a page that runs a worker and then shows a preview frame (see waitForQuietNetwork).
      await page.waitForTimeout(1200);
      await settle(page);
      await waitForQuietNetwork(page, recorder, { quietMs: 500 });

      const offending = recorder.requests.filter((r) => {
        const url = r.url();
        return !url.startsWith('data:') && !url.startsWith('blob:');
      });

      expect(
        offending.map((r) => `${r.method()} ${r.url()}`),
        `Processing input on /tools/${id} caused a network request. A local tool must make none.`,
      ).toEqual([]);

      // A request the page policy blocks produces no request event, so the assertion above stays silent for a leak
      // the browser refused and this one is what catches it. Proven to fail against a deliberate blocked leak on
      // 2026-10-05, in all four projects (chromium, firefox, webkit, mobile-chrome): a throwaway build of the Base64
      // page that sent its input to an outside address on each run turned this assertion red, naming this exact
      // message and the refused address, while the request assertion above stayed silent; it passed again once the
      // leak was removed. The leak was never committed.
      const violations = csp.findings().map(describeFinding);
      expect(
        violations,
        `A content security policy violation happened on /tools/${id}: ${violations.join(' | ')}. A tool page must stay inside its own policy.`,
      ).toEqual([]);

      const url = page.url();
      expect(url, `The canary reached the URL on /tools/${id}`).not.toContain(value);
      expect(url, 'A tool must not put input in the URL, because URLs reach history and server logs').not.toContain(
        'CANARY',
      );
      expect(url, `The numeric tracer reached the URL on /tools/${id}`).not.toContain(numericValue);

      const storage = await readStorage(page);
      expect(storage, `The canary was written to storage on /tools/${id}`).not.toContain(value);
      // Proven to fail against a deliberate storage leak on a number-only page
      // (random-number has no text box), 2026-09-23: injecting one line writing
      // the min field's value into sessionStorage turned this assertion red,
      // naming this exact message and the tracer, then green again once removed.
      expect(storage, `The numeric tracer was written to storage on /tools/${id}`).not.toContain(numericValue);

      expect(recorder.consoleText.join('\n'), `The canary was written to the console on /tools/${id}`).not.toContain(
        value,
      );
      expect(
        recorder.consoleText.join('\n'),
        `The numeric tracer was written to the console on /tools/${id}`,
      ).not.toContain(numericValue);

      // Every value the harness typed, not only the two tracers: a page that
      // rejects the tracer as invalid and then stores a Task 2 fixture value
      // must still be caught. A short floor avoids false reports from an
      // ordinary "true" or "0" a fixture might supply.
      for (const typed of report.typedValues) {
        if (typed.length < 6) continue;
        expect(url, `The value "${typed}" reached the URL on /tools/${id}`).not.toContain(typed);
        expect(storage, `The value "${typed}" was written to storage on /tools/${id}`).not.toContain(typed);
        expect(
          recorder.consoleText.join('\n'),
          `The value "${typed}" was written to the console on /tools/${id}`,
        ).not.toContain(typed);
      }

      // The page must still have produced something, otherwise this test would
      // pass trivially on a tool that silently does nothing.
      const output = page.locator('section[aria-label="Output"]');
      await expect(output).toBeVisible();

      expect(baseURL).toBeTruthy();
    });
  }

  // Named regression test for the reset-and-replay fix: on uuid, visiting
  // Generate then Inspect used to unmount the version select, both
  // checkboxes and the wrapper select, stranding twelve queued states that
  // could never become visible again. See the reasoning above visitEveryMode.
  test('uuid: the control sweep visits every discovered state, including every version after Inspect', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const recorder = await instrument(page);
    const value = canary('uuid');

    await page.goto(rel('/tools/uuid'));
    await page.waitForLoadState('networkidle');
    recorder.arm();

    const report = await visitEveryMode(page, 'uuid', value);

    expect(report.remaining, 'every pushed state must have been visited').toBe(0);
    expect(new Set(report.visited)).toEqual(new Set(report.pushed));

    const inspectRow = report.visitLog.find((r) => r.field === 'mode' && r.value === 'inspect');
    expect(inspectRow, 'mode=inspect must appear in the visit log').toBeTruthy();
    const inspectPosition = inspectRow!.position;

    for (const version of ['4', '7', '1', '5', '3']) {
      const row = report.visitLog.find((r) => r.field === 'version' && r.value === version);
      expect(row, `version=${version} must appear in the visit log`).toBeTruthy();
      expect(
        row!.position,
        `version=${version} was visited at position ${row!.position}, which must be after mode=inspect (position ${inspectPosition})`,
      ).toBeGreaterThan(inspectPosition);
    }

    const namespaceValues = [
      '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
      '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
      '6ba7b814-9dad-11d1-80b4-00c04fd430c8',
    ];
    for (const ns of namespaceValues) {
      const row = report.visitLog.find((r) => r.field === 'namespace' && r.value === ns);
      expect(row, `namespace=${ns} must appear in the visit log`).toBeTruthy();
      const hasVersionPrereq = row!.prerequisites.some((p) => p === 'version=5' || p === 'version=3');
      expect(
        hasVersionPrereq,
        `namespace=${ns} must have been reached with version=5 or version=3 among its prerequisites [${row!.prerequisites.join(', ')}]`,
      ).toBe(true);
    }

    expect(report.visitLog.length, 'the sweep must visit at least 18 states on uuid').toBeGreaterThanOrEqual(18);
  });

  test('the report-an-issue link carries no input', async ({ page }) => {
    const value = canary('issue-link');
    await page.goto(rel('/tools/base64'));
    await page.locator('main textarea').first().fill(value);
    await page.waitForTimeout(500);

    const href = await page
      .locator('.tool-header')
      .getByRole('link', { name: /report an issue/i })
      .getAttribute('href');
    expect(href, 'An issue link must never be pre-filled with what the user typed').not.toContain(value);
    expect(href).toContain('/issues/new');
  });

  test('reloading the page does not restore what was typed', async ({ page }) => {
    const value = canary('no-persist');
    await page.goto(rel('/tools/base64'));
    await page.locator('main textarea').first().fill(value);
    await page.waitForTimeout(500);

    await page.reload();
    await page.waitForLoadState('networkidle');

    const content = await page.content();
    expect(content, 'Input must not survive a reload, because it was never stored').not.toContain(value);
  });

  test('the only thing stored locally is the theme', async ({ page }) => {
    await page.goto(rel('/'));
    await page.getByRole('button', { name: /switch to .* theme/i }).click();
    await page.waitForTimeout(200);

    const keys = await page.evaluate(() => {
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)!);
      return out;
    });
    expect(keys).toEqual(['fodt-theme']);

    const cookies = await page.context().cookies();
    expect(cookies, 'The site sets no cookies').toEqual([]);
  });

  test('no service worker is registered', async ({ page }) => {
    await page.goto(rel('/'));
    await page.waitForLoadState('networkidle');
    const registrations = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 0;
      const list = await navigator.serviceWorker.getRegistrations();
      return list.length;
    });
    expect(registrations).toBe(0);
  });
});

test.describe('rendering untrusted content', () => {
  test('a preview frame cannot run scripts or reach the network', async ({ page }) => {
    await page.goto(rel('/tools/base64'));
    const frames = page.locator('iframe.preview-frame');
    const count = await frames.count();
    // Not every tool has a preview. Where one exists, it must be fully sandboxed.
    for (let i = 0; i < count; i++) {
      const sandbox = await frames.nth(i).getAttribute('sandbox');
      expect(sandbox, 'A preview frame must carry an empty sandbox attribute').toBe('');
    }
  });
});
