import { test, expect, type Page } from '@playwright/test';

/**
 * The additive grid field's own browser-level proof: editing, adding,
 * removing and pasting into the grid produce the table the visitor expects,
 * on every browser project this site tests against.
 */
const rel = (path: string) => path.replace(/^\//, '');

async function goto(page: Page): Promise<void> {
  await page.goto(rel('/tools/table-builder'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

async function waitSettled(page: Page): Promise<void> {
  await page.waitForTimeout(200);
  await expect(page.locator('section[aria-label="Output"]')).toHaveAttribute('aria-busy', 'false', {
    timeout: 15_000,
  });
}

/**
 * Dispatches a real, bubbling, cancelable `paste` event on the given cell
 * with `clipboardData.getData` returning `text` regardless of the type
 * asked for. Defined with `Object.defineProperty` on a plain `Event`
 * rather than relying on the OS clipboard or a browser-specific
 * `ClipboardEvent` constructor, so the same call works on every engine
 * this site tests against.
 */
async function pasteInto(page: Page, cellId: string, text: string): Promise<void> {
  await page.evaluate(
    ({ id, pasted }) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`no element with id ${id}`);
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => pasted } });
      el.dispatchEvent(event);
    },
    { id: cellId, pasted: text },
  );
}

test('table-builder typed cells, an added row and column and a pasted block become a GFM table', async ({ page }) => {
  await goto(page);

  await page.locator('#f-table-r0-c0').fill('Name');
  await page.locator('#f-table-r0-c1').fill('Age');
  await page.locator('#f-table-r1-c0').fill('Ada');
  await page.locator('#f-table-r1-c1').fill('36');

  await page.getByRole('button', { name: 'Add row', exact: true }).click();
  await page.getByRole('button', { name: 'Add column', exact: true }).click();

  // Proves the added column is a real, editable column that survives to
  // the final table, not merely present in the DOM.
  await page.locator('#f-table-r1-c2').fill('NYC');

  // The added row (index 3) is the pasted-into cell. The pasted block is
  // two rows of two cells each ("a", "b" / "c", "d") -- one tab between
  // cells, one line break between rows -- so it fills the added row and
  // grows the grid by exactly one more row.
  await pasteInto(page, 'f-table-r3-c0', 'a\tb\nc\td');

  await waitSettled(page);

  const output = await page.locator('section[aria-label="Output"] pre.output').first().innerText();
  const lines = output.split('\n');

  expect(lines[0]).toMatch(/^\|\s*Name\s*\|\s*Age\s*\|\s*\|$/); // header row: added column's header cell is blank
  expect(lines[1]).toMatch(/^\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|$/); // delimiter row
  expect(output).toMatch(/\|\s*Ada\s*\|\s*36\s*\|\s*NYC\s*\|/);
  expect(output).toMatch(/\|\s*a\s*\|\s*b\s*\|/);
  expect(output).toMatch(/\|\s*c\s*\|\s*d\s*\|/);
});

test('table-builder Reset restores the starting grid', async ({ page }) => {
  await goto(page);

  await page.locator('#f-table-r0-c0').fill('Changed');
  await page.getByRole('button', { name: 'Add row', exact: true }).click();
  await page.getByRole('button', { name: 'Add column', exact: true }).click();
  await expect(page.locator('#f-table-r3-c0')).toHaveCount(1); // the added row exists before Reset

  await page.getByRole('button', { name: 'Reset', exact: true }).click();

  await expect(page.locator('#f-table-r0-c0')).toHaveValue('Column 1');
  await expect(page.locator('#f-table-r0-c1')).toHaveValue('Column 2');
  await expect(page.locator('#f-table-r1-c0')).toHaveValue('');
  await expect(page.locator('#f-table-r2-c1')).toHaveValue('');
  await expect(page.locator('#f-table-r3-c0')).toHaveCount(0); // the added row is gone
  await expect(page.locator('#f-table-r0-c2')).toHaveCount(0); // the added column is gone
});

test('table-builder remove buttons stop at one row and one column', async ({ page }) => {
  await goto(page);

  const removeRow = page.getByRole('button', { name: 'Remove last row', exact: true });
  const removeColumn = page.getByRole('button', { name: 'Remove last column', exact: true });

  // The default grid starts at 3 rows by 2 columns.
  await removeRow.click();
  await removeRow.click();
  await expect(page.locator('#f-table-r0-c0')).toHaveCount(1);
  await expect(page.locator('#f-table-r1-c0')).toHaveCount(0); // down to one row
  await expect(removeRow).toBeDisabled();

  await removeColumn.click();
  await expect(page.locator('#f-table-r0-c1')).toHaveCount(0); // down to one column
  await expect(removeColumn).toBeDisabled();

  // One more click on either disabled button changes nothing: still 1x1.
  await removeRow.click({ force: true });
  await removeColumn.click({ force: true });
  await expect(page.locator('#f-table-r0-c0')).toHaveCount(1);
  await expect(page.locator('#f-table-r1-c0')).toHaveCount(0);
  await expect(page.locator('#f-table-r0-c1')).toHaveCount(0);
});
