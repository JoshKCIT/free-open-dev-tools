import { test, expect, type Page } from '@playwright/test';

/**
 * Fix for `.planning/WINDOWS.md` id 14: the live data-convert page parsed a
 * YAML source on the main thread, and the installed yaml package's
 * duplicate-key check scans the whole mapping for every new key it
 * composes, so a large flat mapping's parse time grows quadratically with
 * its key count -- a large enough one could freeze the tab.
 * `apps/web/src/lib/run-data-convert-in-worker.ts` moves a YAML source's
 * parse into a worker and races it against the same 1.5 second time limit
 * `run-yaml-formatter-in-worker.ts` already proved for the identical risk
 * in yaml-formatter. JSON and TOML sources are unaffected and still run on
 * the main thread.
 */
const rel = (path: string) => path.replace(/^\//, '');

/**
 * Sets a textarea's value through the native setter and dispatches one
 * `input` event, instead of Playwright's `locator.fill()`, which
 * `e2e/yaml-formatter.spec.ts` documents as routinely taking over a minute
 * on a value this size.
 */
async function setLargeValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/**
 * A flat mapping with 40,000 keys, not 20,000: `e2e/yaml-formatter.spec.ts`
 * documents that a 20,000-key mapping (~1.75s on this project's own Windows
 * laptop) sat too close to the 1.5s limit and a faster machine parsed it
 * inside the limit, failing the test (commit 48c9a90). Parse time grows
 * with the square of the key count, so 40,000 keys stays well past the
 * limit on any plausibly faster runner.
 */
function pathologicalSource(): string {
  const lines: string[] = [];
  for (let i = 0; i < 40_000; i++) lines.push(`k${i}: ${i}`);
  return lines.join('\n') + '\n';
}

test('a huge flat YAML mapping is stopped with the time-limit message when converting, and the tab stays responsive', async ({
  page,
}) => {
  await page.goto(rel('/tools/data-convert'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('#f-from').selectOption('yaml');
  await page.locator('#f-to').selectOption('json');
  await setLargeValue(page, '#f-input', pathologicalSource());

  // Sampled shortly after the debounced autoRun should have started the
  // worker, but well before this tool's own 1.5s time limit could have
  // fired -- this evaluate() round trip runs on the PAGE's own event loop,
  // so it proves the tab stays responsive while parsing is stuck on the
  // worker's own thread, not that parsing itself finished quickly.
  await page.waitForTimeout(300);
  const evalStart = Date.now();
  await page.evaluate(() => performance.now());
  expect(Date.now() - evalStart).toBeLessThan(500);

  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 1.5 seconds', {
    timeout: 10_000,
  });
});

test('after a huge flat YAML mapping is stopped, the next conversion runs normally', async ({ page }) => {
  await page.goto(rel('/tools/data-convert'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('#f-from').selectOption('yaml');
  await page.locator('#f-to').selectOption('json');
  await setLargeValue(page, '#f-input', pathologicalSource());
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 1.5 seconds', {
    timeout: 10_000,
  });

  // A genuinely broken worker (the exact failure mode this test guards
  // against: a bundler setting once silently dropped a worker's startup
  // code in this repo, .planning/RETROSPECTIVE.md) would never resolve
  // normal input either -- it would sit on the same 1.5s timer and show the
  // same stopped message again. A working worker resolves this quickly
  // with the correct output instead.
  await page.locator('#f-input').fill('name: Ada\n');
  await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('"name": "Ada"', {
    timeout: 10_000,
  });
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toHaveCount(0);
});

test('a realistic nested YAML document converts normally, well under the time limit', async ({ page }) => {
  await page.goto(rel('/tools/data-convert'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  await page.locator('#f-from').selectOption('yaml');
  await page.locator('#f-to').selectOption('json');
  await page.locator('#f-input').fill('name: Ada\ntags:\n  - a\n  - b\n');

  await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('"name": "Ada"', {
    timeout: 10_000,
  });
  await expect(page.locator('section[aria-label="Output"] .issue-list')).toHaveCount(0);
});
