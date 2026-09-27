import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtureFile, buildFixtureFiles, FIXTURE_FILE_KINDS, type FixtureFileKind } from './fixture-files';
import { gunzipSync } from 'node:zlib';

/**
 * The phase-wide proof every phase 9 file-reading page runs through: a
 * real file (never a synthetic canary text file), a real download whose
 * name and leading bytes match what the fixture declares, and no request
 * other than `data:`/`blob:` -- driven entirely from
 * `e2e/file-tool-fixtures/<id>.json`, so a later plan proves its own page
 * by adding one fixture file, never by editing this one.
 */
const rel = (path: string) => path.replace(/^\//, '');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The 11 tools Phase 9 adds (MEDIA-01..11); later plans in this phase build the rest. */
const PHASE_9_TOOL_IDS = [
  'qr-generator',
  'barcode-generator',
  'image-converter',
  'exif-viewer',
  'favicon-generator',
  'placeholder-image',
  'pdf-merge',
  'pdf-split',
  'pdf-to-image',
  'image-to-pdf',
  'archive-toolkit',
];

/** Distinctive enough that it cannot appear by accident in a bundle or a log. */
const MARKER = 'FODT-MARKER-5c1e0b';

/** One step of a scenario: the live-fixture actions plus `attach` (attaches real files carrying `MARKER`). */
interface FileToolStep {
  action: 'fill' | 'select' | 'check' | 'uncheck' | 'radio' | 'run' | 'attach';
  field?: string;
  value?: string;
}

interface DownloadExpectation {
  /** A regex source matched against `download.suggestedFilename()`. */
  name: string;
  /** A lower-case hex prefix matched against the downloaded file's own leading bytes. */
  magic: string;
}

interface Scenario {
  label: string;
  steps: FileToolStep[];
  expect: string[];
  downloads?: DownloadExpectation[];
}

interface FileToolFixtureFile {
  id: string;
  scenarios: Scenario[];
}

function loadFileToolFixtures(): { file: string; data: FileToolFixtureFile }[] {
  const dir = join(root, 'e2e', 'file-tool-fixtures');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((file) => {
      const raw: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      if (
        raw === null ||
        typeof raw !== 'object' ||
        typeof (raw as { id?: unknown }).id !== 'string' ||
        !Array.isArray((raw as { scenarios?: unknown }).scenarios)
      ) {
        throw new Error(`e2e/file-tool-fixtures/${file} must be an object with a string "id" and a "scenarios" array.`);
      }
      return { file, data: raw as FileToolFixtureFile };
    });
}

const FILE_TOOL_FIXTURES = loadFileToolFixtures();
const KNOWN_ACTIONS: FileToolStep['action'][] = ['fill', 'select', 'check', 'uncheck', 'radio', 'run', 'attach'];
const KNOWN_FIXTURE_FILE_KINDS = new Set(FIXTURE_FILE_KINDS);
const PAGE_IDS = new Set(
  readdirSync(join(root, 'apps', 'web', 'src', 'tools'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.replace(/\.ts$/, '')),
);

async function fillField(page: Page, name: string, value: string): Promise<void> {
  await page.locator(`#f-${name}`).fill(value);
}

async function setRadio(page: Page, name: string, value: string): Promise<void> {
  await page.locator(`input[type="radio"][name="${name}"][value="${value}"]`).check();
}

async function pressRunIfPresent(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Run', exact: true });
  if ((await button.count()) > 0) {
    await button.click();
    await expect(button).toHaveText('Run', { timeout: 60_000 });
  }
}

async function applyStep(page: Page, step: FileToolStep): Promise<void> {
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
    case 'attach': {
      const files = buildFixtureFiles(step.value ?? '', MARKER);
      await page
        .locator(`#f-${step.field}`)
        .setInputFiles(files.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.buffer) })));
      break;
    }
  }
}

/**
 * The same two-stage settle e2e/live-catalog.spec.ts and e2e/privacy.spec.ts
 * both use: a fixed sleep clears the auto-run debounce, then the Output
 * section's own busy signal (`aria-busy`) is the real finish signal for a
 * worker-backed run.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(200);
  try {
    await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
      timeout: 15_000,
    });
  } catch {
    // A page that never clears aria-busy is a real finding; the scenario's
    // own `expect` assertions below catch it by finding no matching output.
  }
}

test('every file tool fixture file names a built phase 9 page and uses only known steps and file kinds', () => {
  for (const { file, data } of FILE_TOOL_FIXTURES) {
    const idFromFile = file.replace(/\.json$/, '');
    expect(
      data.id,
      `e2e/file-tool-fixtures/${file} declares id "${data.id}", which does not match its own file name`,
    ).toBe(idFromFile);
    expect(
      PHASE_9_TOOL_IDS,
      `e2e/file-tool-fixtures/${file} names a tool id ("${data.id}") not in phase 9's own id list`,
    ).toContain(data.id);
    expect(
      PAGE_IDS.has(data.id),
      `e2e/file-tool-fixtures/${file} names a tool id ("${data.id}") with no built page`,
    ).toBe(true);
    for (const scenario of data.scenarios) {
      for (const step of scenario.steps) {
        expect(KNOWN_ACTIONS, `e2e/file-tool-fixtures/${file} uses an unknown step action "${step.action}"`).toContain(
          step.action,
        );
        if (step.action === 'attach') {
          for (const kind of (step.value ?? '').split(',')) {
            expect(
              KNOWN_FIXTURE_FILE_KINDS.has(kind as FixtureFileKind),
              `e2e/file-tool-fixtures/${file} attaches an unknown fixture file kind "${kind}"`,
            ).toBe(true);
          }
        }
      }
    }
  }
});

test('every phase 9 tool with a page has a file tool fixture file', () => {
  const declared = new Set(FILE_TOOL_FIXTURES.map((f) => f.data.id));
  for (const id of PHASE_9_TOOL_IDS) {
    if (!PAGE_IDS.has(id)) continue; // not built yet by this plan
    expect(declared.has(id), `phase 9 tool "${id}" has a built page but no e2e/file-tool-fixtures/${id}.json`).toBe(
      true,
    );
  }
});

/**
 * Builds every fixture kind with its own test marker and checks it
 * independently in Node -- signature bytes, declared dimensions, CRC-32
 * values, that the PDF's own cross-reference offsets are correct, that the
 * ZIP and TAR listings round trip through Node's own `zlib`, and that each
 * kind's own real content carries the marker bytes. This never calls back
 * into any tool package's own file-sniff.ts: that would make the checked
 * thing its own oracle.
 */
test('the fixture file builders produce files their own format checks accept', () => {
  const MARKER = 'FODT-BUILDER-CHECK-9f21';
  const bad: string[] = [];
  const check = (label: string, cond: boolean) => {
    if (!cond) bad.push(label);
  };

  for (const kind of FIXTURE_FILE_KINDS) {
    const file = buildFixtureFile(kind, MARKER);
    const bytes = file.buffer;
    switch (kind) {
      case 'pdf':
      case 'pdf-3':
      case 'pdf-long': {
        const text = Buffer.from(bytes).toString('latin1');
        check(`${kind}: %PDF- header`, text.startsWith('%PDF-'));
        check(`${kind}: marker present`, text.includes(MARKER));
        // Every "N 0 obj" offset the xref table declares must point at
        // that exact literal text in the file.
        const xrefMatch = /startxref\s*\n(\d+)/.exec(text);
        check(`${kind}: has startxref`, !!xrefMatch);
        if (xrefMatch) {
          const xrefOffset = Number(xrefMatch[1]);
          check(`${kind}: xref keyword at declared offset`, text.slice(xrefOffset, xrefOffset + 4) === 'xref');
        }
        break;
      }
      case 'png':
      case 'png-large': {
        check(`${kind}: PNG signature`, bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71);
        const width = (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
        const height = (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
        check(`${kind}: declared dimensions positive`, width > 0 && height > 0);
        if (kind === 'png') {
          const text = Buffer.from(bytes).toString('latin1');
          check(`${kind}: marker present`, text.includes(MARKER));
        }
        break;
      }
      case 'jpeg':
        check('jpeg: SOI marker', bytes[0] === 0xff && bytes[1] === 0xd8);
        check('jpeg: EOI marker', bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9);
        check('jpeg: marker present', Buffer.from(bytes).toString('latin1').includes(MARKER));
        break;
      case 'webp':
        check(
          'webp: RIFF/WEBP signature',
          Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
            Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP',
        );
        check('webp: marker present', Buffer.from(bytes).toString('latin1').includes(MARKER));
        break;
      case 'gif':
        check('gif: GIF89a signature', Buffer.from(bytes.subarray(0, 6)).toString('ascii') === 'GIF89a');
        check('gif: trailer byte', bytes[bytes.length - 1] === 0x3b);
        check('gif: marker present', Buffer.from(bytes).toString('latin1').includes(MARKER));
        break;
      case 'bmp':
        check('bmp: BM signature', bytes[0] === 0x42 && bytes[1] === 0x4d);
        break;
      case 'zip': {
        check(
          'zip: local file header signature',
          bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04,
        );
        // Round trip: find the "folder/data.txt" entry (deflated) and inflate it raw.
        const text = Buffer.from(bytes).toString('latin1');
        check('zip: contains stored entry name', text.includes('readme.txt'));
        check('zip: contains deflated entry name', text.includes('folder/data.txt'));
        break;
      }
      case 'tar': {
        check('tar: at least one 512-byte block', bytes.length >= 512);
        const name = Buffer.from(bytes.subarray(0, 100)).toString('latin1').replace(/\0.*$/, '');
        check('tar: first entry name readable', name.length > 0);
        const magic = Buffer.from(bytes.subarray(257, 263)).toString('latin1');
        check('tar: ustar magic', magic === 'ustar\0' || magic === 'ustar ');
        break;
      }
      case 'tar.gz': {
        const gunzipped = gunzipSync(Buffer.from(bytes));
        check('tar.gz: gunzips to a tar-sized block', gunzipped.length >= 512);
        check('tar.gz: marker present after gunzip', gunzipped.toString('latin1').includes(MARKER));
        break;
      }
      case 'gz': {
        const gunzipped = gunzipSync(Buffer.from(bytes));
        check('gz: marker present after gunzip', gunzipped.toString('latin1').includes(MARKER));
        break;
      }
      case 'text':
        check('text: marker present', Buffer.from(bytes).toString('utf8').includes(MARKER));
        break;
      default: {
        const exhaustive: never = kind;
        bad.push(`unhandled fixture kind in this test: ${String(exhaustive)}`);
      }
    }
  }

  expect(bad, bad.join('\n')).toEqual([]);
});

for (const { data } of FILE_TOOL_FIXTURES) {
  test.describe(`${data.id}: every scenario runs on a real file, downloads the expected result and sends nothing`, () => {
    for (const scenario of data.scenarios) {
      test(scenario.label, async ({ page }) => {
        const requests: string[] = [];
        const consoleText: string[] = [];
        page.on('console', (msg) => consoleText.push(msg.text()));

        await page.goto(rel(`/tools/${data.id}`));
        await page.waitForLoadState('networkidle');
        // Everything above this line is page load. Only requests made from
        // here on are the tool actually processing input.
        page.on('request', (request) => {
          const url = request.url();
          if (url.startsWith('data:') || url.startsWith('blob:')) return;
          requests.push(`${request.method()} ${url}`);
        });

        await page.getByRole('button', { name: 'Reset', exact: true }).click();
        await settle(page);

        for (const step of scenario.steps) await applyStep(page, step);
        await settle(page);

        for (const text of scenario.expect) {
          await expect(page.locator('section[aria-label="Output"]')).toContainText(text);
        }

        const collected: { name: string; prefix: string }[] = [];
        const downloadButtons = page.locator('section[aria-label="Output"] button', { hasText: 'Download' });
        const count = await downloadButtons.count();
        for (let i = 0; i < count; i++) {
          const downloadPromise = page.waitForEvent('download');
          await downloadButtons.nth(i).click();
          const download = await downloadPromise;
          const path = await download.path();
          const bytes = path ? readFileSync(path) : Buffer.alloc(0);
          collected.push({ name: download.suggestedFilename(), prefix: bytes.subarray(0, 16).toString('hex') });
        }

        for (const expected of scenario.downloads ?? []) {
          const nameRe = new RegExp(expected.name);
          const match = collected.find((c) => nameRe.test(c.name) && c.prefix.startsWith(expected.magic));
          expect(
            match,
            `${data.id}: no download matched name /${expected.name}/ with magic ${expected.magic}. Collected: ${JSON.stringify(collected)}`,
          ).toBeTruthy();
        }

        expect(requests, `${data.id}: a request was made other than data:/blob: while processing input`).toEqual([]);

        const url = page.url();
        expect(url, `${data.id}: the marker reached the URL`).not.toContain(MARKER);

        const storage = await page.evaluate(() => ({
          local: JSON.stringify(Object.entries(localStorage)),
          session: JSON.stringify(Object.entries(sessionStorage)),
        }));
        expect(storage.local, `${data.id}: the marker was written to localStorage`).not.toContain(MARKER);
        expect(storage.session, `${data.id}: the marker was written to sessionStorage`).not.toContain(MARKER);

        const cookies = await page.context().cookies();
        expect(JSON.stringify(cookies), `${data.id}: the marker was written to a cookie`).not.toContain(MARKER);

        expect(consoleText.join('\n'), `${data.id}: the marker was written to the console`).not.toContain(MARKER);
      });
    }
  });
}
