import { test, expect } from '@playwright/test';

/**
 * Exercises the real page in both escape directions, per 02-04-PLAN.md.
 *
 * This proof cannot live in `tools/unicode-inspector/test/` (the standalone
 * gate copies only the tool folder) nor be added to the root Vitest config
 * (`vitest.config.ts` includes only `tools/*\/test/**` and `scripts/test/**`,
 * and is outside amended D-23's authoritative file list). A new file under
 * `e2e/` is unconstrained by either limitation, so the page-level proof that
 * `fromEscapes` is actually reachable through the page's own `run` lives
 * here instead.
 */
const rel = (path: string) => path.replace(/^\//, '');

test('the page run function converts text to escapes and escapes back to text', async ({ page }) => {
  await page.goto(rel('/tools/unicode-inspector'));

  // Switch to the escape-conversion mode.
  await page.locator('input[name="mode"][value="escapes"]').check();

  const original = 'café €';
  const input = page.locator('#f-input');
  await input.fill(original);

  // Direction defaults to "Text -> escapes"; wait for the debounced auto-run
  // to produce output, then read the escaped text back out. Scoped to the
  // Output section specifically -- the docs panel's "Use it yourself"
  // snippet also renders a `pre.output` element on the same page.
  const output = page.locator('section[aria-label="Output"] pre.output').first();
  await expect(output).not.toHaveText('');
  const escaped = (await output.textContent())!.trim();
  expect(escaped).not.toBe(original);
  expect(escaped).toContain('\\u00E9'); // the é in "café", escaped

  // Feed the escaped text back in and flip the direction control, which is
  // what makes fromEscapes reachable at all -- the package exports both
  // directions, and without a control that dispatches to the reverse
  // direction the decoding half ships unreachable from the page.
  await input.fill(escaped);
  await page.locator('input[name="escapeDirection"][value="fromEscapes"]').check();

  await expect(output).toHaveText(original);
});
