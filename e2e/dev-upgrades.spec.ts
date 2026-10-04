import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * The upgraded pages keep their old answers and gain new ones (D-180). Each test opens an upgraded page the way a
 * visitor would, checks that what the page did before is unchanged, and checks the new answers against a decoder
 * written in this file (it shares no code with the packages). Read in four browser projects: chromium, firefox, webkit
 * and mobile-chrome (the Pixel 7 emulation).
 *
 * This file holds the UUID Generator & Parser tests (16-07). The plans that follow append one group of tests per
 * upgraded page: the date calculator (16-08), the random number generator (16-09) and the file hash and XML pages (16-10).
 *
 * A spec of its own, with its own helpers copied in shape from e2e/dev-oracles.spec.ts, because a shared test helper
 * would make every importing spec run whole for every tool.
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

async function run(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run', exact: true }).click();
}

/** The lines of the first code block of the output, as written. */
async function readIds(page: Page): Promise<string[]> {
  const text = await outputArea(page)
    .locator('pre.output')
    .first()
    .textContent({ timeout: 500 })
    .catch(() => null);
  return text === null || text === '' ? [] : text.split('\n');
}

/** The label above the first code block, such as "7 ULIDs". */
async function readLabel(page: Page): Promise<string> {
  return (
    (await outputArea(page)
      .locator('.output-label > span:first-child')
      .first()
      .textContent({ timeout: 500 })
      .catch(() => '')) ?? ''
  );
}

/** The pairs of the first key and value block of the output. */
async function readPairs(page: Page): Promise<Record<string, string>> {
  return outputArea(page).evaluate((section) => {
    const pairs: Record<string, string> = {};
    for (const term of Array.from(section.querySelectorAll('dl.kv dt'))) {
      pairs[term.textContent ?? ''] = term.nextElementSibling?.textContent ?? '';
    }
    return pairs;
  });
}

/** Chooses a version or format and presses Run until the first code block holds the expected ids (the shape test). */
async function generate(page: Page, version: string, count: number, shape: RegExp): Promise<string[]> {
  await page.locator('#f-version').selectOption(version);
  await fillAndHold(page, 'count', String(count));
  await run(page);
  let ids: string[] = [];
  await expect
    .poll(
      async () => {
        ids = await readIds(page);
        return ids.length === count && ids.every((id) => shape.test(id));
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return ids;
}

const ULID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const KSUID_SHAPE = /^[0-9A-Za-z]{27}$/;
const OBJECT_ID_SHAPE = /^[0-9a-f]{24}$/;
const SNOWFLAKE_SHAPE = /^[0-9]{1,19}$/;
const V4_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Decoders for the test, written from the published layouts and sharing no code with the package.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SNOWFLAKE_EPOCH = 1288834974657;

function ulidMs(id: string): number {
  let value = 0n;
  for (const ch of id) value = value * 32n + BigInt(CROCKFORD.indexOf(ch));
  return Number(value >> 80n);
}

function ksuidUnixSeconds(id: string): number {
  let value = 0n;
  for (const ch of id) value = value * 62n + BigInt(BASE62.indexOf(ch));
  return Number(value >> 128n) + 1_400_000_000;
}

function objectIdSeconds(id: string): number {
  return parseInt(id.slice(0, 8), 16);
}

function snowflakeParts(id: string, epoch: number) {
  const value = BigInt(id);
  return {
    ms: Number(value >> 22n) + epoch,
    datacenter: Number((value >> 17n) & 31n),
    worker: Number((value >> 12n) & 31n),
    sequence: Number(value & 4095n),
  };
}

/** The page and the test run on one machine, so a time the page read from its clock is close to this one. */
function expectNear(isoText: string, expectedMs: number, toleranceMs: number): void {
  const shown = Date.parse(isoText);
  expect(Number.isNaN(shown), `${isoText} is a date`).toBe(false);
  expect(Math.abs(shown - Date.now()), `${isoText} is close to now`).toBeLessThan(toleranceMs);
  expect(shown, `${isoText} is the time the id carries`).toBe(expectedMs);
}

test('uuid: every new format generates and the inspect box decodes what it generated', async ({ page }) => {
  await openTool(page, 'uuid');

  // ULID
  const ulids = await generate(page, 'ulid', 7, ULID_SHAPE);
  expect(new Set(ulids).size).toBe(7);
  expect([...ulids].sort()).toEqual(ulids); // ids made together count up, so they already sort
  expect(await readLabel(page)).toBe('7 ULIDs');
  // Anything that is not a UUID version hides the UUID-only settings, so generating changed no UUID setting.
  await page.locator('input[name="mode"][value="inspect"]').click();
  await fillAndHold(page, 'toInspect', ulids[3]!);
  await run(page);
  await expect.poll(async () => (await readPairs(page))['Format']).toBe('ULID');
  let pairs = await readPairs(page);
  const ulidTime = ulidMs(ulids[3]!);
  expect(pairs['Time']).toBe(`${ulidTime} ms since 1970-01-01`);
  expect(pairs['ISO time']).toBe(new Date(ulidTime).toISOString());
  expectNear(pairs['ISO time']!, ulidTime, 120_000);
  expect(pairs['Random part']).toMatch(/^[0-9a-f]{20} \(80 bits\)$/);

  // KSUID
  await page.locator('input[name="mode"][value="generate"]').click();
  const ksuids = await generate(page, 'ksuid', 7, KSUID_SHAPE);
  expect(new Set(ksuids).size).toBe(7);
  expect(await readLabel(page)).toBe('7 KSUIDs');
  await page.locator('input[name="mode"][value="inspect"]').click();
  await fillAndHold(page, 'toInspect', ksuids[2]!);
  await run(page);
  await expect.poll(async () => (await readPairs(page))['Format']).toBe('KSUID');
  pairs = await readPairs(page);
  const ksuidSeconds = ksuidUnixSeconds(ksuids[2]!);
  expect(pairs['Time']).toBe(`${ksuidSeconds} s since 1970-01-01`);
  expect(pairs['ISO time']).toBe(new Date(ksuidSeconds * 1000).toISOString());
  expectNear(pairs['ISO time']!, ksuidSeconds * 1000, 120_000);
  expect(pairs['Stored timestamp']).toBe(`${ksuidSeconds - 1_400_000_000} s since 2014-05-13T16:53:20Z`);
  expect(pairs['Payload']).toMatch(/^[0-9A-F]{32} \(128 bits\)$/);

  // MongoDB ObjectId
  await page.locator('input[name="mode"][value="generate"]').click();
  const objectIds = await generate(page, 'objectid', 7, OBJECT_ID_SHAPE);
  expect(new Set(objectIds).size).toBe(7);
  expect(await readLabel(page)).toBe('7 ObjectIds');
  await page.locator('input[name="mode"][value="inspect"]').click();
  await fillAndHold(page, 'toInspect', objectIds[4]!);
  await run(page);
  await expect.poll(async () => (await readPairs(page))['Format']).toBe('MongoDB ObjectId');
  pairs = await readPairs(page);
  const objectIdTime = objectIdSeconds(objectIds[4]!);
  expect(pairs['Time']).toBe(`${objectIdTime} s since 1970-01-01`);
  expect(pairs['ISO time']).toBe(new Date(objectIdTime * 1000).toISOString());
  expectNear(pairs['ISO time']!, objectIdTime * 1000, 120_000);
  expect(pairs['Random value']).toBe(`${objectIds[4]!.slice(8, 18)} (5 bytes)`);
  expect(pairs['Counter']).toBe(String(parseInt(objectIds[4]!.slice(18), 16)));
  // The counter counts up by one from id to id and the random value stays the same for the page load.
  for (let i = 1; i < objectIds.length; i++) {
    expect(objectIds[i]!.slice(8, 18)).toBe(objectIds[0]!.slice(8, 18));
    expect(
      (parseInt(objectIds[i]!.slice(18), 16) - parseInt(objectIds[i - 1]!.slice(18), 16) + 2 ** 24) % 2 ** 24,
    ).toBe(1);
  }

  // Snowflake ID with the default epoch
  await page.locator('input[name="mode"][value="generate"]').click();
  const snowflakes = await generate(page, 'snowflake', 7, SNOWFLAKE_SHAPE);
  expect(new Set(snowflakes).size).toBe(7);
  expect(snowflakes.map((id) => BigInt(id))).toEqual(
    [...snowflakes.map((id) => BigInt(id))].sort((a, b) => (a < b ? -1 : 1)),
  );
  expect(await readLabel(page)).toBe('7 Snowflake IDs');
  await page.locator('input[name="mode"][value="inspect"]').click();
  await fillAndHold(page, 'toInspect', snowflakes[5]!);
  await run(page);
  await expect.poll(async () => (await readPairs(page))['Format']).toBe('Snowflake ID');
  pairs = await readPairs(page);
  const flake = snowflakeParts(snowflakes[5]!, SNOWFLAKE_EPOCH);
  expect(pairs['Time']).toBe(`${flake.ms} ms since 1970-01-01`);
  expect(pairs['ISO time']).toBe(new Date(flake.ms).toISOString());
  expectNear(pairs['ISO time']!, flake.ms, 120_000);
  expect(pairs['Epoch used']).toBe('2010-11-04T01:42:54.657Z (epoch ms 1288834974657)');
  expect([pairs['Datacenter'], pairs['Worker'], pairs['Sequence']]).toEqual(['0', '0', String(flake.sequence)]);
  // The published worked example, against its own epoch and against the Unix epoch typed in the Epoch box.
  await fillAndHold(page, 'toInspect', '1888944671579078978');
  await run(page);
  await expect.poll(async () => (await readPairs(page))['ISO time']).toBe('2025-02-10T13:34:39.256Z');
  pairs = await readPairs(page);
  expect([pairs['Datacenter'], pairs['Worker'], pairs['Sequence']]).toEqual(['11', '8', '322']);
  await fillAndHold(page, 'epoch', '0');
  await run(page);
  await expect.poll(async () => (await readPairs(page))['Epoch used']).toBe('1970-01-01T00:00:00.000Z (epoch ms 0)');
  expect((await readPairs(page))['Time']).toBe('450359504599 ms since 1970-01-01');
  await fillAndHold(page, 'epoch', '2010-11-04T01:42:54.657Z');
  await run(page);
  await expect.poll(async () => (await readPairs(page))['ISO time']).toBe('2025-02-10T13:34:39.256Z');

  // NanoID: the default size and alphabet, and no decoding (a NanoID has no fields to read).
  await page.locator('input[name="mode"][value="generate"]').click();
  const nanoids = await generate(page, 'nanoid', 7, /^[A-Za-z0-9_-]{21}$/);
  expect(new Set(nanoids).size).toBe(7);
  expect(await readLabel(page)).toBe('7 NanoIDs');
  await page.locator('input[name="mode"][value="inspect"]').click();
  await fillAndHold(page, 'toInspect', nanoids[0]!);
  await run(page);
  await expect(outputArea(page).locator('ul.issue-list')).toContainText(
    'This is not a UUID: it needs 32 hexadecimal digits.',
  );

  // Text that is a UUID is still read as a UUID first.
  await fillAndHold(page, 'toInspect', '2ed6657d-e927-568b-95e1-2665a8aea6a2');
  await run(page);
  await expect.poll(async () => (await readPairs(page))['Canonical']).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  expect((await readPairs(page))['Version']).toBe('5');
});

test('uuid: the default page still generates five version 4 UUIDs', async ({ page }) => {
  await openTool(page, 'uuid');
  // First paint: Generate, version 4, five ids, and none of the new formats' settings on screen.
  await expect(page.locator('input[name="mode"][value="generate"]')).toBeChecked();
  await expect(page.locator('#f-version')).toHaveValue('4');
  await expect(page.locator('#f-count')).toHaveValue('5');
  for (const name of ['size', 'alphabet', 'epoch', 'datacenter', 'worker', 'namespace', 'name']) {
    await expect(page.locator(`#f-${name}`), `${name} is hidden for version 4`).toHaveCount(0);
  }
  for (const name of ['uppercase', 'hyphens', 'wrapper']) await expect(page.locator(`#f-${name}`)).toBeVisible();
  // The five UUID versions are still the first five options, in their old order, with the new formats after them.
  expect(
    await page
      .locator('#f-version option')
      .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value)),
  ).toEqual(['4', '7', '1', '5', '3', 'ulid', 'nanoid', 'ksuid', 'snowflake', 'objectid']);

  await run(page);
  await expect.poll(async () => (await readIds(page)).length).toBe(5);
  const ids = await readIds(page);
  for (const id of ids) expect(id).toMatch(V4_SHAPE);
  expect(new Set(ids).size).toBe(5);
  expect(await readLabel(page)).toBe('5 UUIDs');

  // Version 5 keeps giving the RFC 9562 appendix A answer, and its namespace and name fields are back on screen.
  await page.locator('#f-version').selectOption('5');
  await expect(page.locator('#f-namespace')).toBeVisible();
  await expect(page.locator('#f-name')).toBeVisible();
  await fillAndHold(page, 'count', '1');
  await run(page);
  await expect.poll(async () => (await readIds(page))[0]).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  // Version 3 too.
  await page.locator('#f-version').selectOption('3');
  await run(page);
  await expect.poll(async () => (await readIds(page))[0]).toBe('5df41881-3aed-3515-88a7-2f4a814cf09e');

  // Uppercase, no hyphens and braces still work for a UUID version.
  await page.locator('#f-version').selectOption('4');
  await page.locator('#f-uppercase').setChecked(true);
  await page.locator('#f-hyphens').setChecked(false);
  await page.locator('#f-wrapper').selectOption('braces');
  await run(page);
  await expect
    .poll(async () => (await readIds(page))[0])
    .toMatch(/^\{[0-9A-F]{8}[0-9A-F]{4}4[0-9A-F]{3}[89AB][0-9A-F]{3}[0-9A-F]{12}\}$/);

  // Inspect keeps its earlier answers: a UUID is read, and text that is nothing is refused with the old sentence.
  await page.locator('input[name="mode"][value="inspect"]').click();
  await fillAndHold(page, 'toInspect', 'not an identifier');
  await run(page);
  await expect(outputArea(page).locator('ul.issue-list')).toContainText(
    'This is not a UUID: it needs 32 hexadecimal digits.',
  );
  await fillAndHold(page, 'toInspect', '2ed6657d-e927-568b-95e1-2665a8aea6a2');
  await run(page);
  await expect.poll(async () => (await readPairs(page))['Version']).toBe('5');
  expect((await readPairs(page))['Variant']).toBe('RFC 9562 (the normal one)');
});

test('uuid: a hidden setting of one format never changes another format output', async ({ page }) => {
  await openTool(page, 'uuid');

  // Visibility: each setting is on screen only for its own format, and the UUID-only settings come back for version 7.
  const visibleFor: Record<string, string[]> = {
    ulid: [],
    nanoid: ['size', 'alphabet'],
    ksuid: [],
    snowflake: ['epoch', 'datacenter', 'worker'],
    objectid: [],
  };
  const settings = ['size', 'alphabet', 'epoch', 'datacenter', 'worker'];
  for (const [format, shown] of Object.entries(visibleFor)) {
    await page.locator('#f-version').selectOption(format);
    for (const name of settings) await expect(page.locator(`#f-${name}`)).toHaveCount(shown.includes(name) ? 1 : 0);
    for (const name of ['uppercase', 'hyphens', 'wrapper', 'namespace', 'name']) {
      await expect(page.locator(`#f-${name}`), `${name} is hidden for ${format}`).toHaveCount(0);
    }
  }
  await page.locator('#f-version').selectOption('7');
  for (const name of ['uppercase', 'hyphens', 'wrapper']) await expect(page.locator(`#f-${name}`)).toBeVisible();
  for (const name of settings) await expect(page.locator(`#f-${name}`)).toHaveCount(0);

  // UUID-only settings are set while a UUID version is chosen, then a new format is run: its ids stay in their own form.
  await page.locator('#f-uppercase').setChecked(true);
  await page.locator('#f-hyphens').setChecked(false);
  await page.locator('#f-wrapper').selectOption('urn');
  await generate(page, 'objectid', 4, /^[0-9a-f]{24}$/); // lower case, no wrapper, whatever the hidden settings hold
  await generate(page, 'ulid', 4, ULID_SHAPE);
  await generate(page, 'ksuid', 4, KSUID_SHAPE);

  // Snowflake settings are set, then another format is run, then the snowflake is run again with them kept.
  await page.locator('#f-version').selectOption('snowflake');
  await fillAndHold(page, 'datacenter', '3');
  await fillAndHold(page, 'worker', '7');
  await fillAndHold(page, 'epoch', '0');
  const first = await generate(page, 'snowflake', 4, SNOWFLAKE_SHAPE);
  for (const id of first) {
    const parts = snowflakeParts(id, 0);
    expect([parts.datacenter, parts.worker]).toEqual([3, 7]);
    expectNear(new Date(parts.ms).toISOString(), parts.ms, 120_000); // the Unix epoch gives the real time
  }

  // NanoID with a two letter alphabet and its own size: the hidden datacenter, worker and epoch change nothing.
  await page.locator('#f-version').selectOption('nanoid');
  await fillAndHold(page, 'alphabet', 'ab');
  await fillAndHold(page, 'size', '40');
  await generate(page, 'nanoid', 4, /^[ab]{40}$/);
  // Back to other formats: the alphabet and size, now hidden, change nothing there.
  const ulids = await generate(page, 'ulid', 4, ULID_SHAPE);
  expect(ulids.every((id) => id.length === 26)).toBe(true);
  await generate(page, 'ksuid', 4, KSUID_SHAPE);
  await generate(page, 'objectid', 4, OBJECT_ID_SHAPE);
  // The snowflake settings were kept while hidden.
  const again = await generate(page, 'snowflake', 4, SNOWFLAKE_SHAPE);
  for (const id of again) expect([snowflakeParts(id, 0).datacenter, snowflakeParts(id, 0).worker]).toEqual([3, 7]);
  // A NanoID asked for after a default alphabet is typed again uses the typed alphabet again, not a leftover one.
  await page.locator('#f-version').selectOption('nanoid');
  await expect(page.locator('#f-alphabet')).toHaveValue('ab');
  await fillAndHold(page, 'alphabet', 'xyz');
  await generate(page, 'nanoid', 3, /^[xyz]{40}$/);

  // The page can be put back: a UUID version still gives UUIDs after all of this.
  await page.locator('#f-version').selectOption('4');
  await fillAndHold(page, 'count', '2');
  await run(page);
  await expect.poll(async () => (await readIds(page)).length).toBe(2);
  const uuids = await readIds(page);
  for (const id of uuids) expect(id).toMatch(/^urn:uuid:[0-9A-F]{32}$/); // the settings made earlier still apply to a UUID
});

// --- Date & Duration Calculator (16-08): business days, ISO week numbers and ISO 8601 durations; the old modes unchanged ---

/** One row of the Python table recorded for business days (tools/date-diff/test/fixtures/business-days.json). */
interface RecordedBusinessRow {
  start: string;
  end: string;
  weekend: number[];
  holidays: string[];
  includeEnd: boolean;
  count: number;
  sign: 1 | -1;
  calendarDays: number;
  weekendDays: number;
  holidaysSkipped: number;
  holidaysOnWeekend: number;
}

const BUSINESS_TABLE = JSON.parse(
  readFileSync(new URL('../tools/date-diff/test/fixtures/business-days.json', import.meta.url), 'utf8'),
) as { python: string; rows: RecordedBusinessRow[] };

/** Twenty-four rows of the recorded table: reversed, equal, huge, no weekend, with holidays and plain, by a fixed seed. */
function recordedBusinessSample(): RecordedBusinessRow[] {
  const rows = BUSINESS_TABLE.rows;
  const kinds: [string, (row: RecordedBusinessRow) => boolean, number][] = [
    ['reversed', (row) => row.sign === -1, 4],
    ['equal', (row) => row.start === row.end, 4],
    ['huge', (row) => row.calendarDays > 1_000_000, 2],
    ['no weekend', (row) => row.weekend.length === 0, 3],
    ['with holidays', (row) => row.holidays.length > 3 && row.sign === 1 && row.start !== row.end, 6],
    ['plain', (row) => row.holidays.length === 0 && row.sign === 1 && row.start !== row.end, 5],
  ];
  const picked: RecordedBusinessRow[] = [];
  let seed = 20261004;
  for (const [, matches, wanted] of kinds) {
    const pool = rows.filter(matches);
    for (let taken = 0; taken < wanted; taken++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      picked.push(pool[seed % pool.length] as RecordedBusinessRow);
    }
  }
  return picked;
}

/** The issues listed under the output, as one text with each run of white space made a single space. */
async function readIssues(page: Page): Promise<string> {
  const text = await outputArea(page)
    .locator('ul.issue-list')
    .first()
    .textContent({ timeout: 500 })
    .catch(() => '');
  return (text ?? '').split(/\s+/).join(' ');
}

async function readTable(page: Page): Promise<string[][]> {
  return outputArea(page)
    .locator('table tbody tr')
    .evaluateAll((trs) => trs.map((tr) => Array.from(tr.children).map((cell) => cell.textContent ?? '')));
}

async function chooseMode(page: Page, mode: string): Promise<void> {
  await page.locator(`input[name="mode"][value="${mode}"]`).click();
}

/** Types a business day question and waits until the page shows the answer to it (retrying while the page catches up). */
async function businessAnswer(
  page: Page,
  question: { start: string; end: string; weekend: string; holidays: string; includeEnd: boolean },
  want: Record<string, string>,
  label: string,
): Promise<void> {
  // The start is blanked first, so the page shows no result until the whole question is typed (no earlier answer can
  // be mistaken for this one), and typed last.
  await fillAndHold(page, 'start', '');
  await expect(outputArea(page).locator('dl.kv')).toHaveCount(0);
  await fillAndHold(page, 'end', question.end);
  await fillAndHold(page, 'weekend', question.weekend);
  await fillAndHold(page, 'holidays', question.holidays);
  await page.locator(`input[name="endDay"][value="${question.includeEnd ? 'included' : 'excluded'}"]`).click();
  await fillAndHold(page, 'start', question.start);
  await expect(async () => {
    const pairs = await readPairs(page);
    for (const [name, value] of Object.entries(want)) expect(pairs[name], `${label}: ${name}`).toBe(value);
  }).toPass({ timeout: 10_000 });
}

test('date-diff: business days, ISO weeks and durations show their results and the old modes answer as before', async ({
  page,
}) => {
  await openTool(page, 'date-diff');

  // First paint: the difference mode, the two moment fields, and none of the new fields on screen.
  await expect(page.locator('input[name="mode"][value="difference"]')).toBeChecked();
  expect(
    await page.locator('input[name="mode"]').evaluateAll((radios) => radios.map((r) => (r as HTMLInputElement).value)),
  ).toEqual(['difference', 'add', 'subtract', 'business', 'weeks', 'duration', 'build']);
  await expect(page.locator('#f-start')).toBeVisible();
  await expect(page.locator('#f-end')).toBeVisible();
  for (const name of ['duration', 'weekend', 'holidays', 'dates', 'isoDuration', 'years', 'minutes', 'seconds']) {
    await expect(page.locator(`#f-${name}`), `${name} is hidden at first paint`).toHaveCount(0);
  }
  await expect(page.locator('input[name="endDay"]')).toHaveCount(0);

  // The old modes, answering as before: the gap, the clamped month, the old refusal of a fraction, a subtracted week.
  await fillAndHold(page, 'start', '2024-01-31');
  await fillAndHold(page, 'end', '2024-03-01');
  await expect.poll(async () => (await readPairs(page))['As an ISO 8601 duration']).toBe('P1M1D');
  let pairs = await readPairs(page);
  // Days is shown twice (the calendar breakdown, 1, then the exact elapsed time, 30); the pairs hold the last, the exact one.
  expect([pairs['Years'], pairs['Months'], pairs['Days'], pairs['Total seconds']]).toEqual(['0', '1', '30', '2592000']);
  await chooseMode(page, 'add');
  await fillAndHold(page, 'duration', 'P1M');
  await expect.poll(async () => (await readPairs(page))['Date only']).toBe('2024-02-29');
  await fillAndHold(page, 'duration', 'P1.5D');
  await expect.poll(readIssues.bind(null, page)).toContain('is not an RFC 3339 Appendix A duration');
  await chooseMode(page, 'subtract');
  await fillAndHold(page, 'start', '2024-11-03T01:30');
  await fillAndHold(page, 'duration', 'P1W');
  await expect.poll(async () => (await readPairs(page))['Date only']).toBe('2024-10-27');

  // Business days: the worked example (Python: 5 with the end left out, 6 with it counted; a holiday on a Saturday
  // changes nothing; one on a Wednesday takes a day away however often it is typed).
  await chooseMode(page, 'business');
  for (const name of ['end', 'weekend', 'holidays']) await expect(page.locator(`#f-${name}`)).toBeVisible();
  await expect(page.locator('#f-duration')).toHaveCount(0);
  await expect(page.locator('#f-weekend')).toHaveValue('Sat, Sun');
  const monday = { start: '2024-01-01', end: '2024-01-08', weekend: 'Sat, Sun', holidays: '', includeEnd: false };
  await businessAnswer(
    page,
    monday,
    { 'Business days': '5', 'Calendar days': '7', 'Weekend days skipped': '2', 'End day': 'Not counted' },
    'plain',
  );
  await businessAnswer(
    page,
    { ...monday, includeEnd: true },
    { 'Business days': '6', 'Calendar days': '8' },
    'end counted',
  );
  await businessAnswer(
    page,
    { ...monday, holidays: '2024-01-06' },
    { 'Business days': '5', 'Holidays skipped': '0', 'Holidays on weekend days': '1' },
    'holiday on a Saturday',
  );
  await businessAnswer(
    page,
    { ...monday, holidays: '2024-01-03\n2024-01-03\n\n2024-01-03' },
    { 'Business days': '4', 'Holidays skipped': '1', 'Holidays on weekend days': '0' },
    'holiday on a Wednesday typed three times',
  );
  await businessAnswer(page, { ...monday, weekend: '5, 6' }, { 'Business days': '5' }, 'Friday and Saturday off');
  await businessAnswer(page, { ...monday, weekend: 'friday saturday' }, { 'Business days': '5' }, 'day names in words');
  await businessAnswer(
    page,
    { ...monday, weekend: '' },
    { 'Business days': '7', 'Weekend days skipped': '0' },
    'no weekend',
  );
  // The edge probe: equal dates, an end before the start (a minus sign), and the two ends of the calendar.
  const same = { start: '2024-01-01', end: '2024-01-01', weekend: 'Sat, Sun', holidays: '', includeEnd: true };
  await businessAnswer(page, same, { 'Business days': '1' }, 'start equals end, end counted');
  await businessAnswer(
    page,
    { ...same, includeEnd: false },
    { 'Business days': '0' },
    'start equals end, end left out',
  );
  await businessAnswer(
    page,
    { ...same, start: '2024-01-06', end: '2024-01-06', includeEnd: true },
    { 'Business days': '0' },
    'a Saturday',
  );
  await businessAnswer(
    page,
    { ...monday, start: '2024-01-08', end: '2024-01-01' },
    { 'Business days': '-5' },
    'end before the start',
  );
  await expect(outputArea(page)).toContainText('The end is before the start, so the count has a minus sign.');
  await businessAnswer(
    page,
    { ...same, start: '0001-01-01', end: '0001-01-08', includeEnd: false },
    { 'Business days': '5' },
    'year 0001',
  );
  await businessAnswer(
    page,
    { ...same, start: '9999-12-24', end: '9999-12-31', includeEnd: true },
    { 'Business days': '6' },
    'year 9999',
  );

  // Twenty-four rows of the table Python recorded, typed the way a visitor would.
  const sample = recordedBusinessSample();
  expect(sample).toHaveLength(24);
  for (const row of sample) {
    await businessAnswer(
      page,
      {
        start: row.start,
        end: row.end,
        weekend: row.weekend.join(', '),
        holidays: row.holidays.join('\n'),
        includeEnd: row.includeEnd,
      },
      {
        'Business days': row.sign === -1 && row.count > 0 ? `-${row.count}` : String(row.count),
        'Calendar days': String(row.calendarDays),
        'Weekend days skipped': String(row.weekendDays),
        'Holidays skipped': String(row.holidaysSkipped),
        'Holidays on weekend days': String(row.holidaysOnWeekend),
        'End day': row.includeEnd ? 'Counted' : 'Not counted',
      },
      `${row.start} to ${row.end} [${row.weekend}] ${row.includeEnd ? 'counted' : 'left out'}`,
    );
  }

  // Refusals: years 0000 and 10000, a time, a bad weekend and bad holiday lines say what is wrong and never repeat the paste.
  const marker = 'FODT-MARKER-3141';
  await fillAndHold(page, 'holidays', '');
  await fillAndHold(page, 'weekend', 'Sat, Sun');
  await fillAndHold(page, 'end', '2024-01-08');
  await fillAndHold(page, 'start', '0000-01-01');
  await expect.poll(readIssues.bind(null, page)).toContain('Start: The year must be from 0001 to 9999.');
  await fillAndHold(page, 'start', '10000-01-01');
  await expect.poll(readIssues.bind(null, page)).toContain('Start: A date must be written YYYY-MM-DD');
  await fillAndHold(page, 'start', '2024-01-01T12:00:00Z');
  await expect.poll(readIssues.bind(null, page)).toContain('Start: A date must be written YYYY-MM-DD');
  await fillAndHold(page, 'start', `2024-01-${marker}`);
  await expect.poll(readIssues.bind(null, page)).toContain('Start: A date must be written YYYY-MM-DD');
  expect(await outputArea(page).innerText()).not.toContain(marker);
  await fillAndHold(page, 'start', '2024-01-01');
  await fillAndHold(page, 'end', '2023-02-29');
  await expect.poll(readIssues.bind(null, page)).toContain('End: That day does not exist in that month.');
  await fillAndHold(page, 'end', '2024-01-08');
  await fillAndHold(page, 'weekend', `Funday ${marker}`);
  await expect.poll(readIssues.bind(null, page)).toContain('Weekend days must be names');
  expect(await outputArea(page).innerText()).not.toContain(marker);
  await fillAndHold(page, 'weekend', '1 2 3 4 5 6 7');
  await expect.poll(readIssues.bind(null, page)).toContain('At most six days can be weekend days');
  await fillAndHold(page, 'weekend', 'Sat, Sun');
  await fillAndHold(page, 'holidays', `2024-01-03\nnot a date ${marker}\n\n2024-02-30`);
  await expect.poll(readIssues.bind(null, page)).toContain('Line 2: Holidays:');
  const issues = await readIssues(page);
  expect(issues).toContain('Line 4: Holidays: That day does not exist in that month.');
  expect(await outputArea(page).innerText()).not.toContain(marker);
  await expect(outputArea(page).locator('dl.kv')).toHaveCount(0);
  await fillAndHold(page, 'holidays', '');

  // ISO week numbers (Python: 2021-01-03 is 2020, week 53, weekday 7; 2024-12-30 is 2025, week 1, weekday 1). The Start,
  // End and Holidays typed above are still in their fields, hidden, and change nothing.
  await chooseMode(page, 'weeks');
  for (const name of ['start', 'end', 'weekend', 'holidays']) await expect(page.locator(`#f-${name}`)).toHaveCount(0);
  await expect(page.locator('#f-dates')).toBeVisible();
  const weekDates = '2021-01-03\n2020-12-28\n2024-01-04\n\n2024-12-30\n0001-01-01\n9999-12-31\nnope';
  await fillAndHold(page, 'dates', weekDates);
  const wanted = [
    ['1', '2021-01-03', '2020-W53-7', '2020', '53', '7 Sunday', '2020-12-28', '53'],
    ['2', '2020-12-28', '2020-W53-1', '2020', '53', '1 Monday', '2020-12-28', '53'],
    ['3', '2024-01-04', '2024-W01-4', '2024', '1', '4 Thursday', '2024-01-01', '52'],
    ['5', '2024-12-30', '2025-W01-1', '2025', '1', '1 Monday', '2024-12-30', '52'],
    ['6', '0001-01-01', '0001-W01-1', '1', '1', '1 Monday', '0001-01-01', '52'],
    ['7', '9999-12-31', '9999-W52-5', '9999', '52', '5 Friday', '9999-12-27', '52'],
  ];
  await expect(async () => {
    expect(await readTable(page)).toEqual(wanted);
  }).toPass({ timeout: 10_000 });
  expect(await readIssues(page)).toContain('Line 8: Dates: A date must be written YYYY-MM-DD');
  await expect(outputArea(page).locator('thead th')).toHaveText([
    'Line',
    'Date',
    'ISO week date',
    'Week-numbering year',
    'Week',
    'Weekday',
    'Week starts',
    'Weeks in that year',
  ]);

  // ISO 8601 durations: read into parts, written back canonically, the exact time part only, and the refusals.
  await chooseMode(page, 'duration');
  await expect(page.locator('#f-isoDuration')).toBeVisible();
  await expect(page.locator('#f-dates')).toHaveCount(0);
  await fillAndHold(page, 'isoDuration', 'P1Y2M3W4DT5H6M7.5S');
  await expect(async () => {
    expect(await readTable(page)).toEqual([
      ['Years', '1'],
      ['Months', '2'],
      ['Weeks', '3'],
      ['Days', '4'],
      ['Hours', '5'],
      ['Minutes', '6'],
      ['Seconds', '7.5'],
      ['Hours, minutes and seconds in seconds', '18367.5'],
    ]);
  }).toPass({ timeout: 10_000 });
  expect(((await outputArea(page).locator('pre.output').first().textContent()) ?? '').trim()).toBe(
    'P1Y2M3W4DT5H6M7.5S',
  );
  await expect(outputArea(page)).toContainText('no total in seconds is given for them');
  await fillAndHold(page, 'isoDuration', 'P0,5D');
  await expect
    .poll(async () => ((await outputArea(page).locator('pre.output').first().textContent()) ?? '').trim())
    .toBe('P0.5D');
  await fillAndHold(page, 'isoDuration', 'P007Y');
  await expect
    .poll(async () => ((await outputArea(page).locator('pre.output').first().textContent()) ?? '').trim())
    .toBe('P7Y');
  for (const [text, sentence] of [
    ['P1.5Y2M', 'Only the smallest part present can have a decimal fraction.'],
    ['P', 'A duration needs at least one part after the P'],
    ['PT', 'A T must be followed by at least one of hours'],
    ['-P1D', 'A sign is not accepted'],
    ['1D', 'An ISO 8601 duration starts with P'],
    [`P${marker}`, 'Each part is a number and its capital letter'],
  ] as const) {
    await fillAndHold(page, 'isoDuration', text);
    await expect.poll(readIssues.bind(null, page), text).toContain(sentence);
    expect(await outputArea(page).innerText()).not.toContain(marker);
  }

  // Build an ISO 8601 duration from number fields: zero parts are left out and nothing at all is PT0S.
  await chooseMode(page, 'build');
  for (const name of ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds']) {
    await expect(page.locator(`#f-${name}`)).toBeVisible();
  }
  await expect(page.locator('#f-isoDuration')).toHaveCount(0);
  await expect
    .poll(async () => ((await outputArea(page).locator('pre.output').first().textContent()) ?? '').trim())
    .toBe('PT0S');
  await fillAndHold(page, 'days', '10');
  await fillAndHold(page, 'minutes', '30');
  await expect
    .poll(async () => ((await outputArea(page).locator('pre.output').first().textContent()) ?? '').trim())
    .toBe('P10DT30M');
  await fillAndHold(page, 'seconds', '7,5');
  await expect
    .poll(async () => ((await outputArea(page).locator('pre.output').first().textContent()) ?? '').trim())
    .toBe('P10DT30M7.5S');
  await fillAndHold(page, 'years', '1');
  await fillAndHold(page, 'weeks', '2');
  await expect
    .poll(async () => ((await outputArea(page).locator('pre.output').first().textContent()) ?? '').trim())
    .toBe('P1Y2W10DT30M7.5S');
  // A number outside 0 to 999,999 names its field; text in the seconds box that is not a number is refused.
  await fillAndHold(page, 'years', '-98765123456');
  await expect.poll(readIssues.bind(null, page)).toContain('Years must be a whole number from 0 to 999,999.');
  await fillAndHold(page, 'years', '1000000');
  await expect.poll(readIssues.bind(null, page)).toContain('Years must be a whole number from 0 to 999,999.');
  await fillAndHold(page, 'years', '999999');
  await expect
    .poll(async () => ((await outputArea(page).locator('pre.output').first().textContent()) ?? '').trim())
    .toBe('P999999Y2W10DT30M7.5S');
  await fillAndHold(page, 'seconds', `7${marker}`);
  await expect.poll(readIssues.bind(null, page)).toContain('Seconds: The seconds value must be a number');
  expect(await outputArea(page).innerText()).not.toContain(marker);

  // Back on the first mode, the page still answers as it did at first paint.
  await chooseMode(page, 'difference');
  await fillAndHold(page, 'start', '2024-01-31');
  await fillAndHold(page, 'end', '2024-03-01');
  await expect.poll(async () => (await readPairs(page))['As an ISO 8601 duration']).toBe('P1M1D');
  pairs = await readPairs(page);
  expect(pairs['Total seconds']).toBe('2592000');
});

test('date-diff: business days and ISO weeks give the same answers in time zones 14 hours apart', async ({
  browser,
}, testInfo) => {
  // The new modes use whole day numbers, never the machine's clock or time zone. The same questions are asked in a zone
  // 14 hours ahead of UTC, one 11 hours behind it and one with daylight saving time, across the days the clocks change
  // (Python: 2024-03-08 to 2024-03-12 is 2 business days with the end left out and 3 with it counted; 2024-11-01 to
  // 2024-11-06 is 3; 2024-03-10 is 2024 week 10, weekday 7; 2024-11-03 is week 44, weekday 7).
  for (const timezoneId of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Los_Angeles']) {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, timezoneId });
    try {
      const page = await context.newPage();
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(timezoneId);
      await openTool(page, 'date-diff');
      await chooseMode(page, 'business');
      const base = { weekend: 'Sat, Sun', holidays: '' };
      await businessAnswer(
        page,
        { ...base, start: '2024-03-08', end: '2024-03-12', includeEnd: false },
        { 'Business days': '2', 'Calendar days': '4' },
        `${timezoneId} spring`,
      );
      await businessAnswer(
        page,
        { ...base, start: '2024-03-08', end: '2024-03-12', includeEnd: true },
        { 'Business days': '3', 'Calendar days': '5' },
        `${timezoneId} spring, end counted`,
      );
      await businessAnswer(
        page,
        { ...base, start: '2024-11-01', end: '2024-11-06', includeEnd: false },
        { 'Business days': '3', 'Calendar days': '5' },
        `${timezoneId} autumn`,
      );
      await chooseMode(page, 'weeks');
      await fillAndHold(page, 'dates', '2024-03-10\n2024-11-03\n2021-01-03');
      await expect(async () => {
        expect((await readTable(page)).map((cells) => cells.slice(1, 6))).toEqual([
          ['2024-03-10', '2024-W10-7', '2024', '10', '7 Sunday'],
          ['2024-11-03', '2024-W44-7', '2024', '44', '7 Sunday'],
          ['2021-01-03', '2020-W53-7', '2020', '53', '7 Sunday'],
        ]);
      }).toPass({ timeout: 10_000 });
    } finally {
      await context.close();
    }
  }
});
