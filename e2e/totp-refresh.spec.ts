import { test, expect, type Page } from '@playwright/test';

/**
 * HARD-06 (D-218): the 2FA page keeps its time-based codes current by itself.
 *
 * The values come from RFC 6238 Appendix B (the SHA-1 seed 12345678901234567890, 8 digits, a 30 second period): the code
 * for Unix time 1111111109 is 07081804 and the code for 1111111111 is 14050471, so a clock one second before a boundary
 * must show the first and, once the boundary has passed, the second, with no field touched.
 *
 * All timing goes through the page clock (`page.clock`) and never through a real sleep. The clock is installed some time
 * before the moment under test, the secret is typed while it runs, and then it is paused at the moment under test
 * (`pauseAt`), which is the equivalent of a closed laptop lid opened at that second. From there only `fastForward` moves
 * it, so the checks do not depend on how long the machine takes.
 *
 * Runs on all four projects (chromium, firefox, webkit, mobile-chrome) against the production build.
 */

const rel = (path: string) => path.replace(/^\//, '');

/** The RFC 4226 and 6238 test secret (the ASCII text 12345678901234567890) as Base32, in groups of four. */
const SEED = 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ';

/** One second before the boundary at 1111111110 seconds, in milliseconds. */
const ONE_SECOND_BEFORE_BOUNDARY = 1_111_111_109_000;

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

/** The table row of the step that is current at the moment the codes were made. */
function currentRow(page: Page) {
  return outputArea(page).locator('tr', { hasText: 'current (step' });
}

/** Fills a text field and checks the value stayed (the pages are prerendered, so an early fill can be cleared once). */
async function fillAndHold(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/**
 * Opens the page with a running clock that starts two minutes before `momentMs`, types the secret and 8 digits, waits for
 * the first codes, then pauses the clock at `momentMs` and waits for the codes of that moment.
 */
async function openAtMoment(page: Page, momentMs: number, firstCode: string, typedTime?: string): Promise<void> {
  await page.clock.install({ time: momentMs - 120_000 });
  await page.goto(rel('/tools/totp-generator'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
  await page.locator('#f-digits').selectOption('8');
  if (typedTime !== undefined) await fillAndHold(page, 'at', typedTime);
  await fillAndHold(page, 'secret', SEED);
  await expect(currentRow(page)).toBeVisible({ timeout: 20_000 });
  // The page's one refresh timer is already waiting for a boundary; the jump runs it once, at the moment under test.
  await page.clock.pauseAt(momentMs);
  await expect(currentRow(page)).toContainText(firstCode, { timeout: 20_000 });
}

test('totp-generator: one second before a boundary the current row shows the earlier code and 1.5 seconds later the next one, with no field touched', async ({
  page,
}) => {
  await openAtMoment(page, ONE_SECOND_BEFORE_BOUNDARY, '07081804');
  await expect(currentRow(page)).not.toContainText('14050471');

  // The refresh waits for the boundary plus 25 ms, so a second later (the boundary itself) nothing has run early.
  await page.clock.fastForward(1000);
  await expect(currentRow(page)).toContainText('07081804');
  await expect(currentRow(page)).not.toContainText('14050471');

  // Half a second more and the boundary is past: the next step's code is current.
  await page.clock.fastForward(500);
  await expect(currentRow(page)).toContainText('14050471');
  await expect(currentRow(page)).not.toContainText('07081804');
});

test('totp-generator: a typed time never refreshes by itself', async ({ page }) => {
  // RFC 6238 Appendix B, SHA-1, 8 digits, time 59: 94287082.
  await openAtMoment(page, ONE_SECOND_BEFORE_BOUNDARY, '94287082', '59');
  await page.clock.fastForward(120_000);
  await expect(currentRow(page)).toContainText('94287082');
  await expect(outputArea(page)).toContainText('the time you typed');
  await expect(outputArea(page)).not.toContainText('14050471');
});

test('totp-generator: counter based codes never change by themselves', async ({ page }) => {
  await page.clock.install({ time: ONE_SECOND_BEFORE_BOUNDARY - 120_000 });
  await page.goto(rel('/tools/totp-generator'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
  await page.locator('input[name="mode"][value="hotp"]').click();
  await fillAndHold(page, 'secret', SEED);
  // RFC 4226 Appendix D, counter 0: 755224.
  const firstRow = outputArea(page).locator('tr', { hasText: '755224' });
  await expect(firstRow).toBeVisible({ timeout: 20_000 });
  const before = await outputArea(page).locator('table').innerText();
  await page.clock.pauseAt(ONE_SECOND_BEFORE_BOUNDARY);
  await page.clock.fastForward(120_000);
  expect(await outputArea(page).locator('table').innerText()).toBe(before);
});
