import { test, expect, type Page } from '@playwright/test';

/**
 * Behavioural proof of the page-side time limit added by the orchestrator
 * amendment (2026-09-25, D-14/D-15/D-27, D-57): the installed yaml 2.9.1
 * checks duplicate mapping keys by scanning the whole mapping for every new
 * key it composes, so a flat mapping's parse time grows quadratically with
 * its key count. Measured directly against the installed package (see
 * apps/web/src/lib/run-yaml-formatter-in-worker.ts's own comment): about
 * 1.1s at 15,000 keys and 1.75s at 20,000. A pathological input is stopped
 * with a plain message instead of freezing the tab, and the page keeps
 * working normally afterwards.
 */
const rel = (path: string) => path.replace(/^\//, '');

/**
 * Sets a textarea's value directly through its native setter and dispatches
 * one `input` event, instead of Playwright's own `fill()`.
 *
 * Measured this session: `locator.fill()` on a ~250KB value routinely
 * exceeds a minute in this sandboxed browser environment (confirmed on an
 * unrelated page with no worker of its own, so the slowdown is Playwright's
 * own fill-then-verify implementation for a large value here, not this
 * tool's worker or its parsing). Setting the value directly and firing one
 * `input` event -- exactly what a real paste does -- completes in well
 * under a second for the same text and drives this page's own onChange
 * handler identically.
 */
async function setLargeValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/** A flat mapping with 20,000 keys: reliably exceeds the 1.5s time limit (measured ~1.75s directly against the installed package). */
function pathologicalSource(): string {
  const lines: string[] = [];
  for (let i = 0; i < 20_000; i++) lines.push(`k${i}: ${i}`);
  return lines.join('\n') + '\n';
}

/** A realistic 200KB-scale nested document: the quadratic cost is per-mapping, not per-document, so this stays far under the limit. */
function realisticSource(): string {
  const lines: string[] = [];
  for (let i = 0; i < 1200; i++) {
    lines.push(`item${i}:`);
    lines.push(`  name: Item ${i}`);
    lines.push(`  value: ${i}`);
    lines.push(`  active: true`);
  }
  return lines.join('\n') + '\n';
}

test('a large flat mapping is stopped with the time-limit message and the tab stays responsive', async ({ page }) => {
  await page.goto(rel('/tools/yaml-formatter'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await setLargeValue(page, '#f-input', pathologicalSource());

  // Sampled shortly after the debounced autoRun should have started the
  // worker, but well before this tool's own 1.5s time limit could have
  // fired -- this evaluate() round trip runs on the PAGE's own event loop,
  // so it proves the tab stays responsive while checking is stuck on the
  // worker's own thread, not that checking itself finished quickly.
  await page.waitForTimeout(300);
  const evalStart = Date.now();
  await page.evaluate(() => performance.now());
  expect(Date.now() - evalStart).toBeLessThan(500);

  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 1.5 seconds', {
    timeout: 10_000,
  });
});

test('after a large flat mapping is stopped the next input runs normally', async ({ page }) => {
  await page.goto(rel('/tools/yaml-formatter'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await setLargeValue(page, '#f-input', pathologicalSource());
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 1.5 seconds', {
    timeout: 10_000,
  });

  await page.locator('#f-input').fill('a: 1\n');
  await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('a: 1', {
    timeout: 10_000,
  });
});

test('a 200KB-scale realistic nested document parses successfully through the worker', async ({ page }) => {
  await page.goto(rel('/tools/yaml-formatter'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await setLargeValue(page, '#f-input', realisticSource());
  await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('item0', {
    timeout: 10_000,
  });
  // Realistic-sized input must not hit the pathological-input time limit.
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toHaveCount(0);
});
