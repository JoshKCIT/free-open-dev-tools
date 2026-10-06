import { test, expect, type Page } from '@playwright/test';

/**
 * HARD-01 (D-217): a background run that is still going after about a second shows a working cue beside the output.
 *
 * Nothing here depends on a slow tool or a real wait. An init script wraps `window.Worker` so that, while `window.__hold`
 * is true, a worker the page constructs never answers (it is a stub that takes every message and says nothing); with no
 * hold it builds the real worker, so the page behaves as it does for a visitor. `page.clock` is installed before the page
 * loads, a normal run is made first (so there is an earlier result to dim), and from the moment the held run starts the
 * clock moves only when the test says so (`runFor`). Timing is asserted through the fake clock and as patterns, never as
 * exact seconds of real time. The regex tester is the page under test: it runs in a worker, can be cancelled, and its
 * helper enforces a 1.5 second limit (`REGEX_TIME_LIMIT_MS`), so a held run is still going at 1,100 ms.
 *
 * Runs on all four projects (chromium, firefox, webkit, mobile-chrome) against the production build.
 */

declare global {
  interface Window {
    __hold?: boolean;
  }
}

const rel = (path: string) => path.replace(/^\//, '');

/** The helper's own limit is 1500 ms, which the cue states as 1.5 s. */
const START_SENTENCE = 'Working. This stops by itself after 1.5 seconds.';

function output(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

/** The one persistent status element: a direct child of the Output section (each Copy button holds its own, inside). */
function status(page: Page) {
  return output(page).locator(':scope > [role="status"]');
}

/** The cue: a direct child of the Output section, between its heading and its body. */
function cue(page: Page) {
  return output(page).locator(':scope > .working-cue');
}

function outputBody(page: Page) {
  return output(page).locator(':scope > .panel-body');
}

/** Makes `window.Worker` hold its job and never answer while `window.__hold` is true. Call after `page.clock.install`. */
async function installHold(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__hold = false;
    const Real = window.Worker;
    const held = {
      postMessage() {},
      terminate() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
      onmessage: null,
      onerror: null,
      onmessageerror: null,
    };
    window.Worker = new Proxy(Real, {
      construct(target, args, newTarget) {
        return window.__hold ? (held as unknown as object) : Reflect.construct(target, args, newTarget);
      },
    });
  });
}

/** Fills a text field and checks the value stayed (the pages are prerendered, so an early fill can be cleared once). */
async function fillAndHold(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Opens the regex tester on a running page clock, with the hold wrapper in place, and makes one normal run. */
async function openWithFirstResult(page: Page): Promise<void> {
  await page.clock.install();
  await installHold(page);
  await page.goto(rel('/tools/regex-tester'));
  await fillAndHold(page, 'pattern', 'a+');
  await fillAndHold(page, 'input', 'aaa baaa');
  await expect(output(page).locator('table.output-table')).toBeVisible({ timeout: 20_000 });
  await expect(output(page)).toHaveAttribute('aria-busy', 'false');
}

/**
 * Holds the worker, pauses the clock, and starts a run by an edit. Resolves when the run has begun (the Output section
 * says it is busy); the clock has then run for exactly the page's own 140 ms typing delay and no further.
 */
async function startHeldRun(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__hold = true;
  });
  await page.clock.pauseAt(Date.now() + 5000);
  await page.locator('#f-pattern').fill('a+a');
  await page.clock.runFor(140);
  await expect(output(page)).toHaveAttribute('aria-busy', 'true');
}

test('regex-tester: a held run shows nothing at 500 ms, then at 1100 ms the cue, the dimmed earlier result, a disabled Copy and the start message', async ({
  page,
}) => {
  await openWithFirstResult(page);
  await expect(status(page)).toHaveText('');
  await startHeldRun(page);

  // 500 ms into the run: nothing new at all.
  await page.clock.runFor(500);
  await expect(cue(page)).toHaveCount(0);
  await expect(outputBody(page)).not.toHaveClass(/output-stale/);
  await expect(status(page)).toHaveText('');
  await expect(output(page).getByRole('button', { name: 'Copy as TSV' })).toBeEnabled();

  // 1,100 ms into the run: the cue, the dimming, the disabled Copy and the one start message.
  await page.clock.runFor(600);
  await expect(cue(page)).toHaveText(/Working… \d+ s \(stops at 1\.5 s\)/);
  await expect(cue(page)).toContainText('Showing the previous result while this runs.');
  await expect(cue(page)).toHaveAttribute('aria-hidden', 'true');
  await expect(outputBody(page)).toHaveClass(/output-stale/);
  await expect(output(page).getByRole('button', { name: 'Copy as TSV' })).toBeDisabled();
  await expect(status(page)).toHaveText(START_SENTENCE);
});

test('regex-tester: Cancel removes the cue, shows the existing cancelled note exactly and says Cancelled.', async ({
  page,
}) => {
  await openWithFirstResult(page);
  await startHeldRun(page);
  await page.clock.runFor(1100);
  await expect(cue(page)).toBeVisible();
  await expect(cue(page)).toContainText('Press Cancel to stop it.');

  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toHaveCount(1);
  await cancel.click();

  await expect(cue(page)).toHaveCount(0);
  await expect(outputBody(page)).not.toHaveClass(/output-stale/);
  await expect(output(page).locator('.note-warn')).toHaveText('Cancelled before finishing. No result was produced.');
  await expect(status(page)).toHaveText('Cancelled.');
  await expect(output(page)).toHaveAttribute('aria-busy', 'false');
});

test('regex-tester: a run that finishes within a second shows no cue, no dimming and no status text', async ({
  page,
}) => {
  await openWithFirstResult(page);
  // The first result above was a normal run; make another one and let it finish, with the clock running as usual.
  await fillAndHold(page, 'pattern', 'a');
  await expect(output(page).locator('table.output-table')).toBeVisible();
  await expect(output(page)).toHaveAttribute('aria-busy', 'false');
  await expect(cue(page)).toHaveCount(0);
  await expect(outputBody(page)).not.toHaveClass(/output-stale/);
  await expect(status(page)).toHaveText('');
});
