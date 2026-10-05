import { test, expect, type Page } from '@playwright/test';

/**
 * HARD-06 (D-218): the 2FA page keeps its time-based codes current by itself.
 *
 * The values come from RFC 6238 Appendix B (the SHA-1 seed 12345678901234567890, 8 digits, a 30 second period): the code
 * for Unix time 1111111109 is 07081804 and the code for 1111111111 is 14050471, so a clock one second before a boundary
 * must show the first and, once the boundary has passed, the second, with no field touched.
 *
 * All timing goes through the page clock (`page.clock`) and never through a real sleep. The clock is installed some time
 * before the moment under test, the secret is typed while it runs, and then it is paused just before the moment under test
 * (`pauseAt`). From there only `fastForward` and
 * `runFor` move it, so the checks do not depend on how long the machine takes. An init script lists every timeout of 250
 * ms or more the page arms (the page's only timers of that length are the refresh timers), so "no timer is armed" and
 * "the next timer is armed from the new result" are read directly.
 *
 * Runs on all four projects (chromium, firefox, webkit, mobile-chrome) against the production build.
 */

declare global {
  interface Window {
    __fodtArmed?: number[];
    __fodtRows?: string[];
  }
}

const rel = (path: string) => path.replace(/^\//, '');

/** The RFC 4226 and 6238 test secret (the ASCII text 12345678901234567890) as Base32, in groups of four. */
const SEED = 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ';

/** One second before the boundary at 1111111110 seconds, in milliseconds. */
const ONE_SECOND_BEFORE_BOUNDARY = 1_111_111_109_000;

/** The wait the page asks for when the clock stands one second before a boundary: the one second plus 25 ms. */
const WAIT_FROM_THERE = 1025;

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

/** Lists every timeout of 250 ms or more that the page arms, on `window.__fodtArmed`. Call after the clock is installed. */
async function recordArmedTimeouts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__fodtArmed = [];
    const original = window.setTimeout.bind(window) as (...args: unknown[]) => number;
    (window as unknown as { setTimeout: unknown }).setTimeout = (
      handler: unknown,
      ms?: unknown,
      ...rest: unknown[]
    ) => {
      if (typeof ms === 'number' && ms >= 250) window.__fodtArmed?.push(ms);
      return original(handler, ms, ...rest);
    };
  });
}

async function armedTimeouts(page: Page): Promise<number[]> {
  return await page.evaluate(() => window.__fodtArmed ?? []);
}

/** Opens the page on a running clock that starts two minutes before `momentMs`, with the timeout list recording. */
async function openPage(page: Page, momentMs: number): Promise<void> {
  await page.clock.install({ time: momentMs - 120_000 });
  await recordArmedTimeouts(page);
  await page.goto(rel('/tools/totp-generator'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

/**
 * Opens the page, types the secret and 8 digits, waits for the first codes, then pauses the clock at `momentMs` and waits
 * for the codes of that moment.
 */
async function openAtMoment(page: Page, momentMs: number, firstCode: string, typedTime?: string): Promise<void> {
  await openPage(page, momentMs);
  await page.locator('#f-digits').selectOption('8');
  if (typedTime !== undefined) await fillAndHold(page, 'at', typedTime);
  await fillAndHold(page, 'secret', SEED);
  await expect(currentRow(page)).toBeVisible({ timeout: 20_000 });
  // Jump to 140 ms before the moment and pause there. A harmless edit (a trailing space in the secret, which is skipped)
  // starts a run after the page's 140 ms typing delay, so letting the clock run for exactly 140 ms makes that run read
  // the clock at exactly `momentMs`. The engines differ in what a jump does to timers that fell due during it, so the
  // moment is reached by a run the test asked for rather than by the jump.
  await page.clock.pauseAt(momentMs - 140);
  await page.locator('#f-secret').fill(`${SEED} `);
  await page.clock.runFor(140);
  await expect(currentRow(page)).toContainText(firstCode, { timeout: 20_000 });
  if (typedTime === undefined) {
    await expect(statValue(page, 'Unix seconds')).toHaveText(String(Math.floor(momentMs / 1000)));
    // The run's result arms the next timer in an effect after the screen is updated; wait for it before moving the clock.
    await expect.poll(async () => (await armedTimeouts(page)).at(-1)).toBe(WAIT_FROM_THERE);
  }
}

/** The value of one stat in the output, such as Unix seconds. */
function statValue(page: Page, name: string) {
  return outputArea(page).locator('.stats span', { hasText: name }).locator('strong');
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

test('totp-generator: across three boundaries the current row changes exactly three times', async ({ page }) => {
  await openAtMoment(page, ONE_SECOND_BEFORE_BOUNDARY, '07081804');
  // Lists each distinct text the current row takes, in order, from a mutation observer on the output.
  await page.evaluate(() => {
    window.__fodtRows = [];
    const output = document.querySelector('section[aria-label="Output"]');
    if (!output) throw new Error('no output panel');
    let last = '';
    const record = () => {
      const row = Array.from(output.querySelectorAll('tr')).find((tr) =>
        (tr.textContent ?? '').includes('current (step'),
      );
      const text = row?.textContent ?? '';
      if (text !== '' && text !== last) {
        last = text;
        window.__fodtRows?.push(text);
      }
    };
    record();
    new MutationObserver(record).observe(output, { subtree: true, childList: true, characterData: true });
  });
  const rows = async () => await page.evaluate(() => window.__fodtRows ?? []);
  expect(await rows()).toHaveLength(1);

  // After each change, wait until the page has armed its next timer before moving the clock again.
  let armedSoFar = (await armedTimeouts(page)).length;
  const nextTimerArmed = async () => {
    await expect.poll(async () => (await armedTimeouts(page)).length).toBeGreaterThan(armedSoFar);
    armedSoFar = (await armedTimeouts(page)).length;
  };
  await page.clock.fastForward(1500);
  await expect.poll(async () => (await rows()).length).toBe(2);
  await nextTimerArmed();
  await page.clock.fastForward(30_000);
  await expect.poll(async () => (await rows()).length).toBe(3);
  await nextTimerArmed();
  await page.clock.fastForward(30_000);
  await expect.poll(async () => (await rows()).length).toBe(4);

  // Exactly one change per boundary, and each is a different step.
  const seen = await rows();
  expect(seen).toHaveLength(4);
  expect(new Set(seen).size).toBe(4);
});

test('totp-generator: a typed time never refreshes by itself', async ({ page }) => {
  // RFC 6238 Appendix B, SHA-1, 8 digits, time 59: 94287082.
  await openAtMoment(page, ONE_SECOND_BEFORE_BOUNDARY, '94287082', '59');
  await page.clock.fastForward(120_000);
  await expect(currentRow(page)).toContainText('94287082');
  await expect(outputArea(page)).toContainText('the time you typed');
  await expect(outputArea(page)).not.toContainText('14050471');
  await expect(outputArea(page).locator('.countdown')).toHaveCount(0);
});

test('totp-generator: counter based codes never change by themselves', async ({ page }) => {
  await openPage(page, ONE_SECOND_BEFORE_BOUNDARY);
  await page.locator('input[name="mode"][value="hotp"]').click();
  await fillAndHold(page, 'secret', SEED);
  // RFC 4226 Appendix D, counter 0: 755224.
  const firstRow = outputArea(page).locator('tr', { hasText: '755224' });
  await expect(firstRow).toBeVisible({ timeout: 20_000 });
  const before = await outputArea(page).locator('table').innerText();
  await page.clock.pauseAt(ONE_SECOND_BEFORE_BOUNDARY);
  await page.clock.fastForward(120_000);
  expect(await outputArea(page).locator('table').innerText()).toBe(before);
  await expect(outputArea(page).locator('.countdown')).toHaveCount(0);
});

test('totp-generator: ticking Pause refreshing freezes the codes and hides the countdown, and unticking refreshes at once', async ({
  page,
}) => {
  await openAtMoment(page, ONE_SECOND_BEFORE_BOUNDARY, '07081804');
  await expect(outputArea(page).locator('.countdown')).toHaveCount(1);

  await page.getByLabel('Pause refreshing').check();
  await page.clock.runFor(300);
  await expect(outputArea(page)).toContainText('Refreshing is paused.');
  await expect(outputArea(page).locator('.countdown')).toHaveCount(0);

  // Two minutes pass and the codes stay as they were.
  await page.clock.fastForward(120_000);
  await expect(currentRow(page)).toContainText('07081804');
  await expect(statValue(page, 'Unix seconds')).toHaveText('1111111109');

  // Unticking refreshes at once: the codes are those of the clock now, and the countdown is back.
  await page.getByLabel('Pause refreshing').uncheck();
  await page.clock.runFor(300);
  await expect(currentRow(page)).not.toContainText('07081804');
  await expect(statValue(page, 'Unix seconds')).toHaveText('1111111229');
  await expect(outputArea(page).locator('.countdown')).toHaveCount(1);
  await expect(outputArea(page)).not.toContainText('Refreshing is paused.');
});

for (const event of ['visibilitychange', 'pageshow'] as const) {
  test(`totp-generator: on a ${event} event after a boundary passed the codes refresh at once and the next boundary timer is armed from that result`, async ({
    page,
  }) => {
    await openAtMoment(page, ONE_SECOND_BEFORE_BOUNDARY, '07081804');
    await expect(statValue(page, 'Unix seconds')).toHaveText('1111111109');
    // Before the boundary: the event changes nothing, because the due time has not come.
    await page.evaluate((name) => {
      if (name === 'visibilitychange') document.dispatchEvent(new Event('visibilitychange'));
      else window.dispatchEvent(new Event('pageshow'));
    }, event);
    await expect(statValue(page, 'Unix seconds')).toHaveText('1111111109');

    // A minute passes without any timer firing (a hidden tab or a sleeping laptop), then the page is shown again.
    const armedBefore = (await armedTimeouts(page)).length;
    await page.clock.setFixedTime(ONE_SECOND_BEFORE_BOUNDARY + 60_000);
    await page.evaluate((name) => {
      if (name === 'visibilitychange') document.dispatchEvent(new Event('visibilitychange'));
      else window.dispatchEvent(new Event('pageshow'));
    }, event);
    await expect(statValue(page, 'Unix seconds')).toHaveText('1111111169');
    await expect(currentRow(page)).not.toContainText('07081804');

    // The refresh ran once, and its result armed the timer for the next boundary (59 s past 1111111110 is 29 s into a
    // step, so one second and 25 ms away).
    await expect.poll(async () => (await armedTimeouts(page)).length).toBe(armedBefore + 1);
    const armed = await armedTimeouts(page);
    expect(armed[armed.length - 1]).toBe(WAIT_FROM_THERE);
  });
}

test('totp-generator: the codes table is never inside a live region and the countdown announces nothing', async ({
  page,
}) => {
  await openAtMoment(page, ONE_SECOND_BEFORE_BOUNDARY, '07081804');
  const table = outputArea(page).locator('table').first();
  const liveAncestor = await table.evaluate((el) =>
    el.closest('[aria-live], [role="status"], [role="alert"], [role="log"]') === null ? 'none' : 'found',
  );
  expect(liveAncestor).toBe('none');
  const countdown = outputArea(page).locator('.countdown');
  await expect(countdown).toHaveAttribute('role', 'timer');
  expect(await countdown.getAttribute('aria-live')).toBeNull();
  expect(await countdown.locator('[aria-live]').count()).toBe(0);
  // The countdown is not an ancestor or a descendant of the table.
  expect(await countdown.locator('table').count()).toBe(0);
  expect(await table.locator('.countdown').count()).toBe(0);
});

const NO_TIMER_CASES: { name: string; arrange: (page: Page) => Promise<void> }[] = [
  {
    name: 'an empty secret',
    arrange: async () => {},
  },
  {
    name: 'an invalid secret',
    arrange: async (page) => {
      await fillAndHold(page, 'secret', 'abc1 0189');
    },
  },
  {
    name: 'counter based codes',
    arrange: async (page) => {
      await page.locator('input[name="mode"][value="hotp"]').click();
      await fillAndHold(page, 'secret', SEED);
    },
  },
  {
    name: 'a typed time',
    arrange: async (page) => {
      await fillAndHold(page, 'at', '59');
      await fillAndHold(page, 'secret', SEED);
    },
  },
  {
    name: 'Pause refreshing ticked',
    arrange: async (page) => {
      await page.getByLabel('Pause refreshing').check();
      await fillAndHold(page, 'secret', SEED);
    },
  },
];

for (const c of NO_TIMER_CASES) {
  test(`totp-generator: with ${c.name} no refresh timer is armed`, async ({ page }) => {
    await openPage(page, ONE_SECOND_BEFORE_BOUNDARY);
    await c.arrange(page);
    // Let the typing settle: the debounce is well under a second of page time.
    await page.clock.runFor(500);
    await page.clock.fastForward(120_000);
    expect(await armedTimeouts(page)).toEqual([]);
    if (c.name === 'an empty secret') await expect(outputArea(page).locator('table')).toHaveCount(0);
    else if (c.name !== 'an invalid secret') await expect(outputArea(page).locator('table')).toHaveCount(1);
  });
}
