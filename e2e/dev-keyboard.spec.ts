import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Behavioural proof of the Keyboard Event Viewer (phase 16, DEV-04, D-206, D-207, D-210 d and research DEV-04): the page
 * puts one capture box, with its history table and a Clear history button, at the top of the Output panel by its own
 * code (no shared shell change), and the table shows exactly what the browser reported for each key and composition
 * event. Read in four browser projects: chromium, firefox, webkit and mobile-chrome (the Pixel 7 emulation).
 *
 * The oracle for "exactly as the browser reports" is the browser itself (D-207): each test attaches its own listener to
 * the same capture box, after the page's own, and copies every field of every event it sees to
 * window.__FODT_KEY_REFERENCE__; every displayed cell is compared with that copy, and with the literal values the
 * engines were recorded giving for Playwright key presses (press a gives keydown a KeyA 65 with location 0, keypress
 * with charCode 97, keyup). The expected cells are built here from the reference copy, never by the page's own
 * formatter.
 *
 * What an engine cannot do is skipped there with its reason, never failed. Keys the browser or the operating system
 * keep for themselves cannot be tested at all, because Playwright injects events into the page: those are documentation
 * only (limits of the tool).
 *
 * A spec of its own, with its own helpers copied in shape from e2e/security-workers.spec.ts, e2e/security-secrets.spec.ts
 * and e2e/vision-camera.spec.ts, because a shared test helper would make every importing spec run whole for every tool.
 * The reference record (window.__FODT_KEY_REFERENCE__) is created here and is absent on a real visit.
 */
const rel = (path: string) => path.replace(/^\//, '');

const PAGE = '/tools/keyboard-event-viewer';

/** What the test's own listener copied from one event of the capture box. */
interface ReferenceEvent {
  type: string;
  key: string;
  code: string;
  keyCode: number;
  which: number;
  charCode: number;
  location: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
  data: string;
}

declare global {
  interface Window {
    /** Every event the capture box received, copied by the listener installReference adds. */
    __FODT_KEY_REFERENCE__?: ReferenceEvent[];
  }
}

/** The location names of the UI Events specification (DOM_KEY_LOCATION_*), written out from the specification. */
const LOCATION_WORDS = ['standard', 'left', 'right', 'numpad'];

/** The capture box, found by its accessible name. */
function captureBox(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Key capture box' });
}

/**
 * Adds the test's own listener to the capture box (after the page's own) that copies each event's fields. A second call
 * on the same page starts a fresh record.
 */
async function installReference(page: Page): Promise<void> {
  await page.evaluate(() => {
    const box = document.querySelector('textarea[aria-label="Key capture box"]');
    if (!box) throw new Error('the capture box is not on the page');
    window.__FODT_KEY_REFERENCE__ = [];
    for (const type of ['keydown', 'keypress', 'keyup', 'compositionstart', 'compositionupdate', 'compositionend']) {
      box.addEventListener(type, (event) => {
        const e = event as KeyboardEvent & CompositionEvent;
        window.__FODT_KEY_REFERENCE__!.push({
          type: e.type,
          key: e.key ?? '',
          code: e.code ?? '',
          keyCode: e.keyCode ?? 0,
          which: e.which ?? 0,
          charCode: e.charCode ?? 0,
          location: e.location ?? 0,
          ctrlKey: e.ctrlKey ?? false,
          shiftKey: e.shiftKey ?? false,
          altKey: e.altKey ?? false,
          metaKey: e.metaKey ?? false,
          repeat: e.repeat ?? false,
          isComposing: e.isComposing ?? false,
          defaultPrevented: e.defaultPrevented,
          data: e.data ?? '',
        });
      });
    }
  });
}

/** The events the test's own listener has copied so far. */
async function reference(page: Page): Promise<ReferenceEvent[]> {
  return page.evaluate(() => window.__FODT_KEY_REFERENCE__ ?? []);
}

/** The cells of every row of the history table, the empty-state row included. */
async function historyRows(page: Page): Promise<string[][]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('table[role="log"] tbody tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent ?? ''),
    ),
  );
}

/** The cells the page must show for one reference event, written from the specification's value names. */
function expectedCells(e: ReferenceEvent): string[] {
  const held = [e.ctrlKey ? 'Ctrl' : '', e.shiftKey ? 'Shift' : '', e.altKey ? 'Alt' : '', e.metaKey ? 'Meta' : '']
    .filter((name) => name !== '')
    .join('+');
  return [
    e.type,
    e.key,
    e.code,
    String(e.keyCode),
    String(e.which),
    e.type === 'keypress' ? String(e.charCode) : '',
    `${e.location} (${LOCATION_WORDS[e.location] ?? 'unknown'})`,
    held === '' ? 'none' : held,
    String(e.repeat),
    String(e.isComposing),
    String(e.defaultPrevented),
    e.data,
  ];
}

/** Opens the page and gives the capture box focus with the test's own listener in place. */
async function openViewer(page: Page): Promise<Locator> {
  await page.goto(rel(PAGE));
  const box = captureBox(page);
  await expect(box).toBeVisible();
  await installReference(page);
  await box.focus();
  await expect(box).toBeFocused();
  return box;
}

test('keyboard-event-viewer: a key pressed in the capture box shows exactly what the browser reported for it', async ({
  page,
}) => {
  await openViewer(page);

  for (const key of ['a', 'Enter', 'Space', 'ShiftLeft', 'ShiftRight', 'F5']) {
    await page.keyboard.press(key);
  }

  const events = await reference(page);
  // a, Enter and Space give a keydown, a keypress and a keyup; the modifiers and F5 give no keypress.
  expect(events.map((e) => e.type)).toEqual([
    'keydown',
    'keypress',
    'keyup',
    'keydown',
    'keypress',
    'keyup',
    'keydown',
    'keypress',
    'keyup',
    'keydown',
    'keyup',
    'keydown',
    'keyup',
    'keydown',
    'keyup',
  ]);

  // Every displayed row, in the order the browser dispatched the events, equals what the browser's own event said.
  await expect.poll(async () => (await historyRows(page)).length).toBe(events.length);
  expect(await historyRows(page)).toEqual(events.map(expectedCells));

  // The literal values the engines were recorded giving.
  const a = events.filter((e) => e.key === 'a');
  expect(a.map((e) => e.type)).toEqual(['keydown', 'keypress', 'keyup']);
  expect(a[0]).toMatchObject({ code: 'KeyA', keyCode: 65, location: 0 });
  expect(a[1]).toMatchObject({ code: 'KeyA', charCode: 97 });
  const enter = events.filter((e) => e.key === 'Enter');
  expect(enter.find((e) => e.type === 'keypress')).toMatchObject({ code: 'Enter', charCode: 13 });
  const space = events.filter((e) => e.code === 'Space');
  expect(space.map((e) => e.key)).toEqual([' ', ' ', ' ']);
  expect(space[0]).toMatchObject({ type: 'keydown', keyCode: 32 });
  expect(events.find((e) => e.code === 'ShiftLeft')).toMatchObject({ key: 'Shift', location: 1 });
  expect(events.find((e) => e.code === 'ShiftRight')).toMatchObject({ key: 'Shift', location: 2 });
  expect(events.filter((e) => e.code === 'F5').map((e) => e.type)).toEqual(['keydown', 'keyup']);
});
