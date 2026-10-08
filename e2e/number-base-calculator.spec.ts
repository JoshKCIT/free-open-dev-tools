import { expect, test, type Page } from '@playwright/test';

/**
 * The Number Base Converter keeps its earlier answers and gains the programmer's calculator (20-01, FLOW-04, D-237).
 *
 * Test 1 repeats three answers the earlier unit tests of the package state (tools/number-base/test/index.test.ts): dead_beef
 * in base 16 is 3735928559, the 64 digit hexadecimal hash of all ones is its exact 78 digit decimal, and 80000001 rotated
 * left by 1 at 32 bits is 00000003. Tests 2 and 3 check the calculator against the C answers recorded from clang 21.1.0 in
 * tools/number-base/test/fixtures/oracle/ (1 + 2 << 3 at 8 bits unsigned is 24, because + binds tighter than <<; INT_MAX
 * plus one wraps to -2147483648 with -fwrapv) and against the refusal that names its position.
 *
 * A spec of its own, with helpers copied in shape from e2e/dev-upgrades.spec.ts, because a shared test helper would make
 * every importing spec run whole for every tool. It is read in four browser projects: chromium, firefox, webkit and
 * mobile-chrome (the Pixel 7 emulation). The page is driven only through its labelled controls.
 */
const rel = (path: string) => path.replace(/^\//, '');

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

async function openConverter(page: Page): Promise<void> {
  await page.goto(rel('/tools/number-base'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
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

/** Chooses a mode by its label and checks that it stuck. */
async function chooseMode(page: Page, label: string): Promise<void> {
  const radio = page.getByRole('radio', { name: label, exact: true });
  await expect(async () => {
    await radio.check();
    await expect(radio).toBeChecked({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Chooses an option of a select and checks that it stuck. */
async function choose(page: Page, name: string, value: string): Promise<void> {
  const select = page.locator(`#f-${name}`);
  await expect(async () => {
    await select.selectOption(value);
    await expect(select).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** The pairs of the first key and value block of the output, by their labels. */
async function readPairs(page: Page): Promise<Record<string, string>> {
  return outputArea(page).evaluate((section) => {
    const pairs: Record<string, string> = {};
    for (const term of Array.from(section.querySelectorAll('dl.kv dt'))) {
      pairs[term.textContent ?? ''] = term.nextElementSibling?.textContent ?? '';
    }
    return pairs;
  });
}

/** Waits for the first key and value block to hold a value under a label. */
async function pairIs(page: Page, label: string, expected: string): Promise<void> {
  await expect.poll(async () => (await readPairs(page))[label], { timeout: 15_000 }).toBe(expected);
}

test('number-base: convert and calculate give the same answers as before the calculator', async ({ page }) => {
  test.setTimeout(120_000);
  await openConverter(page);

  // Convert, the default mode: dead_beef in base 16.
  await choose(page, 'fromBase', '16');
  await fillAndHold(page, 'input', 'dead_beef');
  await expect(outputArea(page)).toContainText('3735928559', { timeout: 15_000 });

  // The 64 digit hexadecimal hash of all ones converts to its exact decimal, not 1.157920892373162e+77.
  await fillAndHold(page, 'input', 'f'.repeat(64));
  await expect(outputArea(page)).toContainText(
    '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    { timeout: 15_000 },
  );
  await expect(outputArea(page)).not.toContainText('e+77');

  // Calculate: 80000001 rotated left by 1 at 32 bits is 00000003.
  await chooseMode(page, 'Calculate');
  await choose(page, 'operation', 'rotateLeft');
  await choose(page, 'width', '32');
  await fillAndHold(page, 'input', '80000001');
  await fillAndHold(page, 'second', '1');
  await pairIs(page, 'Hexadecimal', '0x00000003');
  expect((await readPairs(page))['Binary']).toBe('00000000 00000000 00000000 00000011');
  await expect(outputArea(page)).toContainText('Result at 32 bits');

  // The calculator's own fields are not part of these two modes.
  await expect(page.locator('#f-expression')).toHaveCount(0);
  await expect(page.locator('#f-exprWidth')).toHaveCount(0);
});

test('number-base: the programmer calculator shows one plus two shifted left by three as 24 at 8 bits in every base', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openConverter(page);
  await chooseMode(page, "Programmer's calculator");
  await choose(page, 'exprWidth', '8');
  await choose(page, 'exprSign', 'unsigned');
  await fillAndHold(page, 'expression', '1 + 2 << 3');

  // C orders the operators so that the addition is done first: (1 + 2) << 3 is 24, not 17.
  await pairIs(page, 'Unsigned (decimal)', '24');
  const pairs = await readPairs(page);
  expect(pairs['Hexadecimal']).toBe('0x18');
  expect(pairs['Signed (decimal)']).toBe('24');
  expect(pairs['Octal']).toBe('0o30');
  expect(pairs['Binary']).toBe('00011000');
  await expect(outputArea(page)).toContainText('Result at 8 bits');

  // Both steps are listed, in the order they were done.
  const rows = outputArea(page).locator('table tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('+');
  await expect(rows.nth(1)).toContainText('<<');
  await expect(rows.nth(1)).toContainText('24');

  // Nothing wrapped, so there is no warning; the converter's own fields are hidden in this mode.
  await expect(outputArea(page).locator('.note-warn')).toHaveCount(0);
  await expect(page.locator('#f-input')).toHaveCount(0);
  await expect(page.locator('#f-fromBase')).toHaveCount(0);

  // The width changes the hexadecimal digits: the same expression at 16 bits is 0x0018.
  await choose(page, 'exprWidth', '16');
  await pairIs(page, 'Hexadecimal', '0x0018');
});

test('number-base: a signed 32-bit wrap is flagged and a zero divisor is refused naming its position', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openConverter(page);
  await chooseMode(page, "Programmer's calculator");
  await choose(page, 'exprWidth', '32');
  await choose(page, 'exprSign', 'signed');

  // INT_MAX plus one wraps to the smallest 32 bit value; clang 21.1.0 with -fwrapv gives the same, and the page says so.
  await fillAndHold(page, 'expression', '0x7FFFFFFF + 1');
  await pairIs(page, 'Signed (decimal)', '-2147483648');
  expect((await readPairs(page))['Hexadecimal']).toBe('0x80000000');
  const warning = outputArea(page).locator('.note-warn').first();
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('wrapped');
  await expect(warning).toContainText('position 12');

  // A zero divisor is refused, naming the position of the operator, and no result is shown beside the refusal.
  await fillAndHold(page, 'expression', '1 / 0');
  const problems = page.locator('ul.issue-list[aria-label="Input problems"]');
  await expect(problems).toBeVisible({ timeout: 15_000 });
  await expect(problems).toContainText('Division by zero (position 3)');
  await expect.poll(async () => Object.keys(await readPairs(page)), { timeout: 15_000 }).toEqual([]);
});
