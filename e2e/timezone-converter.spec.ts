import { test, expect } from '@playwright/test';

/**
 * Cross-browser proof of ROADMAP criterion 3's time-zone half (D-30, D-42):
 * a DST transition converts identically in every browser project, or, if a
 * browser's own IANA data genuinely disagrees, that browser's own measured
 * answer is asserted instead -- the unit tests in
 * tools/timezone-converter/test/index.test.ts stay pinned to the published
 * tzdata rules regardless. Lives in its own spec file per this phase's
 * `<shared_procedure>`, the same reason `e2e/regex-tester.spec.ts` does.
 */
const rel = (path: string) => path.replace(/^\//, '');

async function convertedOffset(page: import('@playwright/test').Page, moment: string, toZone: string): Promise<string> {
  await page.goto(rel('/tools/timezone-converter'));
  await page.locator('#f-moment').fill(moment);
  await page.locator('#f-fromZone').selectOption('UTC');
  await page.locator('#f-toZone').selectOption(toZone);
  const value = page
    .locator('section[aria-label="Output"] dl.kv dt', { hasText: `To (${toZone})` })
    .locator('xpath=following-sibling::dd[1]');
  // Web-first assertion, auto-retried: waits out the autoRun debounce and any
  // stale render from an intermediate field change, rather than reading the
  // DOM the instant the element first becomes visible (which can still show
  // the previous field combination's output).
  await expect(value).toContainText(moment.slice(0, 10), { timeout: 10_000 });
  return value.innerText();
}

test('New York spring-forward and fall-back conversions match the IANA rules in this browser', async ({ page }) => {
  // Spring forward: 2024-03-10 06:59:59Z is -05:00, 07:00:00Z is -04:00.
  expect(await convertedOffset(page, '2024-03-10T06:59:59Z', 'America/New_York')).toContain('-05:00');
  expect(await convertedOffset(page, '2024-03-10T07:00:00Z', 'America/New_York')).toContain('-04:00');
  // Fall back: 2024-11-03 05:59:59Z is -04:00, 06:00:00Z is -05:00.
  expect(await convertedOffset(page, '2024-11-03T05:59:59Z', 'America/New_York')).toContain('-04:00');
  expect(await convertedOffset(page, '2024-11-03T06:00:00Z', 'America/New_York')).toContain('-05:00');
});

test('London spring-forward and fall-back conversions match the IANA rules in this browser', async ({ page }) => {
  // Spring forward: 2024-03-31 00:59:59Z is +00:00, 01:00:00Z is +01:00.
  expect(await convertedOffset(page, '2024-03-31T00:59:59Z', 'Europe/London')).toContain('+00:00');
  expect(await convertedOffset(page, '2024-03-31T01:00:00Z', 'Europe/London')).toContain('+01:00');
  // Fall back: 2024-10-27 00:59:59Z is +01:00, 01:00:00Z is +00:00.
  expect(await convertedOffset(page, '2024-10-27T00:59:59Z', 'Europe/London')).toContain('+01:00');
  expect(await convertedOffset(page, '2024-10-27T01:00:00Z', 'Europe/London')).toContain('+00:00');
});
