import { test, expect } from '@playwright/test';

/**
 * Fix for the v1.0 deferred item recorded at milestone close: this page read
 * zone offsets with Intl.DateTimeFormat's `shortOffset`, which Firefox can
 * resolve to a named abbreviation ("BST") instead of a numeric offset for
 * some zone/locale combinations. The offset regex only matches a
 * "GMT+HH:MM" shape, so that abbreviation silently fell back to the
 * '+00:00' default -- wrong for Europe/London in British Summer Time, whose
 * real offset is +01:00. `tools/unix-timestamp/src/index.ts` now reads
 * `longOffset` instead, the same approach
 * `tools/timezone-converter/src/index.ts` already uses and explains.
 *
 * Checked on all four browser projects: the whole point of the bug is that
 * engines disagree on `shortOffset`, so proving it on more than just
 * firefox is the stronger check, not a redundant one.
 */
const rel = (path: string) => path.replace(/^\//, '');

test('a London summer timestamp shows +01:00, not +00:00', async ({ page }) => {
  await page.goto(rel('/tools/unix-timestamp'));
  await page.locator('#f-input').fill('2026-07-15T11:00:00Z');
  await page.locator('#f-zone').selectOption('Europe/London');

  await expect(page.locator('section[aria-label="Output"]')).toContainText('UTC+01:00');
  await expect(page.locator('section[aria-label="Output"]')).not.toContainText('UTC+00:00');
});

test('a London winter timestamp still shows +00:00, unaffected by the fix', async ({ page }) => {
  await page.goto(rel('/tools/unix-timestamp'));
  await page.locator('#f-input').fill('2026-01-15T11:00:00Z');
  await page.locator('#f-zone').selectOption('Europe/London');

  await expect(page.locator('section[aria-label="Output"]')).toContainText('UTC+00:00');
});
