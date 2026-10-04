import { test, expect, type Page } from '@playwright/test';

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
