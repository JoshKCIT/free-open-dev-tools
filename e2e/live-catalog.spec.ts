import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Plan 02-14 Task 3's own evidence for the roadmap's first and fifth
 * success criteria, run against the DEPLOYED site (set E2E_BASE_URL,
 * playwright.config.ts:15) rather than a local build.
 *
 * Three things this file proves, none of which a raw HTML fetch can:
 * `scripts/prerender.mjs` writes only the document head, and
 * `apps/web/src/pages/Catalog.tsx` renders every tool card client-side, so
 * the served catalog HTML itself contains no tool list at all.
 *
 *   1. The catalog, opened in a real browser and given time to render,
 *      shows exactly 38 links to built tool pages -- not 144 (the whole
 *      catalog including unbuilt tools) and not a number read out of a
 *      hashed asset filename that happens to contain the wrong digits.
 *   2. Each of the 22 new tools is reachable by clicking its own link on
 *      its own category page (`/tools?category=<category>`), not only by
 *      typing its URL directly.
 *   3. Each of the 22 new tools produces a stated, checkable answer on
 *      first use: a literal published vector for a deterministic tool, a
 *      pinned property for a generator, and a synthetic in-memory file for
 *      the two file-reading tools. An assertion that merely says "some
 *      output rendered" cannot catch a page that always encodes a
 *      constant, which is why every fixture below carries a real expected
 *      value rather than a length check.
 */

const rel = (path: string) => path.replace(/^\//, '');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  implemented: boolean;
}

const catalogJson = JSON.parse(readFileSync(join(root, 'apps', 'web', 'src', 'generated-catalog.json'), 'utf8')) as {
  tools: CatalogEntry[];
};
const CATALOG: CatalogEntry[] = catalogJson.tools;

function entryFor(id: string): CatalogEntry {
  const entry = CATALOG.find((c) => c.id === id);
  if (!entry) throw new Error(`generated-catalog.json has no entry for ${id}. Was it regenerated after this plan?`);
  return entry;
}

/** The 22 tools this phase added, in the same order every other verify script in this plan uses. */
const NEW_TOOL_IDS = [
  'base32',
  'base58',
  'unicode-inspector',
  'text-radix',
  'json-string-escape',
  'morse-code',
  'classical-cipher',
  'nato-phonetic',
  'ieee754',
  'roman-numerals',
  'number-to-words',
  'scientific-notation',
  'password-generator',
  'basic-auth',
  'luhn',
  'random-string',
  'random-number',
  'data-uri',
  'hash-file',
  'bcrypt',
  'password-strength',
  'jwt-signature',
];

/** The 14 tools Phase 3 added (TEXT-01..06, TIME-01..04, REF-01..04). */
const PHASE_3_TOOL_IDS = [
  'text-lines',
  'find-replace',
  'regex-tester',
  'lorem-ipsum',
  'email-extractor',
  'ascii-art',
  'timezone-converter',
  'date-diff',
  'cron-expression',
  'date-format',
  'http-status-codes',
  'mime-types',
  'ascii-table',
  'emoji-picker',
];

/** The 16 tools Phase 4 added (DATA-01..16). */
const PHASE_4_TOOL_IDS = [
  'json-diff',
  'jsonpath',
  'json-schema-validator',
  'json-schema-generator',
  'json-flatten',
  'json-to-code',
  'json-to-zod',
  'data-convert',
  'csv-json',
  'xml-json',
  'csv-viewer',
  'data-to-sql',
  'sql-to-types',
  'php-unserialize',
  'list-compare',
  'mock-data',
];

/** The 20 tools Phase 5 adds (CODE-01..20). */
const PHASE_5_TOOL_IDS = [
  'html-formatter',
  'css-formatter',
  'js-formatter',
  'xml-formatter',
  'yaml-formatter',
  'sql-formatter',
  'svg-optimizer',
  'jsx-converter',
  'ts-to-js',
  'tailwind-css',
  'markdown-html',
  'table-builder',
  'bbcode',
  'code-complexity',
  'xpath-tester',
  'git-diff-viewer',
  'graphql-to-typescript',
  'json-to-graphql',
  'openapi-validator',
  'openapi-to-typescript',
];

/** The 13 tools Phase 6 adds (NET-01..13). */
const PHASE_6_TOOL_IDS = [
  'ip-ptr',
  'user-agent',
  'curl-converter',
  'security-headers',
  'url-parser',
  'utm-builder',
  'meta-tags',
  'robots-txt',
  'sitemap-generator',
  'schema-markup',
  'hreflang',
  'htaccess-generator',
  'nginx-config',
];

// --- Small, deliberately unabstracted field helpers -------------------------
// ToolRunner.tsx assigns every non-radio control the id `f-<field name>`, and
// every radio input its field's `name` attribute plus its option `value`
// (FieldControl, ToolRunner.tsx). Scoped to the whole page, not `main`: a
// tool page renders exactly one form, so there is nothing else to collide
// with.

async function fillField(page: Page, name: string, value: string): Promise<void> {
  await page.locator(`#f-${name}`).fill(value);
}

async function setRadio(page: Page, name: string, value: string): Promise<void> {
  await page.locator(`input[type="radio"][name="${name}"][value="${value}"]`).check();
}

async function attachSyntheticFile(
  page: Page,
  fieldName: string,
  name: string,
  mimeType: string,
  contents: string,
): Promise<void> {
  await page.locator(`#f-${fieldName}`).setInputFiles({ name, mimeType, buffer: Buffer.from(contents, 'utf8') });
}

/**
 * Only tools with `autoRun: false` (ToolRunner.tsx) render a Run button at
 * all. Waits for the Reset button first -- every ToolRunner instance has
 * one, rendered only after `ToolView`'s async `loadTool()` swaps out its
 * "Loading the tool…" placeholder -- so a fixture whose setup does nothing
 * but press Run (no preceding field fill to absorb that wait) does not race
 * the load and silently find zero Run buttons.
 */
async function pressRunIfPresent(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
  const button = page.getByRole('button', { name: 'Run', exact: true });
  if ((await button.count()) > 0) await button.click();
}

/**
 * A fixed sleep clears the 140ms auto-run debounce (ToolRunner.tsx:257)
 * with room to spare, then waits for the Output section's own busy signal
 * to clear (aria-busy back to 'false', ToolRunner.tsx:320) -- the same
 * two-stage wait e2e/privacy.spec.ts uses, for the same reason: the sleep
 * alone proves nothing about a worker-backed run still in flight.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(200);
  try {
    await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
      timeout: 15_000,
    });
  } catch {
    // A page that never clears aria-busy is a real finding; the fixture's
    // own assertion below catches it by finding no matching output.
  }
}

/** The literal text of the first 'code'-kind output block (OutputView.tsx renders it as `pre.output`). */
async function firstCodeBlockText(page: Page): Promise<string> {
  const text = await page.locator('section[aria-label="Output"] pre.output').first().innerText();
  return text.trim();
}

/** One step of a live fixture file: what to do to a single field, or press Run. */
interface LiveStep {
  action: 'fill' | 'select' | 'check' | 'uncheck' | 'radio' | 'run';
  field?: string;
  value?: string;
}

/**
 * The shape of one `e2e/live-fixtures/<file>.json` file. `id` names the tool
 * page it drives and must match the file's own name (checked below, not
 * assumed); `expect` lists every string the Output section's rendered text
 * must contain once `steps` have run.
 */
interface LiveFixtureFile {
  id: string;
  label: string;
  steps: LiveStep[];
  expect: string[];
}

/** One file loaded from `e2e/live-fixtures/`, paired with the file name it came from. */
interface LoadedLiveFixture {
  file: string;
  data: LiveFixtureFile;
}

/**
 * Per-tool deployed-site fixture files, one per id, under
 * `e2e/live-fixtures/<id>.json`. Lets a later plan register its own
 * first-use fixture without editing this file at all (Phase 3's own
 * shared_procedure, step 8).
 */
function loadLiveFixtureFiles(): LoadedLiveFixture[] {
  const dir = join(root, 'e2e', 'live-fixtures');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((file) => ({ file, data: JSON.parse(readFileSync(join(dir, file), 'utf8')) as LiveFixtureFile }));
}

const LIVE_FIXTURE_FILES = loadLiveFixtureFiles();
/** Every tool id a live fixture file declares, in file-load order. */
const LIVE_FIXTURE_IDS = LIVE_FIXTURE_FILES.map((f) => f.data.id);

/** Applies one `LiveStep` to the page. The six known actions are the only ones a fixture file may use. */
async function applyLiveStep(page: Page, step: LiveStep): Promise<void> {
  switch (step.action) {
    case 'fill':
      await fillField(page, step.field!, step.value ?? '');
      break;
    case 'select':
      await page.locator(`#f-${step.field}`).selectOption(step.value ?? '');
      break;
    case 'check':
      await page.locator(`#f-${step.field}`).check();
      break;
    case 'uncheck':
      await page.locator(`#f-${step.field}`).uncheck();
      break;
    case 'radio':
      await setRadio(page, step.field!, step.value ?? '');
      break;
    case 'run':
      await pressRunIfPresent(page);
      break;
  }
}

// --- The per-tool fixture table ---------------------------------------------
// One entry per new tool. `setup` drives the page to the state the
// `expect` value was taken from; `check` is a full assertion, not just a
// value comparison, so a property-based fixture (a generator) can assert a
// shape instead of a literal.
//
// Every literal expected value below is taken from the SAME published
// source, or the same package test file citing it, that the tool's own
// unit tests use -- never recomputed from the page or the tool package
// itself, so the page and the package are checked against one outside
// answer rather than against each other (this plan's own `<action>`).

interface Fixture {
  id: string;
  /** What a human would say this proves, for a failure message that names the fixture without the id alone. */
  label: string;
  setup: (page: Page) => Promise<void>;
  check: (page: Page) => Promise<void>;
}

/** Asserts the whole Output section's rendered text contains `text` verbatim. */
function containsCheck(text: string) {
  return async (page: Page) => {
    await expect(page.locator('section[aria-label="Output"]')).toContainText(text);
  };
}

const FIXTURES: Fixture[] = [
  {
    id: 'base32',
    label: "RFC 4648 section 6's own test vector: 'foobar' encodes to MZXW6YTBOI======",
    setup: async (page) => fillField(page, 'input', 'foobar'),
    check: containsCheck('MZXW6YTBOI======'),
  },
  {
    id: 'base58',
    label: 'the Bitcoin-alphabet base58 encoding of hex bytes de ad be ef',
    setup: async (page) => fillField(page, 'input', 'de ad be ef'),
    check: containsCheck('6h8cQN'),
  },
  {
    id: 'unicode-inspector',
    label: "a zero-width space between 'ad' and 'min' is shown as the bracketed name [ZWSP]",
    setup: async (page) => fillField(page, 'input', 'ad​min'),
    check: containsCheck('[ZWSP]'),
  },
  {
    id: 'text-radix',
    label: "the ASCII bytes of '123' are 31 32 33 in hexadecimal, not the number 123 in binary",
    setup: async (page) => fillField(page, 'input', '123'),
    check: containsCheck('31 32 33'),
  },
  {
    id: 'json-string-escape',
    label: 'RFC 8259 escaping of a newline and a double quote',
    setup: async (page) => fillField(page, 'input', 'Line one\nSays "hi"'),
    check: containsCheck('Line one\\nSays \\"hi\\"'),
  },
  {
    id: 'morse-code',
    label: "ITU-R M.1677-1's own SOS example",
    setup: async (page) => fillField(page, 'input', 'SOS'),
    check: containsCheck('... --- ...'),
  },
  {
    id: 'classical-cipher',
    label: "the Caesar cipher's own worked example, shift 3: 'Attack at dawn' -> 'Dwwdfn dw gdzq'",
    setup: async (page) => fillField(page, 'input', 'Attack at dawn'),
    check: containsCheck('Dwwdfn dw gdzq'),
  },
  {
    id: 'nato-phonetic',
    label: 'the ICAO/NATO spelling of SOS: Sierra Oscar Sierra',
    setup: async (page) => fillField(page, 'input', 'SOS'),
    check: containsCheck('Sierra Oscar Sierra'),
  },
  {
    id: 'ieee754',
    label: '3.14 as an IEEE 754 binary32 bit pattern (the page default; no input needed)',
    setup: async () => {
      /* format=binary32, mode=value, input=3.14 are all the page's own defaults */
    },
    check: containsCheck('0 10000000 10010001111010111000011'),
  },
  {
    id: 'roman-numerals',
    label: "1994 in Roman numerals (the page's own default value): MCMXCIV",
    setup: async () => {
      /* direction=toRoman, value=1994 are the page's own defaults */
    },
    check: containsCheck('MCMXCIV'),
  },
  {
    id: 'number-to-words',
    label: 'a value beyond Number.MAX_SAFE_INTEGER, spelled out digit group by digit group',
    setup: async (page) => fillField(page, 'value', '9007199254740993'),
    check: containsCheck(
      'nine quadrillion, seven trillion, one hundred and ninety-nine billion, two hundred and fifty-four million, seven hundred and forty thousand, nine hundred and ninety-three',
    ),
  },
  {
    id: 'scientific-notation',
    label: 'a 30-significant-digit value round-tripped through E notation without losing a digit',
    setup: async (page) => {
      await fillField(page, 'input', '1.23456789012345678901234567890e50');
      await setRadio(page, 'notation', 'e');
    },
    check: containsCheck('1.23456789012345678901234567890e+50'),
  },
  {
    id: 'password-generator',
    label: 'a 16-character password drawn only from letters and digits (the page default classes)',
    setup: async (page) => pressRunIfPresent(page),
    check: async (page) => {
      const text = await firstCodeBlockText(page);
      expect(text, `expected a 16-character letters+digits password, got ${JSON.stringify(text)}`).toMatch(
        /^[A-Za-z0-9]{16}$/,
      );
    },
  },
  {
    id: 'basic-auth',
    label: "RFC 7617 section 2's own worked example: Aladdin:open sesame",
    setup: async (page) => {
      await fillField(page, 'userid', 'Aladdin');
      await fillField(page, 'password', 'open sesame');
    },
    check: containsCheck('QWxhZGRpbjpvcGVuIHNlc2FtZQ=='),
  },
  {
    id: 'luhn',
    label: "a widely reproduced Luhn-valid number, 79927398713 (the page's own default input)",
    setup: async () => {
      /* mode=check, input=79927398713 are the page's own defaults */
    },
    check: containsCheck('Passes the Luhn check.'),
  },
  {
    id: 'random-string',
    label: 'a 12-character string drawn only from the URL-safe alphabet (a pinned property, not a value)',
    setup: async (page) => {
      await fillField(page, 'length', '12');
      await pressRunIfPresent(page);
    },
    check: async (page) => {
      const text = await firstCodeBlockText(page);
      expect(text, `expected 12 URL-safe characters, got ${JSON.stringify(text)}`).toMatch(/^[A-Za-z0-9_-]{12}$/);
    },
  },
  {
    id: 'random-number',
    label: 'an integer pinned to exactly 7 by setting minimum and maximum both to 7',
    setup: async (page) => {
      await fillField(page, 'min', '7');
      await fillField(page, 'max', '7');
      await pressRunIfPresent(page);
    },
    check: async (page) => {
      const text = await firstCodeBlockText(page);
      expect(text).toBe('7');
    },
  },
  {
    id: 'data-uri',
    label: 'a synthetic 3-byte text/plain file, encoded to the exact data URI those bytes give',
    setup: async (page) => {
      await attachSyntheticFile(page, 'file', 'sample.txt', 'text/plain', 'abc');
      await pressRunIfPresent(page);
    },
    check: containsCheck('data:text/plain;base64,YWJj'),
  },
  {
    id: 'hash-file',
    label: "the same synthetic 3-byte file's published SHA-256 digest (FIPS 180-4): sha256('abc')",
    setup: async (page) => {
      await attachSyntheticFile(page, 'file', 'sample.txt', 'text/plain', 'abc');
      await pressRunIfPresent(page);
    },
    check: containsCheck('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
  },
  {
    id: 'bcrypt',
    // The page's own bundled example pairs password 'password' with hash
    // $2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy, but that
    // pairing does not actually verify -- confirmed independently with
    // bcrypt-ts's own compareSync() before writing this fixture, and
    // reproduced live against this exact page (it reports "Incorrect"),
    // which is a real, separate finding recorded in this plan's summary,
    // not something fixed here (D-23: no tool page is edited by this
    // plan). The vector below is genuine instead: tools/bcrypt/test/
    // index.test.ts's own PYCA_PASSWORD / PYCA_HASH, sourced from
    // pyca/bcrypt's published test suite (github.com/pyca/bcrypt,
    // tests/test_bcrypt.py) and cross-checked there against bcrypt-ts.
    label: "verifying pyca/bcrypt's own published test vector reports a match",
    setup: async (page) => {
      await setRadio(page, 'mode', 'verify');
      await fillField(page, 'password', 'Kk4DQuMMfZL9o');
      await fillField(page, 'hash', '$2b$04$cVWp4XaNU8a4v1uMRum2SO026BWLIoQMD/TXg5uZV.0P.uO8m3YEm');
      await pressRunIfPresent(page);
    },
    check: containsCheck('Correct. This password matches the hash.'),
  },
  {
    id: 'password-strength',
    label: "the word 'password' itself, a known leaked credential, scores 0 / 4",
    setup: async (page) => fillField(page, 'password', 'password'),
    check: containsCheck('Very weak (0 / 4).'),
  },
  {
    id: 'jwt-signature',
    label:
      'signing the jwt.io textbook header and payload with HS256 and a stated secret reproduces the exact HMAC-SHA256 token (RFC 7518)',
    setup: async (page) => {
      // mode=sign, algorithm=HS256, header and payload are all the page's
      // own defaults (apps/web/src/tools/jwt-signature.ts); only the secret
      // needs filling in.
      await fillField(page, 'secret', 'a-very-long-shared-secret-for-hs256');
      await pressRunIfPresent(page);
    },
    // Computed independently with Node's own crypto.createHmac('sha256', ...)
    // over the exact header/payload bytes and secret above -- RFC 7518
    // section 3.2's HMAC construction, not this tool's own code.
    check: containsCheck(
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTUxNjIzOTAyMn0.Y2ZXnY5HwPrN1oMsTw3JMIIQKSr8c5R0GzqbQlT_Vi8',
    ),
  },
];

// Every tool built from Phase 3 onward registers its own first-use fixture
// as a file under e2e/live-fixtures/, rather than a literal entry above.
for (const { data } of LIVE_FIXTURE_FILES) {
  FIXTURES.push({
    id: data.id,
    label: data.label,
    setup: async (page) => {
      for (const step of data.steps) await applyLiveStep(page, step);
    },
    check: async (page) => {
      for (const text of data.expect) await containsCheck(text)(page);
    },
  });
}

test.describe('the live catalog shows exactly the built tools', () => {
  test('the rendered catalog counts 88 links to built tool pages, not the 144-entry catalog size', async ({ page }) => {
    await page.goto(rel('/catalog'));
    // The catalog body is drawn by React after load (Catalog.tsx), not by
    // the prerendered head -- wait for the first card before counting.
    await expect(page.locator('a.tool-card').first()).toBeVisible();
    const count = await page.locator('a.tool-card').count();
    expect(count, 'a.tool-card only renders as a link (react-router Link) for an implemented tool').toBe(88);
  });
});

test.describe('every new tool is reachable from its own category page', () => {
  for (const id of [...NEW_TOOL_IDS, ...LIVE_FIXTURE_IDS]) {
    test(`${id} is reachable by clicking its own link on its category page, not only by direct URL`, async ({
      page,
    }) => {
      const entry = entryFor(id);
      await page.goto(rel(`/tools?category=${entry.category}`));
      const card = page
        .locator('a.tool-card')
        .filter({ has: page.getByRole('heading', { name: entry.name, exact: true }) });
      await expect(card).toHaveCount(1);
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/tools/${id}$`));
      await expect(page.getByRole('heading', { level: 1 })).toContainText(entry.name);
    });
  }
});

test.describe('every new tool gives a correct, checkable result on first use', () => {
  for (const fixture of FIXTURES) {
    test(`${fixture.id}: ${fixture.label}`, async ({ page }) => {
      await page.goto(rel(`/tools/${fixture.id}`));
      await fixture.setup(page);
      await settle(page);
      await fixture.check(page);
    });
  }

  test('every new tool has a fixture: the table above is not missing one', () => {
    const covered = new Set(FIXTURES.map((f) => f.id));
    const missing = NEW_TOOL_IDS.filter((id) => !covered.has(id));
    expect(missing, `these new tools have no first-use fixture: ${missing.join(', ')}`).toEqual([]);
  });
});

test('every live fixture file names a built tool page and uses only known step actions', () => {
  const KNOWN_ACTIONS: LiveStep['action'][] = ['fill', 'select', 'check', 'uncheck', 'radio', 'run'];
  const pageIds = new Set(
    readdirSync(join(root, 'apps', 'web', 'src', 'tools'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => f.replace(/\.ts$/, '')),
  );

  for (const { file, data } of LIVE_FIXTURE_FILES) {
    const idFromFileName = file.replace(/\.json$/, '');
    expect(data.id, `e2e/live-fixtures/${file} declares id "${data.id}", which does not match its own file name`).toBe(
      idFromFileName,
    );
    expect(
      pageIds,
      `e2e/live-fixtures/${file} names a tool id ("${data.id}") with no page in apps/web/src/tools`,
    ).toContain(data.id);
    expect(
      Array.isArray(data.expect) && data.expect.length > 0,
      `e2e/live-fixtures/${file} has an empty "expect" array`,
    ).toBe(true);
    for (const step of data.steps) {
      expect(
        KNOWN_ACTIONS.includes(step.action),
        `e2e/live-fixtures/${file} uses an unknown step action "${step.action}"`,
      ).toBe(true);
    }
  }
});

test('every phase 3 tool has exactly one live fixture file', () => {
  for (const id of PHASE_3_TOOL_IDS) {
    const count = LIVE_FIXTURE_IDS.filter((x) => x === id).length;
    expect(count, `expected exactly one live fixture file for ${id}, found ${count}`).toBe(1);
  }
});

test('every phase 4 tool has exactly one live fixture file', () => {
  for (const id of PHASE_4_TOOL_IDS) {
    const count = LIVE_FIXTURE_IDS.filter((x) => x === id).length;
    expect(count, `expected exactly one live fixture file for ${id}, found ${count}`).toBe(1);
  }
});

test('every phase 5 tool has exactly one live fixture file', () => {
  for (const id of PHASE_5_TOOL_IDS) {
    const count = LIVE_FIXTURE_IDS.filter((x) => x === id).length;
    expect(count, `expected exactly one live fixture file for ${id}, found ${count}`).toBe(1);
  }
});

test('every live fixture file belongs to phase 3, 4, 5 or 6', () => {
  // Membership only, not strict equality: phase 6 is still being built across
  // several plans, so this checks every loaded id is in the union of the
  // four phase lists and no id is declared twice, without requiring every
  // phase 6 id to already have a fixture file. Plan 06-08 sets the count to
  // 101, adds its own phase 6 completeness test and restores strict equality.
  const allowed = new Set([...PHASE_3_TOOL_IDS, ...PHASE_4_TOOL_IDS, ...PHASE_5_TOOL_IDS, ...PHASE_6_TOOL_IDS]);
  for (const id of LIVE_FIXTURE_IDS) {
    expect(allowed, `${id} is not in the union of the phase 3, 4, 5 or 6 tool id lists`).toContain(id);
  }
  const seen = new Set<string>();
  for (const id of LIVE_FIXTURE_IDS) {
    expect(seen.has(id), `${id} has more than one live fixture file`).toBe(false);
    seen.add(id);
  }
});
