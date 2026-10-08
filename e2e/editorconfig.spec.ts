import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The EditorConfig Resolver shows which properties apply to a file path and which file, section and line decided each
 * (20-05, FLOW-03, D-237, D-238).
 *
 * The expected rows follow the EditorConfig specification, version 0.17.2 (https://spec.editorconfig.org/): files are read from
 * the farthest to the nearest and the most recent pair wins, a name with a slash outside brackets is relative to the folder of
 * its file while a name without one matches at any level below it, the search stops at a file whose preamble holds root = true,
 * and indent_size is copied into tab_width when tab_width is absent (core test tab_width_default of the EditorConfig project's
 * conformance suite, vendored in tools/editorconfig/test/fixtures/core-test/). They are never copied from the page.
 *
 * Test 1 pastes a top file and the file of the folder src and reads every property of src/lib/a.js with the file, section and
 * line that decided it, and the settings that were replaced. Test 2 puts root = true in the file of src and checks that the top
 * file is listed as not used, with its reason, and does not decide anything. Test 3 pastes a section of 300 stars with letters
 * between them (the shape that makes a pattern built as a regular expression run for minutes), gives it a path of 1,000
 * letters, and checks that the page answers at once and still answers the next path that is typed.
 *
 * A spec of its own with helpers copied in shape from e2e/dev-upgrades.spec.ts, because a shared test helper would make every
 * importing spec run whole for every tool. It is read in four browser projects: chromium, firefox, webkit and mobile-chrome.
 * The page is driven only through its labelled controls.
 */
const rel = (path: string) => path.replace(/^\//, '');

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

async function openResolver(page: Page): Promise<void> {
  await page.goto(rel('/tools/editorconfig'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

/**
 * Fills a field and checks the value stayed. The pages are prerendered, so a field filled in the first moments after load can
 * be cleared again when the page finishes starting; the fill is repeated until it holds.
 */
async function fillAndHold(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** The output block that carries a label. */
function blockLabelled(page: Page, label: string): Locator {
  return outputArea(page)
    .locator('.output-block')
    .filter({ has: page.locator('.output-label', { hasText: label }) });
}

/** The text of every row of the table with a label, white space collapsed, keyed by the first cell (the property). */
async function tableRows(page: Page, label: string): Promise<Record<string, string>> {
  const rows = await blockLabelled(page, label).locator('table tbody tr').allInnerTexts();
  const byKey: Record<string, string> = {};
  for (const row of rows) {
    const text = row.replace(/\s+/g, ' ').trim();
    byKey[text.split(' ')[0] ?? ''] = text;
  }
  return byKey;
}

/** The text of every item of the list with a label, white space collapsed. */
async function listItems(page: Page, label: string): Promise<string[]> {
  return (await blockLabelled(page, label).locator('li').allInnerTexts()).map((item) =>
    item.replace(/\s+/g, ' ').trim(),
  );
}

test('editorconfig: nested files resolve with the deciding file, section and line', async ({ page }) => {
  test.setTimeout(120_000);
  await openResolver(page);
  // Lines of the top file: 1 root, 3 the section [*], 4 indent_style, 5 indent_size, 6 end_of_line.
  // Lines of the file for src: 1 the section [*.js], 2 indent_size, 4 the section [lib/**.js], 5 indent_style.
  const files = [
    'root = true',
    '',
    '[*]',
    'indent_style = space',
    'indent_size = 4',
    'end_of_line = lf',
    '',
    '=== src ===',
    '[*.js]',
    'indent_size = 2',
    '',
    '[lib/**.js]',
    'indent_style = tab',
  ].join('\n');
  await fillAndHold(page, 'files', files);
  await fillAndHold(page, 'path', 'src/lib/a.js');
  await expect
    .poll(async () => Object.keys(await tableRows(page, 'Properties that apply')).length, { timeout: 15_000 })
    .toBe(4);

  // The closer file and the later section win, and each property names its file, section and line.
  const rows = await tableRows(page, 'Properties that apply');
  expect(rows['indent_style']).toBe('indent_style tab src/.editorconfig [lib/**.js] line 5 set');
  expect(rows['indent_size']).toBe('indent_size 2 src/.editorconfig [*.js] line 2 set');
  expect(rows['end_of_line']).toBe('end_of_line lf .editorconfig [*] line 6 set');
  // tab_width follows indent_size when it is absent, and says where it came from.
  expect(rows['tab_width']).toBe(
    'tab_width 2 derived from indent_size, set at src/.editorconfig [*.js] line 2 derived',
  );

  // The settings that were replaced are listed with where they were set and where they were replaced.
  const replaced = await tableRows(page, 'Earlier settings that were overridden');
  expect(Object.keys(replaced).sort()).toEqual(['indent_size', 'indent_style']);
  expect(replaced['indent_style']).toBe(
    'indent_style space .editorconfig [*] line 4 src/.editorconfig [lib/**.js] line 5',
  );
  expect(replaced['indent_size']).toBe('indent_size 4 .editorconfig [*] line 5 src/.editorconfig [*.js] line 2');

  // Both files were used; three sections matched and none did not.
  expect(await listItems(page, 'Files used')).toEqual([
    '.editorconfig (sets root to true, so the search stops here)',
    'src/.editorconfig',
  ]);
  expect(await listItems(page, 'Sections that matched')).toEqual([
    '.editorconfig [*] line 3',
    'src/.editorconfig [*.js] line 1',
    'src/.editorconfig [lib/**.js] line 4',
  ]);
  await expect(blockLabelled(page, 'Sections that did not match')).toHaveCount(0);
  await expect(outputArea(page)).toContainText('Only the files you paste are read');

  // A path outside src is decided by the top file alone; the file for src is listed as not above the path.
  await fillAndHold(page, 'path', 'docs/a.js');
  await expect
    .poll(async () => (await tableRows(page, 'Properties that apply'))['indent_size'] ?? '', { timeout: 15_000 })
    .toContain('indent_size 4');
  expect(await listItems(page, 'Files not used')).toEqual(['src/.editorconfig: it is not in a folder above the path']);
});

test('editorconfig: a root file stops the search and the files above it are listed as not used', async ({ page }) => {
  test.setTimeout(120_000);
  await openResolver(page);
  const files = [
    '[*]',
    'indent_size = 4',
    'charset = utf-8',
    '=== src ===',
    'root = true',
    '[*.js]',
    'indent_size = 2',
  ].join('\n');
  await fillAndHold(page, 'files', files);
  await fillAndHold(page, 'path', 'src/a.js');
  await expect
    .poll(async () => Object.keys(await tableRows(page, 'Properties that apply')).length, { timeout: 15_000 })
    .toBe(2);

  // Specification: the search stops at a file whose preamble holds root = true, so the top file decides nothing.
  const rows = await tableRows(page, 'Properties that apply');
  expect(Object.keys(rows).sort()).toEqual(['indent_size', 'tab_width']);
  expect(rows['indent_size']).toBe('indent_size 2 src/.editorconfig [*.js] line 3 set');
  expect(await listItems(page, 'Files used')).toEqual([
    'src/.editorconfig (sets root to true, so the search stops here)',
  ]);
  expect(await listItems(page, 'Files not used')).toEqual(['.editorconfig: it is above a file that sets root to true']);
  expect(await listItems(page, 'Sections that did not match')).toEqual([
    '.editorconfig [*] line 1: its file is not used',
  ]);

  // The same top file without the root line in src is used too, and charset comes back.
  await fillAndHold(page, 'files', files.replace('root = true\n', ''));
  await expect
    .poll(async () => (await tableRows(page, 'Properties that apply'))['charset'] ?? '', { timeout: 15_000 })
    .toBe('charset utf-8 .editorconfig [*] line 3 set');
  await expect(blockLabelled(page, 'Files not used')).toHaveCount(0);
});

test('editorconfig: a hostile glob is answered or refused at once and the page stays usable', async ({ page }) => {
  test.setTimeout(120_000);
  await openResolver(page);
  // 300 stars with a letter between each and a letter after them, against 1,000 letters that never end in that letter. As a
  // regular expression this takes minutes; the page matches it as a list of positions in one pass over the path.
  const hostile = `[${'*a'.repeat(300)}b]\nk = v`;
  await fillAndHold(page, 'files', hostile);
  await fillAndHold(page, 'path', 'a'.repeat(1000));
  // Either an answer or a refusal appears within a few seconds (here: no section matches, so no property applies).
  await expect(outputArea(page)).toContainText('No property applies', { timeout: 10_000 });
  await expect(blockLabelled(page, 'Sections that did not match')).toContainText('line 1');

  // The page is still usable: a path that does match the section is answered next.
  await fillAndHold(page, 'path', `${'a'.repeat(300)}b`);
  await expect
    .poll(async () => (await tableRows(page, 'Properties that apply'))['k'] ?? '', { timeout: 10_000 })
    .toContain('k v .editorconfig');
  await expect(blockLabelled(page, 'Sections that matched')).toContainText('line 1');
});
