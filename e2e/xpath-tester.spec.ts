import { test, expect } from '@playwright/test';

/**
 * Behavioural proof of the page-side time limit (D-14/D-15/D-27, ROADMAP
 * success criterion 2): an expression that revisits the whole document
 * repeatedly inside nested predicates is stopped with a plain message
 * instead of freezing the tab, and the page keeps working normally
 * afterwards. Lives in its own spec file per this phase's
 * `<shared_procedure>`, the same reason `e2e/jsonpath.spec.ts` owns its
 * own worker-behaviour file.
 */
const rel = (path: string) => path.replace(/^\//, '');

/**
 * `count(//*[count(//*[count(//*) >= 0]) >= 0])` re-walks every element in
 * the document from the very top for each element it visits, nested three
 * levels deep -- genuinely cubic work, not an engine-specific regex
 * backtracking quirk, so the same vector is pathological on every engine
 * (unlike `regex-tester`'s own per-engine split, 03-02).
 *
 * Measured directly this session against the installed `xpath` package (in
 * Node, before writing this spec, not assumed): a generated document of
 * flat sibling elements took 253ms at 100 elements, 2,003ms at 200
 * elements, and 19,394ms at 400 elements -- consistent with the expected
 * cubic growth (roughly (n2/n1)^3 times as long). 300 elements is chosen
 * here for a comfortable margin over the 1.5 second limit on every engine
 * without an unnecessarily large document.
 */
function slowDocument(): string {
  const parts: string[] = ['<root>'];
  for (let i = 0; i < 300; i++) parts.push(`<item id="${i}"/>`);
  parts.push('</root>');
  return parts.join('');
}

const SLOW_EXPRESSION = 'count(//*[count(//*[count(//*) >= 0]) >= 0])';

test('xpath-tester stops a runaway expression after 1.5 seconds and the tab stays responsive', async ({ page }) => {
  await page.goto(rel('/tools/xpath-tester'));
  await page.locator('#f-xml').fill(slowDocument());
  await page.locator('#f-expression').fill(SLOW_EXPRESSION);

  // Sampled shortly after the debounced autoRun should have started the
  // worker, but well before this tool's own 1.5s time limit could have
  // fired -- this evaluate() round trip runs on the PAGE's own event
  // loop, so it proves the tab stays responsive while the expression is
  // stuck on the worker's own thread, not that the expression itself
  // finished quickly.
  await page.waitForTimeout(300);
  const evalStart = Date.now();
  await page.evaluate(() => performance.now());
  expect(Date.now() - evalStart).toBeLessThan(500);

  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 1.5 seconds', {
    timeout: 10_000,
  });
});

test('xpath-tester evaluates a simple path after a stopped run', async ({ page }) => {
  await page.goto(rel('/tools/xpath-tester'));
  await page.locator('#f-xml').fill(slowDocument());
  await page.locator('#f-expression').fill(SLOW_EXPRESSION);
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 1.5 seconds', {
    timeout: 10_000,
  });

  await page.locator('#f-xml').fill('<a><b>1</b></a>');
  await page.locator('#f-expression').fill('/a/b');
  await expect(page.locator('section[aria-label="Output"] table.output-table')).toContainText('1', {
    timeout: 10_000,
  });
});
