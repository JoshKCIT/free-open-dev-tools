import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';

/**
 * Behavioural proof, for the developer tools of phase 16, that the page gives the same answers as an independent
 * oracle in every browser: each test enters recorded cases on the page the way a visitor would and compares what the
 * page shows, row by row, with what the oracle computes in the test process. Read in four browser projects: chromium,
 * firefox, webkit and mobile-chrome (the Pixel 7 emulation).
 *
 * The oracle for the Semantic Version Range Checker & Sorter is npm's own semver package, version 7.8.5, loaded here
 * from the tool folder's own node_modules (an independent run of the package in the test process, never the page's
 * build), so a wrong option wiring, a lost value or a hidden field that leaks into a result shows up as a difference.
 * The plans that follow append one test per tool to this file: the docker run converter (16-04), the web app manifest
 * builder (16-05), the IDN converter (16-06) and the date calculator (16-08).
 *
 * A spec of its own, with its own helpers copied in shape from e2e/security-secrets.spec.ts and e2e/dev-workers.spec.ts,
 * because a shared test helper would make every importing spec run whole for every tool.
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
 * Fills a field and checks the value stayed. The pages are prerendered, so a field filled in the first moments after
 * load can be cleared again when the page finishes starting; the fill is repeated until it holds.
 */
async function fillAndHold(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

interface SemverOptions {
  loose?: boolean;
  includePrerelease?: boolean;
}

/** The parts of npm's semver package the test uses, from the package folder of the tool (not from the page). */
interface SemverOracle {
  satisfies: (version: string, range: string, options: SemverOptions) => boolean;
  valid: (version: string, options: SemverOptions) => string | null;
  maxSatisfying: (versions: string[], range: string, options: SemverOptions) => string | null;
  minVersion: (range: string, options: SemverOptions) => { version: string } | null;
  compare: (a: string, b: string, options: SemverOptions) => number;
  Range: new (range: string, options: SemverOptions) => { range: string };
}

const semverRequire = createRequire(new URL('../tools/semver-checker/package.json', import.meta.url));
const semver = semverRequire('semver') as SemverOracle;
const semverVersion = (semverRequire('semver/package.json') as { version: string }).version;

interface Batch {
  range: string;
  loose: boolean;
  includePrerelease: boolean;
  versions: string[];
}

/**
 * The recorded checks: 6 batches of 5 versions, 30 (range, version, options) checks in all, chosen at and around the
 * boundaries of caret, tilde, hyphen, x and alternative ranges, with pre-releases, build metadata, loose forms and a
 * line that is not a version. Only inputs are recorded here; every expected answer is computed by the oracle.
 */
const BATCHES: Batch[] = [
  {
    range: '^1.2.3',
    loose: false,
    includePrerelease: false,
    versions: ['1.2.2', '1.2.3', '1.9.9', '2.0.0', '2.0.0-alpha'],
  },
  {
    range: '^1.2.3',
    loose: false,
    includePrerelease: true,
    versions: ['1.2.4-beta.1', '1.2.3-beta.2', '1.3.0', '2.0.0-0', '1.2.2-9'],
  },
  {
    range: '~1.2.3-beta.1 || >=4.0.0 <5.0.0',
    loose: false,
    includePrerelease: false,
    versions: ['1.2.3-beta.2', '1.2.4-beta.1', '1.2.9', '4.5.6', '5.0.0'],
  },
  {
    range: '1.2.3 - 2.3.4',
    loose: false,
    includePrerelease: false,
    versions: ['1.2.3', '2.3.4', '2.3.5', '1.2.3-pre', '0.0.0'],
  },
  {
    range: '>1.x || <=0.5',
    loose: true,
    includePrerelease: false,
    versions: ['=1.5.0', 'v2.0.0', '0.5.0', '0.5.1', '1.0.0beta'],
  },
  {
    range: '*',
    loose: true,
    includePrerelease: true,
    versions: ['0.0.0', '1.0.0-beta', 'not-a-version', '1.2', '2.0.0+build.5'],
  },
];

/** What the oracle says a page should show for one batch: the answer for each line and the summary values. */
function expectedFor(batch: Batch) {
  const options: SemverOptions = { loose: batch.loose, includePrerelease: batch.includePrerelease };
  const rows = batch.versions.map((version, index) => [
    String(index + 1),
    version,
    semver.valid(version, options) === null
      ? 'not a valid version'
      : semver.satisfies(version, batch.range, options)
        ? 'satisfies'
        : 'does not satisfy',
  ]);
  const validVersions = batch.versions.filter((version) => semver.valid(version, options) !== null);
  return {
    rows,
    normalized: new semver.Range(batch.range, options).range || '*',
    highest: semver.maxSatisfying(validVersions, batch.range, options) ?? 'none of the pasted versions satisfy it',
    lowest: semver.minVersion(batch.range, options)?.version ?? 'none, this range allows no version',
  };
}

/** What the page shows in check mode: the summary pairs and every row of the result table. */
async function readCheck(page: Page): Promise<{ pairs: Record<string, string>; rows: string[][] }> {
  return outputArea(page).evaluate((section) => {
    const pairs: Record<string, string> = {};
    for (const term of Array.from(section.querySelectorAll('dl.kv dt'))) {
      pairs[term.textContent ?? ''] = term.nextElementSibling?.textContent ?? '';
    }
    const rows = Array.from(section.querySelectorAll('table tbody tr')).map((tr) =>
      Array.from(tr.children).map((cell) => cell.textContent ?? ''),
    );
    return { pairs, rows };
  });
}

test('semver-checker: the page gives the same answers as node-semver in every browser', async ({ page }) => {
  expect(semverVersion, 'the oracle is the package version the tool pins').toBe('7.8.5');
  expect(BATCHES.flatMap((batch) => batch.versions).length).toBe(30);

  await openTool(page, 'semver-checker');
  await page.locator('input[name="mode"][value="check"]').click();

  for (const batch of BATCHES) {
    const expected = expectedFor(batch);
    await page.locator('#f-loose').setChecked(batch.loose);
    await page.locator('#f-includePrerelease').setChecked(batch.includePrerelease);
    await fillAndHold(page, 'range', batch.range);
    await fillAndHold(page, 'versions', batch.versions.join('\n'));

    // The page answers a moment after the last change, so the whole answer is read again until it is the oracle's.
    await expect(async () => {
      const shown = await readCheck(page);
      expect(
        shown.rows,
        `${batch.range} (loose ${batch.loose}, include pre-releases ${batch.includePrerelease})`,
      ).toEqual(expected.rows);
      expect(shown.pairs['Normalised range']).toBe(expected.normalized);
      expect(shown.pairs['Highest satisfying']).toBe(expected.highest);
      expect(shown.pairs['Lowest version the range allows']).toBe(expected.lowest);
    }).toPass({ timeout: 10_000 });
  }
});

test('semver-checker: a range and an include pre-releases tick left in check mode never change what sort mode shows', async ({
  page,
}) => {
  const pasted = ['1.10.0', '1.2.0', '1.0.0+b', '1.0.0+a', 'latest', '1.2.0-rc.1', '2.0.0-beta.11', '2.0.0-beta.2'];
  // The oracle: valid lines ordered by precedence with a stable sort, in the test process.
  const options: SemverOptions = { loose: false };
  const expectedSorted = pasted
    .filter((line) => semver.valid(line, options) !== null)
    .sort((a, b) => semver.compare(a, b, options));

  async function sortedOutput(withLeftovers: boolean): Promise<string> {
    await openTool(page, 'semver-checker');
    if (withLeftovers) {
      // A range the page cannot read and a ticked option, both set while the mode shows them.
      await page.locator('input[name="mode"][value="check"]').click();
      await fillAndHold(page, 'range', 'FODT-MARKER-4417');
      await page.locator('#f-includePrerelease').setChecked(true);
    }
    await page.locator('input[name="mode"][value="sort"]').click();
    await expect(page.locator('#f-range')).toHaveCount(0);
    await fillAndHold(page, 'versions', pasted.join('\n'));
    await expect(outputArea(page).locator('pre').first()).toHaveText(expectedSorted.join('\n'), { timeout: 10_000 });
    return outputArea(page).innerText();
  }

  const fresh = await sortedOutput(false);
  const afterLeftovers = await sortedOutput(true);
  expect(afterLeftovers).toBe(fresh);
  expect(fresh).not.toContain('not a valid range');
});
