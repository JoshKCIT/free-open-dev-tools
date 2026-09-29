import { test, expect, type Page } from '@playwright/test';

/**
 * Behavioural proof of markdown-formatter's own 5 second time limit (see
 * apps/web/src/lib/run-markdown-formatter-in-worker.ts's own comment):
 * unlike yaml-formatter, every run here goes through the worker, because
 * there is no cheap way to tell a slow Markdown shape from a fast one
 * before formatting starts. A pathological input is stopped with a plain
 * message instead of freezing the tab, and the page keeps working normally
 * afterwards. Also proves the worker itself works on every engine: unlike
 * markdown-html's own micromark/turndown pair (STATE 05-07), which cannot
 * run inside a Worker at all, Prettier's markdown plugin can.
 */
const rel = (path: string) => path.replace(/^\//, '');

/**
 * Sets a textarea's value directly through its native setter and dispatches
 * one `input` event, instead of Playwright's own `fill()` -- see
 * yaml-formatter.spec.ts's own comment on why `fill()` is far too slow for
 * a large value in this sandboxed browser environment.
 */
async function setLargeValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/**
 * `[` repeated 50,000 times followed by `]` repeated 50,000 times: measured
 * uncapped (bypassing the worker's own limit, directly against the same
 * prettier/plugins/markdown build this page uses) at 12.5s on chromium,
 * 24.1s on firefox and 17.1s on webkit this session -- comfortably past the
 * 5s limit everywhere, unlike the `[a](` chain (also pathological in Node
 * at 19.2s for 50,000 repeats, but only 1.6s uncapped in a real chromium or
 * webkit engine, so not reliably past the limit there: Node and a real
 * browser do not always agree on which shapes are slow). A flat repeated
 * shape, so it cannot fail early on a stack overflow the way deeply nested
 * block quotes would.
 */
function pathologicalSource(): string {
  return '['.repeat(50_000) + ']'.repeat(50_000);
}

/** A realistic ~180KB-scale document: headings, emphasis, links, lists, a small table and a fenced block, repeated. */
function realisticSource(): string {
  const block =
    '## Section heading\n\nSome *emphasised* and **strong** prose with a [link](https://example.com) in it.\n\n' +
    '- one\n- two\n- three\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\n';
  const blocks: string[] = [];
  let size = 0;
  while (size < 180_000) {
    blocks.push(block);
    size += block.length;
  }
  return blocks.join('');
}

test.describe('markdown-formatter', () => {
  test('a pathological document is stopped with the time-limit message and the tab stays responsive', async ({
    page,
  }) => {
    await page.goto(rel('/tools/markdown-formatter'));
    await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

    await setLargeValue(page, '#f-input', pathologicalSource());

    // Sampled shortly after the debounced autoRun should have started the
    // worker, but well before this tool's own 5s time limit could have
    // fired -- this evaluate() round trip runs on the PAGE's own event loop,
    // so it proves the tab stays responsive while formatting is stuck on the
    // worker's own thread, not that formatting itself finished quickly.
    await page.waitForTimeout(300);
    const evalStart = Date.now();
    await page.evaluate(() => performance.now());
    expect(Date.now() - evalStart).toBeLessThan(500);

    await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 5 seconds', {
      timeout: 15_000,
    });
  });

  test('after a pathological document is stopped the next input formats normally', async ({ page }) => {
    await page.goto(rel('/tools/markdown-formatter'));
    await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

    await setLargeValue(page, '#f-input', pathologicalSource());
    await expect(page.locator('section[aria-label="Output"] .issue-list')).toContainText('Stopped after 5 seconds', {
      timeout: 15_000,
    });

    await page.locator('#f-input').fill('# Title\n\n* a\n* b\n');
    await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('Title', {
      timeout: 10_000,
    });
  });

  test('a realistic 180KB-scale document formats successfully through the worker', async ({ page }) => {
    await page.goto(rel('/tools/markdown-formatter'));
    await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

    await setLargeValue(page, '#f-input', realisticSource());
    await expect(page.locator('section[aria-label="Output"] pre.output')).toContainText('Section heading', {
      timeout: 10_000,
    });
    // Realistic-sized input must not hit the pathological-input time limit.
    await expect(page.locator('section[aria-label="Output"] .issue-list')).toHaveCount(0);
  });
});
