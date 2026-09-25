import { test, expect } from '@playwright/test';

/**
 * Behavioural proof of the page-side time limit and large-file handling
 * (D-57, ROADMAP success criterion 2): a large file is read in the
 * background worker, the tab stays responsive while it runs, and the
 * table is capped at 500 rows with a plain count of the rest. Lives in
 * its own spec file per this phase's `<shared_procedure>`, the same
 * reason `e2e/regex-tester.spec.ts` and `e2e/hash-file.spec.ts` each own
 * their own worker-behaviour file.
 */
const rel = (path: string) => path.replace(/^\//, '');

/** A deterministic (not random) 100000-row CSV, so a failure is reproducible without capturing the file that triggered it. */
function largeCsvBuffer(rows: number): Buffer {
  const lines = ['id,name,value'];
  for (let i = 1; i <= rows; i++) lines.push(`${i},name-${i},${i * 7}`);
  return Buffer.from(lines.join('\n'), 'utf8');
}

test('a 100000 row file is read in the background and shows 500 rows with the full count', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(rel('/tools/csv-viewer'));
  await page.locator('#f-file').setInputFiles({
    name: 'large.csv',
    mimeType: 'text/csv',
    buffer: largeCsvBuffer(100_000),
  });

  // Sampled while the worker should still be processing the file, well
  // before this tool's own 10 second time limit -- this evaluate() round
  // trip runs on the PAGE's own event loop, proving the tab stays
  // responsive while the parse runs on the worker's own thread.
  await page.waitForTimeout(200);
  const evalStart = Date.now();
  await page.evaluate(() => performance.now());
  expect(Date.now() - evalStart).toBeLessThan(500);

  await expect(page.locator('section[aria-label="Output"]')).toContainText('Showing 500 of 100000 matching rows', {
    timeout: 30_000,
  });
});

test('a semicolon file sorted by a numeric column descending puts the largest value first', async ({ page }) => {
  await page.goto(rel('/tools/csv-viewer'));
  await page.locator('#f-input').fill('name;age\nAda;36\nAlan;41\nCy;9');
  await page.locator('#f-sortColumn').fill('age');
  await page.locator('#f-sortDirection').selectOption('desc');
  const firstRow = page.locator('section[aria-label="Output"] table.output-table tbody tr').first();
  await expect(firstRow).toContainText('Alan', { timeout: 10_000 });
});
