import { test, expect, type Page } from '@playwright/test';

/**
 * Browser proof of the new modes the nine upgraded tools gained in phase 13 (D-180). Each upgraded tool keeps its
 * live fixture, which holds one scenario and proves the old default still works; what a tool can newly do is proven
 * here instead, one block of top-level tests per tool, every title starting with `<id>: `.
 *
 * Every expected text is written by hand from the format's own specification or from the rule the page states, never
 * copied from a run of the tool. The helpers are this file's own: a shared test helper would make every spec that
 * imports it run whole for every tool (phase 13 research, Pitfall 5).
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
 * Sets the radio and select controls of a case before any text is filled, because choosing a mode can show or hide
 * the fields that follow. A radio is clicked by its field name and value; a select is chosen by its id; a checkbox is
 * set to the wanted state by its id.
 */
async function setControls(
  page: Page,
  controls: {
    radios?: Record<string, string>;
    selects?: Record<string, string>;
    checks?: Record<string, boolean>;
  },
): Promise<void> {
  for (const [field, value] of Object.entries(controls.radios ?? {})) {
    await page.locator(`input[name="${field}"][value="${value}"]`).click();
  }
  for (const [field, value] of Object.entries(controls.selects ?? {})) {
    await page.locator(`#f-${field}`).selectOption(value);
  }
  for (const [field, value] of Object.entries(controls.checks ?? {})) {
    await page.locator(`#f-${field}`).setChecked(value);
  }
}

/**
 * Fills one text field and checks the value stayed. The pages are prerendered, so a field filled in the first
 * moments after load can be cleared again when the page finishes starting; the fill is repeated until it holds.
 */
async function fillField(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------------------------------------------
// data-convert (DATA-12): XML, CSV and TSV beside JSON, YAML and TOML
// ---------------------------------------------------------------------------------------------------------------

test('data-convert: XML with an attribute converts to JSON with the @_ prefix', async ({ page }) => {
  await openTool(page, 'data-convert');
  await setControls(page, { selects: { from: 'xml', to: 'json' } });
  await fillField(page, 'input', '<book id="1">Moby</book>');

  // XML 1.0: the attribute id and the text Moby belong to the one element book. The page's stated rule: an
  // attribute is a key starting with @_ and the text of an element that has attributes sits under #text.
  await expect(outputArea(page)).toContainText('"@_id": "1"');
  await expect(outputArea(page)).toContainText('"#text": "Moby"');
});

test('data-convert: JSON records convert to CSV with dotted keys and a nested array is refused with its path', async ({
  page,
}) => {
  await openTool(page, 'data-convert');
  await setControls(page, { selects: { from: 'json', to: 'csv' } });

  // A nested object becomes a dotted column name (the page's stated rule); the header is the first line.
  await fillField(page, 'input', '[{"user":{"name":"Ada"},"ok":true}]');
  await expect(outputArea(page)).toContainText('user.name,ok');
  await expect(outputArea(page)).toContainText('Ada,true');

  // An array inside a record cannot become a cell: the refusal names where it is, as a JSON Pointer into the input.
  await fillField(page, 'input', '[{"a":1},{"a":2,"tags":["x"]}]');
  const problems = outputArea(page).locator('.issue-list');
  await expect(problems).toContainText('/1/tags');
  await expect(problems).toContainText('cannot be flattened');
});

test('data-convert: a YAML source still converts to TSV through its worker', async ({ page }) => {
  await openTool(page, 'data-convert');
  await setControls(page, { selects: { from: 'yaml', to: 'tsv' } });
  await fillField(page, 'input', '- id: "7"\n  name: Ada\n- id: "8"\n  name: Grace\n');

  // TSV (IANA text/tab-separated-values): the first line names the fields, fields are separated by a tab and records
  // by a line break. The raw text is read, because a text matcher would fold the tab into a space.
  const output = outputArea(page).locator('pre.output');
  await expect(output).toContainText('Grace');
  expect(await output.textContent()).toContain('id\tname\n7\tAda\n8\tGrace');
});
