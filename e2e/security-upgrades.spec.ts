import { test, expect, type Page } from '@playwright/test';

/**
 * Browser proof of the new modes the three upgraded tools gained in phase 14 (D-180): hash-text, luhn and
 * security-headers. Each upgraded tool keeps its live fixture and its existing tests, which prove
 * the old default still works; what a tool can newly do is proven here instead, one block of top-level tests per tool,
 * every title starting with `<id>: `. The live fixtures of these tools stay as they are.
 *
 * Every expected text is written by hand from the specification or the published value the page states, never copied from
 * a run of the tool. The helpers are this file's own: a shared test helper would make every spec that imports it run whole
 * for every tool (phase 13 research, Pitfall 5); their shape is copied from e2e/data-upgrades.spec.ts.
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
 * Sets the radio and select controls of a case before any text is filled, because choosing a mode can show or hide the
 * fields that follow. A radio is clicked by its field name and value; a select is chosen by its id.
 */
async function setControls(
  page: Page,
  controls: { radios?: Record<string, string>; selects?: Record<string, string> },
): Promise<void> {
  for (const [field, value] of Object.entries(controls.radios ?? {})) {
    await page.locator(`input[name="${field}"][value="${value}"]`).click();
  }
  for (const [field, value] of Object.entries(controls.selects ?? {})) {
    await page.locator(`#f-${field}`).selectOption(value);
  }
}

/**
 * Fills one text field and checks the value stayed. The pages are prerendered, so a field filled in the first moments after
 * load can be cleared again when the page finishes starting; the fill is repeated until it holds.
 */
async function fillAndHold(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** The table row of the output whose first cell is exactly this text. */
function rowNamed(page: Page, name: string) {
  return outputArea(page)
    .locator('table.output-table tbody tr')
    .filter({ has: page.getByRole('cell', { name, exact: true }) });
}

test('hash-text: the default family still shows the SHA-256 of abc', async ({ page }) => {
  await openTool(page, 'hash-text');
  await expect(page.locator('#f-family')).toHaveValue('digests');
  await fillAndHold(page, 'input', 'abc');
  // The SHA-256 of abc is the first sample of FIPS 180-4 (SHA-256 example, one block message).
  await expect(outputArea(page).locator('table.output-table')).toContainText(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  await expect(outputArea(page).locator('table.output-table th').first()).toHaveText('Algorithm');
});

test('hash-text: Checksums show the catalogue check values CRC-32C e3069283 and CRC-16 ARC bb3d for 123456789', async ({
  page,
}) => {
  await openTool(page, 'hash-text');
  await setControls(page, { selects: { family: 'checksums' } });
  await fillAndHold(page, 'input', '123456789');
  // The CRC catalogue's check value is the CRC of the nine ASCII bytes 123456789.
  const castagnoli = rowNamed(page, 'CRC-32/ISCSI');
  await expect(castagnoli).toHaveCount(1);
  await expect(castagnoli).toContainText('e3069283');
  await expect(castagnoli).toContainText('CRC-32C');
  const arc = rowNamed(page, 'CRC-16/ARC');
  await expect(arc).toHaveCount(1);
  await expect(arc).toContainText('bb3d');
  // The catalogue's current name and the older name people search for are on the same row.
  await expect(rowNamed(page, 'CRC-16/IBM-3740')).toContainText('CRC-16/CCITT-FALSE');
  await expect(outputArea(page)).toContainText('Checksums detect accidental changes. They are not hashes');
  await expect(outputArea(page).locator('table.output-table tbody tr')).toHaveCount(43);
});
