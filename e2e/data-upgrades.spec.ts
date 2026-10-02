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
