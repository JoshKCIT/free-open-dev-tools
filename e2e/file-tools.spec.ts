import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtureFiles, FIXTURE_FILE_KINDS, type FixtureFileKind } from './fixture-files';

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
