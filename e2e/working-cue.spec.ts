import { test, expect, type Page } from '@playwright/test';

/**
 * HARD-01 (D-217): a background run that is still going after about a second shows a working cue beside the output.
 *
 * Nothing here depends on a slow tool or a real wait. An init script wraps `window.Worker` so that, while `window.__hold`
 * is true, a worker the page constructs never answers (it is a stub that takes every message and says nothing); with no
 * hold it builds the real worker, so the page behaves as it does for a visitor. `page.clock` is installed before the page
 * loads, a normal run is made first (so there is an earlier result to dim), and from the moment the held run starts the
 * clock moves only when the test says so (`runFor`). Timing is asserted through the fake clock and as patterns, never as
 * exact seconds of real time. The regex tester is the main page under test: it runs in a worker, can be cancelled, and
 * its helper enforces a 1.5 second limit (`REGEX_TIME_LIMIT_MS`), so a held run is still going at 1,100 ms and ends by
 * itself at 1,500 ms. Other pages cover what the regex tester cannot: the password hasher (a Run button, no limit), the
 * glob tester (a run limit that is shorter than its start limit, so the cue can pass its limit while the helper waits),
 * and the chart maker (not cancellable, so a new run can supersede a running one; its PNG step is held at `toBlob`).
 *
 * The timer proof wraps `setTimeout`, `setInterval` and their clearing functions in an init script, after the clock is
 * installed, and lists every interval and every timeout of 100 ms or more that is created after a marker and has neither
 * fired nor been cleared. The status proof records every change of the one status element with a mutation observer. The
 * contrast proof reads the real elements' computed colours and blends them with the stale container's computed opacity.
 *
 * Runs on all four projects (chromium, firefox, webkit, mobile-chrome) against the production build.
 */

declare global {
  interface Window {
    __hold?: boolean;
    __holdBlob?: boolean;
    __failHeld?: () => void;
    __fodtTimers?: { on: boolean; live: Map<unknown, string> };
    __fodtStatusLog?: string[];
  }
}

const rel = (path: string) => path.replace(/^\//, '');

/** The helper's own limit is 1500 ms, which the cue states as 1.5 s. */
const START_SENTENCE = 'Working. This stops by itself after 1.5 seconds.';

/** The single ellipsis character the Run label already uses, written as an escape so this file stays plain ASCII. */
const ELLIPSIS = '…';

/** The dim values the styles use, and the least blended contrast any text may have (WCAG AA for normal text). */
const DIM = { dark: 0.8, light: 0.92 } as const;
const MIN_CONTRAST = 4.5;

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

function cancelButton(page: Page) {
  return page.getByRole('button', { name: 'Cancel', exact: true });
}

/**
 * Makes `window.Worker` hold its job and never answer while `window.__hold` is true, and `canvas.toBlob` never call back
 * while `window.__holdBlob` is true. `window.__failHeld()` makes every held worker report a native error, which is how a
 * worker that cannot run ends a run. Call after `page.clock.install`.
 */
async function installHold(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__hold = false;
    window.__holdBlob = false;
    const listeners: [string, (event: Event) => void][] = [];
    const held = {
      postMessage() {},
      terminate() {},
      addEventListener(type: string, handler: (event: Event) => void) {
        listeners.push([type, handler]);
      },
      removeEventListener(type: string, handler: (event: Event) => void) {
        const at = listeners.findIndex(([t, h]) => t === type && h === handler);
        if (at >= 0) listeners.splice(at, 1);
      },
      dispatchEvent() {
        return true;
      },
      onmessage: null,
      onerror: null,
      onmessageerror: null,
    };
    window.__failHeld = () => {
      for (const [type, handler] of listeners.slice()) if (type === 'error') handler(new Event('error'));
    };
    const Real = window.Worker;
    window.Worker = new Proxy(Real, {
      construct(target, args, newTarget) {
        return window.__hold ? (held as unknown as object) : Reflect.construct(target, args, newTarget);
      },
    });
    const realToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, ...args: Parameters<typeof realToBlob>) {
      if (window.__holdBlob) return;
      return realToBlob.apply(this, args);
    };
  });
}

/**
 * Lists every interval, and every timeout of 100 ms or more, that is created while `window.__fodtTimers.on` is true and
 * has neither fired nor been cleared. Call after `page.clock.install` so the wrappers sit over the fake timers.
 */
async function installTimerCount(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const live = new Map<unknown, string>();
    window.__fodtTimers = { on: false, live };
    type Starter = (handler: unknown, ms?: unknown, ...rest: unknown[]) => unknown;
    type Clearer = (id: unknown) => void;
    const w = window as unknown as Record<string, unknown>;
    const realSetTimeout = (w.setTimeout as Starter).bind(window);
    const realSetInterval = (w.setInterval as Starter).bind(window);
    const realClearTimeout = (w.clearTimeout as Clearer).bind(window);
    const realClearInterval = (w.clearInterval as Clearer).bind(window);
    w.setTimeout = (handler: unknown, ms?: unknown, ...rest: unknown[]) => {
      const track = window.__fodtTimers?.on && typeof handler === 'function' && typeof ms === 'number' && ms >= 100;
      if (!track) return realSetTimeout(handler, ms, ...rest);
      const id: unknown = realSetTimeout(
        () => {
          live.delete(id);
          (handler as () => void)();
        },
        ms,
        ...rest,
      );
      live.set(id, `timeout ${String(ms)}`);
      return id;
    };
    w.setInterval = (handler: unknown, ms?: unknown, ...rest: unknown[]) => {
      const id = realSetInterval(handler, ms, ...rest);
      if (window.__fodtTimers?.on) live.set(id, `interval ${String(ms)}`);
      return id;
    };
    w.clearTimeout = (id: unknown) => {
      live.delete(id);
      realClearTimeout(id);
    };
    w.clearInterval = (id: unknown) => {
      live.delete(id);
      realClearInterval(id);
    };
  });
}

async function startCountingTimers(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (!window.__fodtTimers) throw new Error('the timer wrappers are not installed');
    window.__fodtTimers.live.clear();
    window.__fodtTimers.on = true;
  });
}

async function liveTimers(page: Page): Promise<string[]> {
  return await page.evaluate(() => Array.from(window.__fodtTimers?.live.values() ?? []));
}

/** Starts recording each change of the status text, beginning from what it shows now. */
async function watchStatus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector('section[aria-label="Output"] > [role="status"]');
    if (!el) throw new Error('no status element in the Output section');
    window.__fodtStatusLog = [];
    let last = el.textContent ?? '';
    new MutationObserver(() => {
      const now = el.textContent ?? '';
      if (now === last) return;
      last = now;
      window.__fodtStatusLog?.push(now);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
}

async function statusLog(page: Page): Promise<string[]> {
  return await page.evaluate(() => window.__fodtStatusLog ?? []);
}

async function setHold(page: Page, on: boolean): Promise<void> {
  await page.evaluate((value) => {
    window.__hold = value;
  }, on);
}

/** Fills a field and checks the value stayed (the pages are prerendered, so an early fill can be cleared once). */
async function fillAndHold(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Adds one space to a field, which is a real edit and so starts a run after the page's 140 ms typing delay. */
async function nudge(page: Page, name: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await field.fill(`${await field.inputValue()} `);
}

/** Opens a tool page on a running page clock with the hold and timer wrappers in place. */
async function openTool(page: Page, path: string): Promise<void> {
  await page.clock.install();
  await installHold(page);
  await installTimerCount(page);
  await page.goto(rel(path));
}

/** Opens the regex tester and makes one normal run, so there is an earlier result to dim. */
async function openWithFirstResult(page: Page): Promise<void> {
  await openTool(page, '/tools/regex-tester');
  await fillAndHold(page, 'pattern', 'a+');
  await fillAndHold(page, 'input', 'aaa baaa');
  await expect(output(page).locator('table.output-table')).toBeVisible({ timeout: 20_000 });
  await expect(output(page)).toHaveAttribute('aria-busy', 'false');
}

/**
 * Waits for the page to finish its pending render work. A run's cue sets its delay in an effect that React flushes just
 * after the screen is updated; the paused clock must not be moved before that, or the cue would start its delay late.
 * A message through a channel is a task queued behind React's own, and the fake clock does not touch it.
 */
async function flushRender(page: Page): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => resolve();
          channel.port2.postMessage(0);
        }),
    );
  }
}

const paused = new WeakSet<Page>();

/** Pauses the page clock the first time it is called for a page; from then on only `runFor` moves it. */
async function pauseClock(page: Page): Promise<void> {
  if (paused.has(page)) return;
  paused.add(page);
  await page.clock.pauseAt(Date.now() + 5000);
}

/**
 * Holds the worker, pauses the clock, and starts a run by an edit. Resolves when the run has begun (the Output section
 * says it is busy); the clock has then run for exactly the page's own 140 ms typing delay and no further.
 */
async function startHeldRun(page: Page, field = 'pattern'): Promise<void> {
  await setHold(page, true);
  await pauseClock(page);
  await nudge(page, field);
  await page.clock.runFor(140);
  await expect(output(page)).toHaveAttribute('aria-busy', 'true');
  await flushRender(page);
}

/** Lets a normal (not held) run that an edit started finish, with the clock moving only for the typing delay. */
async function finishRealRun(page: Page): Promise<void> {
  await setHold(page, false);
  await page.clock.runFor(200);
  await expect(output(page)).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
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
  await expect(cue(page)).toHaveText(new RegExp(`Working${ELLIPSIS} \\d+ s \\(stops at 1\\.5 s\\)`));
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

  await expect(cancelButton(page)).toHaveCount(1);
  await cancelButton(page).click();

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
  await watchStatus(page);
  // The first result above was a normal run; make another one and let it finish, with the clock running as usual.
  await fillAndHold(page, 'pattern', 'a');
  await expect(output(page).locator('table.output-table')).toBeVisible();
  await expect(output(page)).toHaveAttribute('aria-busy', 'false');
  await expect(cue(page)).toHaveCount(0);
  await expect(outputBody(page)).not.toHaveClass(/output-stale/);
  await expect(status(page)).toHaveText('');
  expect(await statusLog(page)).toEqual([]);
});

test('regex-tester: a first run with no earlier result shows the cue with no previous-result line and nothing dimmed', async ({
  page,
}) => {
  await openTool(page, '/tools/regex-tester');
  await setHold(page, true);
  await fillAndHold(page, 'input', 'aaa');
  await pauseClock(page);
  await fillAndHold(page, 'pattern', 'a+');
  await page.clock.runFor(140);
  await expect(output(page)).toHaveAttribute('aria-busy', 'true');
  await flushRender(page);
  await page.clock.runFor(1100);
  await expect(cue(page)).toHaveText(new RegExp(`Working${ELLIPSIS} \\d+ s \\(stops at 1\\.5 s\\)`));
  await expect(cue(page)).not.toContainText('previous result');
  await expect(outputBody(page)).not.toHaveClass(/output-stale/);
  await expect(status(page)).toHaveText(START_SENTENCE);
});

test('regex-tester: after Cancel on a page with no Run button, focus moves to the Input title', async ({ page }) => {
  await openWithFirstResult(page);
  await startHeldRun(page);
  await page.clock.runFor(1100);
  await expect(cue(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0);

  await cancelButton(page).click();
  await expect(output(page)).toHaveAttribute('aria-busy', 'false');
  const title = page.locator('section[aria-label="Input and options"] .panel-title');
  await expect(title).toHaveText('Input');
  await expect(title).toBeFocused();
  // Exactly one Cancel button existed, and none is left.
  await expect(cancelButton(page)).toHaveCount(0);
});

test('bcrypt: a page with no exported limit shows elapsed time only, and after Cancel focus moves to the Run button', async ({
  page,
}) => {
  await openTool(page, '/tools/bcrypt');
  await fillAndHold(page, 'password', 'correct horse');
  await fillAndHold(page, 'cost', '4');
  const run = page.getByRole('button', { name: 'Run', exact: true });
  await run.click();
  await expect(output(page).locator('.output-block').first()).toBeVisible({ timeout: 30_000 });
  await expect(output(page)).toHaveAttribute('aria-busy', 'false');

  // A cost of 12 or less is hashed on the page's own thread in a few milliseconds; a higher one runs in a background
  // worker, which is the run this test holds.
  await fillAndHold(page, 'cost', '13');
  await setHold(page, true);
  await pauseClock(page);
  await run.click();
  await expect(output(page)).toHaveAttribute('aria-busy', 'true');
  await flushRender(page);
  // The Run label code is unchanged: it reads Working with the single ellipsis while a run is going.
  await expect(page.getByRole('button', { name: `Working${ELLIPSIS}`, exact: true })).toBeDisabled();
  await page.clock.runFor(1100);
  await expect(cue(page)).toHaveText(
    new RegExp(`^Working${ELLIPSIS} \\d+ s Press Cancel to stop it\\. Showing the previous`),
  );
  await expect(cue(page)).not.toContainText('stops');
  await expect(status(page)).toHaveText('Working.');

  await expect(cancelButton(page)).toHaveCount(1);
  await cancelButton(page).click();
  await expect(output(page)).toHaveAttribute('aria-busy', 'false');
  await expect(run).toBeFocused();
  await expect(status(page)).toHaveText('Cancelled.');
});

test('regex-tester: a run the helper ends at its own limit leaves no timer and says Finished. once after the start message', async ({
  page,
}) => {
  await openWithFirstResult(page);
  await watchStatus(page);
  await startCountingTimers(page);
  await startHeldRun(page);
  await page.clock.runFor(1100);
  await expect(cue(page)).toBeVisible();
  // While the cue shows, the counter sees its timers (so a leak could be seen).
  expect((await liveTimers(page)).length).toBeGreaterThan(0);

  // The helper's own 1.5 second limit ends the run.
  await page.clock.runFor(600);
  await expect(output(page)).toHaveAttribute('aria-busy', 'false');
  await expect(cue(page)).toHaveCount(0);
  await expect(outputBody(page)).not.toHaveClass(/output-stale/);
  await expect(output(page).locator('.issue-list')).toContainText('Stopped after 1.5 seconds');
  await expect(status(page)).toHaveText('Finished.');
  await expect.poll(() => liveTimers(page)).toEqual([]);
  expect(await statusLog(page)).toEqual([START_SENTENCE, 'Finished.']);
});

test('regex-tester: a background task that cannot run ends the run with no timer left and Finished.', async ({
  page,
}) => {
  await openWithFirstResult(page);
  await watchStatus(page);
  await startCountingTimers(page);
  await startHeldRun(page);
  await page.clock.runFor(1100);
  await expect(cue(page)).toBeVisible();

  await page.evaluate(() => window.__failHeld?.());
  await expect(output(page)).toHaveAttribute('aria-busy', 'false');
  await expect(cue(page)).toHaveCount(0);
  await expect(status(page)).toHaveText('Finished.');
  await expect.poll(() => liveTimers(page)).toEqual([]);
  expect(await statusLog(page)).toEqual([START_SENTENCE, 'Finished.']);
});

test('regex-tester: Cancel leaves no timer and the status changed exactly twice, the start message then Cancelled.', async ({
  page,
}) => {
  await openWithFirstResult(page);
  await watchStatus(page);
  await startCountingTimers(page);
  await startHeldRun(page);
  await page.clock.runFor(1100);
  await expect(cue(page)).toBeVisible();
  expect((await liveTimers(page)).length).toBeGreaterThan(0);

  await cancelButton(page).click();
  await expect(cue(page)).toHaveCount(0);
  await expect.poll(() => liveTimers(page)).toEqual([]);
  // Moving the clock a long way finds nothing left to fire that changes the page.
  await page.clock.runFor(60_000);
  await expect(cue(page)).toHaveCount(0);
  expect(await statusLog(page)).toEqual([START_SENTENCE, 'Cancelled.']);
});

test('regex-tester: Reset during a shown cue leaves no timer, clears the result and says Cancelled.', async ({
  page,
}) => {
  await openWithFirstResult(page);
  await watchStatus(page);
  await startCountingTimers(page);
  await startHeldRun(page);
  await page.clock.runFor(1100);
  await expect(cue(page)).toBeVisible();

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(output(page)).toHaveAttribute('aria-busy', 'false');
  await expect(cue(page)).toHaveCount(0);
  await expect(outputBody(page)).not.toHaveClass(/output-stale/);
  await expect(status(page)).toHaveText('Cancelled.');
  // Reset puts the fields back, which starts the page's own 140 ms typing delay; let it run out, then nothing is left.
  await page.clock.runFor(200);
  await expect.poll(() => liveTimers(page)).toEqual([]);
  expect(await statusLog(page)).toEqual([START_SENTENCE, 'Cancelled.']);
});

test('regex-tester: an edit during a shown cue leaves no timer, and the run the edit starts is an ordinary one', async ({
  page,
}) => {
  await openWithFirstResult(page);
  await watchStatus(page);
  await startCountingTimers(page);
  await startHeldRun(page);
  await page.clock.runFor(1100);
  await expect(cue(page)).toBeVisible();

  // Let the run the edit starts be a real one, so it finishes by itself.
  await setHold(page, false);
  await nudge(page, 'input');
  await expect(cue(page)).toHaveCount(0);
  await page.clock.runFor(200);
  await expect(output(page)).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
  await expect(output(page).locator('table.output-table')).toBeVisible();
  await expect(cue(page)).toHaveCount(0);
  await expect(status(page)).toHaveText('Cancelled.');
  await expect.poll(() => liveTimers(page)).toEqual([]);
  expect(await statusLog(page)).toEqual([START_SENTENCE, 'Cancelled.']);
});

test('chart-maker: a run that supersedes a running one restarts the cue from zero, says nothing at the switch and ends with one message', async ({
  page,
}) => {
  await openTool(page, '/tools/chart-maker');
  await page.getByRole('radio', { name: 'PNG' }).check();
  await fillAndHold(page, 'data', 'Month,Sign-ups\nJan,12\nFeb,19\nMar,3');
  await expect(output(page).locator('img').first()).toBeVisible({ timeout: 20_000 });
  await expect(output(page)).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
  await watchStatus(page);
  await startCountingTimers(page);

  // The first run is held at its PNG step and has been going for 3.1 seconds.
  await page.evaluate(() => {
    window.__holdBlob = true;
  });
  await pauseClock(page);
  await nudge(page, 'title');
  await page.clock.runFor(140);
  await expect(output(page)).toHaveAttribute('aria-busy', 'true');
  await flushRender(page);
  await page.clock.runFor(3100);
  await expect(cue(page)).toHaveText(new RegExp(`^Working${ELLIPSIS} 3 s Showing the previous result`));
  // The page is not cancellable: there is no Cancel hint and no Cancel button.
  await expect(cue(page)).not.toContainText('Cancel');
  await expect(cancelButton(page)).toHaveCount(0);
  expect(await statusLog(page)).toEqual(['Working.']);

  // A second edit starts a second run while the first is still running: the busy state never drops.
  await nudge(page, 'title');
  await page.clock.runFor(140);
  await expect(cue(page)).toHaveCount(0);
  await expect(output(page)).toHaveAttribute('aria-busy', 'true');
  await expect(outputBody(page)).not.toHaveClass(/output-stale/);
  await flushRender(page);
  // Nothing was said at the switch.
  expect(await statusLog(page)).toEqual(['Working.']);
  await page.clock.runFor(500);
  await expect(cue(page)).toHaveCount(0);
  // 1.1 seconds into the second run the count is its own, not the 4 seconds since the first run began.
  await page.clock.runFor(600);
  await expect(cue(page)).toHaveText(new RegExp(`^Working${ELLIPSIS} 1 s Showing the previous result`));

  // A third edit lets the work finish: one end message, and no timer is left.
  await page.evaluate(() => {
    window.__holdBlob = false;
  });
  await nudge(page, 'title');
  await page.clock.runFor(140);
  await expect(output(page)).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
  await expect(cue(page)).toHaveCount(0);
  await expect(status(page)).toHaveText('Finished.');
  await expect.poll(() => liveTimers(page)).toEqual([]);
  expect(await statusLog(page)).toEqual(['Working.', 'Finished.']);
});

test('regex-tester: leaving the page during a shown cue starts the next document with no cue, no status text and no timer', async ({
  page,
}) => {
  await openWithFirstResult(page);
  await startCountingTimers(page);
  await startHeldRun(page);
  await page.clock.runFor(1100);
  await expect(cue(page)).toBeVisible();
  expect((await liveTimers(page)).length).toBeGreaterThan(0);

  // Every in-site link loads a new document; going there while a run is shown must leave nothing behind.
  await page.clock.resume();
  await page.goto(rel('/tools/glob-tester'));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(cue(page)).toHaveCount(0);
  await expect(status(page)).toHaveText('');
  await expect(outputBody(page)).not.toHaveClass(/output-stale/);
  expect(await liveTimers(page)).toEqual([]);
});

test('glob-tester: a held run passes its limit while the helper waits, says so, then ends and says Finished.', async ({
  page,
}) => {
  await openTool(page, '/tools/glob-tester');
  await fillAndHold(page, 'patterns', '*.js');
  await fillAndHold(page, 'paths', 'a.js\nb.txt');
  await expect(output(page).locator('.output-block').first()).toBeVisible({ timeout: 20_000 });
  await expect(output(page)).toHaveAttribute('aria-busy', 'false');
  await watchStatus(page);
  await startCountingTimers(page);

  await startHeldRun(page, 'paths');
  await page.clock.runFor(1100);
  await expect(cue(page)).toHaveText(new RegExp(`Working${ELLIPSIS} \\d+ s \\(stops at 5 s\\)`));
  await expect(status(page)).toHaveText('Working. This stops by itself after 5 seconds.');

  // Past the 5 second limit the helper is still waiting for the worker (its start limit is 10 seconds).
  await page.clock.runFor(4500);
  await expect(cue(page)).toHaveText(new RegExp(`Working${ELLIPSIS} \\d+ s, past the 5 s limit, stopping`));
  await expect(output(page)).toHaveAttribute('aria-busy', 'true');
  await flushRender(page);

  // The helper's own start limit then ends the run.
  await page.clock.runFor(5000);
  await expect(output(page)).toHaveAttribute('aria-busy', 'false');
  await expect(cue(page)).toHaveCount(0);
  await expect(status(page)).toHaveText('Finished.');
  await expect.poll(() => liveTimers(page)).toEqual([]);
  expect(await statusLog(page)).toEqual(['Working. This stops by itself after 5 seconds.', 'Finished.']);
});

test.describe('reduced motion', () => {
  test('under reduce the stale container has no running transition, and with no preference it has one', async ({
    page,
  }) => {
    const duration = async () =>
      await outputBody(page).evaluate((el) =>
        getComputedStyle(el)
          .transitionDuration.split(',')
          .map((d) => d.trim()),
      );

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openWithFirstResult(page);
    await startHeldRun(page);
    await page.clock.runFor(1100);
    await expect(outputBody(page)).toHaveClass(/output-stale/);
    expect((await duration()).every((d) => d === '0s')).toBe(true);

    // The positive control: the same container does transition when the visitor has no preference.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect((await duration()).some((d) => d !== '0s')).toBe(true);
  });
});

interface ContrastRow {
  selector: string;
  missing: boolean;
  dimmed: number;
  undimmed: number;
  opacity: number;
}

/**
 * Reads the real elements: the first match of each selector inside the stale container and the cue itself. For each it
 * takes the computed text colour, the first non-transparent background at or above it (inside the container, or the
 * panel behind it), and the container's computed opacity, and returns the contrast the visitor sees (blended) and the
 * contrast with no dimming. Contrast is the WCAG relative luminance ratio. Runs in the page.
 */
async function measureContrast(page: Page, selectors: string[]): Promise<ContrastRow[]> {
  return await page.evaluate((sels: string[]) => {
    type Colour = [number, number, number, number];
    const parse = (value: string): Colour => {
      const m = /rgba?\(([^)]+)\)/.exec(value);
      if (!m || !m[1]) throw new Error(`unreadable colour ${value}`);
      const parts = m[1]
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts.length > 3 ? (parts[3] ?? 1) : 1];
    };
    const mix = (fg: Colour, bg: [number, number, number]): [number, number, number] => [
      fg[3] * fg[0] + (1 - fg[3]) * bg[0],
      fg[3] * fg[1] + (1 - fg[3]) * bg[1],
      fg[3] * fg[2] + (1 - fg[3]) * bg[2],
    ];
    const lum = (c: [number, number, number]): number => {
      const lin = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0);
    };
    const ratio = (a: [number, number, number], b: [number, number, number]): number => {
      const la = lum(a);
      const lb = lum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    const backdrop = (start: Element | null): [number, number, number] => {
      const layers: Colour[] = [];
      for (let e = start; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c[3] > 0) {
          layers.push(c);
          if (c[3] >= 1) break;
        }
      }
      let out: [number, number, number] = [255, 255, 255];
      for (let i = layers.length - 1; i >= 0; i--) out = mix(layers[i] as Colour, out);
      return out;
    };

    const container = document.querySelector('section[aria-label="Output"] > .panel-body');
    if (!container) throw new Error('no output body');
    const opacity = parseFloat(getComputedStyle(container).opacity);
    const behind = backdrop(container.parentElement);

    return sels.map((selector) => {
      const isCue = selector === '.working-cue';
      const el = isCue
        ? document.querySelector('section[aria-label="Output"] > .working-cue')
        : container.querySelector(selector);
      if (!el) return { selector, missing: true, dimmed: 0, undimmed: 0, opacity };
      const text = parse(getComputedStyle(el).color);
      if (isCue) {
        const bg = backdrop(el);
        const r = ratio(mix(text, bg), bg);
        return { selector, missing: false, dimmed: r, undimmed: r, opacity: 1 };
      }
      let inside: Colour | null = null;
      for (let e: Element | null = el; e && container.contains(e); e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c[3] > 0) {
          inside = c;
          break;
        }
      }
      if (inside && inside[3] < 1) throw new Error(`a translucent background inside the stale container: ${selector}`);
      const g: [number, number, number] | null = inside ? [inside[0], inside[1], inside[2]] : null;
      const undimmedBg = g ?? behind;
      const undimmed = ratio(mix(text, undimmedBg), undimmedBg);
      let seenText: [number, number, number];
      let seenBg: [number, number, number];
      if (g) {
        const pixel = mix(text, g);
        seenText = mix([pixel[0], pixel[1], pixel[2], opacity], behind);
        seenBg = mix([g[0], g[1], g[2], opacity], behind);
      } else {
        seenText = mix([text[0], text[1], text[2], text[3] * opacity], behind);
        seenBg = behind;
      }
      return { selector, missing: false, dimmed: ratio(seenText, seenBg), undimmed, opacity };
    });
  }, selectors);
}

/** One case of the contrast proof: how to get a result on screen, and the elements that result has. */
interface ContrastCase {
  name: string;
  prepare: (page: Page) => Promise<void>;
  selectors: string[];
}

const CONTRAST_CASES: ContrastCase[] = [
  {
    name: 'matches table',
    prepare: async () => {},
    selectors: ['th', 'td', '.output-label', '.stats span', '.stats strong'],
  },
  {
    name: 'cancelled note',
    prepare: async (page) => {
      await startHeldRun(page);
      await page.clock.runFor(1100);
      await cancelButton(page).click();
      await expect(output(page).locator('.note-warn')).toBeVisible();
    },
    selectors: ['.note-warn'],
  },
  {
    name: 'replace result',
    prepare: async (page) => {
      await page.getByRole('radio', { name: 'Replace' }).check();
      await fillAndHold(page, 'replacement', 'X');
      await finishRealRun(page);
      await expect(output(page).locator('pre.output')).toBeVisible();
    },
    selectors: ['pre.output', '.output-label', '.stats span'],
  },
  {
    name: 'no match note',
    prepare: async (page) => {
      await page.getByRole('radio', { name: 'Test' }).check();
      await fillAndHold(page, 'pattern', 'zzz');
      await finishRealRun(page);
      await expect(output(page).locator('.note-info')).toBeVisible();
    },
    selectors: ['.note-info', '.stats span'],
  },
  {
    name: 'input problem',
    prepare: async (page) => {
      await fillAndHold(page, 'pattern', '(');
      await finishRealRun(page);
      await expect(output(page).locator('.issue-list .issue')).toBeVisible();
    },
    selectors: ['.issue-list .issue'],
  },
];

for (const theme of ['dark', 'light'] as const) {
  test(`regex-tester: dimmed text keeps at least 4.5 to 1 in the ${theme} theme, measured on the real elements`, async ({
    page,
  }) => {
    if (theme === 'light') {
      await page.addInitScript(() => {
        window.localStorage.setItem('fodt-theme', 'light');
      });
    }
    await openWithFirstResult(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await pauseClock(page);

    const lines: string[] = [];
    const tooLow: string[] = [];
    for (const contrastCase of CONTRAST_CASES) {
      await contrastCase.prepare(page);
      // A held run over the result the case left on screen.
      await startHeldRun(page, 'input');
      await page.clock.runFor(1100);
      await expect(cue(page)).toBeVisible();
      await expect(outputBody(page)).toHaveClass(/output-stale/);
      // The opacity change is a short transition in real time; wait for its end value before reading.
      await expect
        .poll(async () => outputBody(page).evaluate((el) => Number(getComputedStyle(el).opacity)))
        .toBeCloseTo(DIM[theme], 3);

      const rows = await measureContrast(page, [...contrastCase.selectors, '.working-cue']);
      for (const row of rows) {
        expect(row.missing, `${contrastCase.name}: ${row.selector} is on screen`).toBe(false);
        lines.push(
          `${theme} | ${contrastCase.name} | ${row.selector} | blended ${row.dimmed.toFixed(2)} | undimmed ${row.undimmed.toFixed(2)} | opacity ${row.opacity}`,
        );
        if (row.dimmed < MIN_CONTRAST) {
          tooLow.push(`${contrastCase.name}: ${row.selector} reads ${row.dimmed.toFixed(2)}`);
        }
      }
      // End the held run so the next case starts from a finished page.
      await cancelButton(page).click();
      await expect(output(page)).toHaveAttribute('aria-busy', 'false');
      await setHold(page, false);
    }
    // The measured values, for the record (printed with the test output).
    console.log(`CONTRAST\n${lines.join('\n')}`);
    expect(tooLow, `text under ${MIN_CONTRAST}:1 once dimmed in the ${theme} theme`).toEqual([]);
  });
}
