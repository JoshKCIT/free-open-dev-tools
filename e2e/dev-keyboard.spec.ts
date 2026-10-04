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
    /** The capture box as it was when the survival test looked at it, to tell a kept box from a rebuilt one. */
    __FODT_KEY_BOX__?: Element | null;
    /** How many key downs reached the document, counted by the test's own listener. */
    __FODT_DOCUMENT_KEYS__?: number;
    /** What the capture-phase listener of the test saw, before the capture box's own listeners: key and defaultPrevented. */
    __FODT_KEY_BEFORE__?: { key: string; defaultPrevented: boolean }[];
    /** The capture box and the history table body as they were before the visitor left the tool. */
    __FODT_KEY_OLD__?: { box: HTMLTextAreaElement; body: HTMLElement };
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
    [...document.querySelectorAll('[role="log"] table tbody tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent ?? ''),
    ),
  );
}

/**
 * The cells the page must show for one reference event, written from the specification's value names. A composition event
 * has no isComposing property of its own, so the page shows true from compositionstart to compositionupdate and false at
 * compositionend (the session is over when the end is announced); every other value is the browser's own.
 */
function expectedCells(e: ReferenceEvent): string[] {
  const composing = e.type.startsWith('composition') ? e.type !== 'compositionend' : e.isComposing;
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
    String(composing),
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

/** What the defaultPrevented cell says for a key whose default the browser left alone and this page then prevented. */
const PREVENTED_BY_PAGE = 'false (then prevented by this page)';

/** The display name of a checkbox option of the page. */
function option(page: Page, name: string | RegExp): Locator {
  return page.getByRole('checkbox', { name, exact: typeof name === 'string' });
}

/** The button that empties the history and the box. */
function clearButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Clear history', exact: true });
}

/** The code point escape the page writes: a backslash, a lowercase u, braces and the code point in upper case hex. */
function escaped(point: number): string {
  return `${String.fromCodePoint(92)}u{${point.toString(16).toUpperCase()}}`;
}

test('keyboard-event-viewer: modifier chords, left and right modifiers and held keys report their modifiers, location and repeat', async ({
  page,
}) => {
  await openViewer(page);

  await page.keyboard.press('Control+Shift+a');
  await page.keyboard.press('MetaLeft');
  await page.keyboard.press('MetaRight');
  // Held key: three key downs without a key up between them, then one key up.
  await page.keyboard.down('b');
  await page.keyboard.down('b');
  await page.keyboard.down('b');
  await page.keyboard.up('b');

  const events = await reference(page);
  await expect.poll(async () => (await historyRows(page)).length).toBe(events.length);
  expect(await historyRows(page)).toEqual(events.map(expectedCells));

  // Control+Shift+a: the modifier flags are on the key and on the modifier key pressed after the first.
  const control = events.find((e) => e.type === 'keydown' && e.key === 'Control');
  const shift = events.find((e) => e.type === 'keydown' && e.key === 'Shift');
  const letter = events.find((e) => e.type === 'keydown' && e.code === 'KeyA');
  expect(control).toMatchObject({ ctrlKey: true, shiftKey: false, location: 1 });
  expect(shift).toMatchObject({ ctrlKey: true, shiftKey: true });
  expect(letter).toMatchObject({ ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
  const rows = await historyRows(page);
  const letterRow = rows[events.indexOf(letter!)];
  expect(letterRow?.[7]).toBe('Ctrl+Shift');

  // The Meta keys: key code 91 on the left, 92 on the right (Playwright's own key table for the Windows key).
  expect(events.find((e) => e.type === 'keydown' && e.code === 'MetaLeft')).toMatchObject({
    key: 'Meta',
    keyCode: 91,
    location: 1,
  });
  expect(events.find((e) => e.type === 'keydown' && e.code === 'MetaRight')).toMatchObject({
    key: 'Meta',
    keyCode: 92,
    location: 2,
  });

  // A held key: repeat is false on the first key down and true on the second and third, and there is one key up. The
  // three key downs are three separate rows although key and code are identical (adjacent rows are never merged).
  const held = events.filter((e) => e.code === 'KeyB');
  expect(held.filter((e) => e.type === 'keydown').map((e) => e.repeat)).toEqual([false, true, true]);
  expect(held.filter((e) => e.type === 'keyup')).toHaveLength(1);
  const heldRows = rows.filter((cells) => cells[2] === 'KeyB' && cells[0] === 'keydown');
  expect(heldRows.map((cells) => cells[8])).toEqual(['false', 'true', 'true']);
});

test('keyboard-event-viewer: numpad keys report the numpad location on key down in every engine', async ({ page }) => {
  await openViewer(page);
  await page.keyboard.press('Numpad1');

  const events = await reference(page);
  await expect.poll(async () => (await historyRows(page)).length).toBe(events.length);
  expect(await historyRows(page)).toEqual(events.map(expectedCells));

  const down = events.find((e) => e.type === 'keydown');
  const up = events.find((e) => e.type === 'keyup');
  // With NumLock off the key reports End, not 1; the location of a key down is the numpad in all four engines.
  expect(down).toMatchObject({ code: 'Numpad1', key: 'End', location: 3 });
  for (const e of events.filter((x) => x.type === 'keypress')) expect(e.location).toBe(3);
  // The location of the injected key up differs between engines (research A1: 1 in chromium and mobile-chrome, 3 in
  // firefox and webkit; real keyboards report 3), so it is not tabled here: the page must show exactly what the test's own
  // listener saw for that event, whatever the engine says.
  expect(up).toBeDefined();
  const rows = await historyRows(page);
  expect(rows[events.indexOf(up!)]?.[6]).toBe(`${up!.location} (${LOCATION_WORDS[up!.location] ?? 'unknown'})`);
});

test('keyboard-event-viewer: an input method composition is shown with its composition events and isComposing', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'the pinned WebKit gives no composition events for scripted input');
  await openViewer(page);
  const japanese = String.fromCodePoint(0x65e5, 0x672c);
  const partial = String.fromCodePoint(0x306b, 0x307b);

  if (browserName === 'chromium') {
    // Chromium and the Pixel 7 emulation (the same engine) through a CDP input method session.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'k', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      windowsVirtualKeyCode: 229,
      key: 'Process',
      code: 'KeyK',
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: 229,
      key: 'Process',
      code: 'KeyK',
    });
    await cdp.send('Input.imeSetComposition', { text: partial, selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.insertText', { text: japanese });
  } else {
    // Firefox fires the composition events for inserted text.
    await page.keyboard.insertText(japanese);
  }

  await expect
    .poll(async () => (await reference(page)).some((e) => e.type === 'compositionend'), { timeout: 5000 })
    .toBe(true);
  const events = await reference(page);
  await expect.poll(async () => (await historyRows(page)).length).toBe(events.length);
  expect(await historyRows(page)).toEqual(events.map(expectedCells));

  const composition = events.filter((e) => e.type.startsWith('composition'));
  expect(composition[0]?.type).toBe('compositionstart');
  expect(composition.some((e) => e.type === 'compositionupdate')).toBe(true);
  expect(composition[composition.length - 1]).toMatchObject({ type: 'compositionend', data: japanese });

  const rows = await historyRows(page);
  const endIndex = events.findIndex((e) => e.type === 'compositionend');
  expect(rows[endIndex]?.[0]).toBe('compositionend');
  expect(rows[endIndex]?.[11]).toBe(japanese);
  expect(rows.some((cells) => cells[0] === 'compositionstart' && cells[9] === 'true')).toBe(true);

  if (browserName === 'chromium') {
    // The key down of a key that belongs to the input method reports Process, the legacy value 229 and isComposing.
    const process = events.find((e) => e.type === 'keydown' && e.key === 'Process');
    expect(process).toMatchObject({ keyCode: 229, isComposing: true });
    expect(rows[events.indexOf(process!)]?.slice(0, 5)).toEqual(['keydown', 'Process', 'KeyK', '229', '229']);
    expect(rows[events.indexOf(process!)]?.[9]).toBe('true');
    expect(rows.some((cells) => cells[0] === 'compositionupdate' && cells[11] === partial)).toBe(true);
  }
});

test('keyboard-event-viewer: composition text with control and bidirectional characters is shown escaped', async ({
  page,
}) => {
  const box = await openViewer(page);
  // Built at run time: the file-writing tool can turn written escapes into the raw characters.
  const points = { rlo: 0x202e, nul: 0, esc: 0x1b, isolate: 0x2066, lrm: 0x200e };
  await box.evaluate((element, p) => {
    const make = (...codes: number[]) => String.fromCodePoint(...codes);
    element.dispatchEvent(
      new CompositionEvent('compositionupdate', {
        data: make(p.rlo) + 'x' + make(p.nul) + make(p.isolate) + make(p.lrm),
        bubbles: true,
      }),
    );
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: make(p.rlo) + 'k' + make(p.esc),
        code: 'KeyK',
        isComposing: true,
        bubbles: true,
      }),
    );
    // Markup in a key name is text, never markup.
    element.dispatchEvent(new KeyboardEvent('keydown', { key: '<b>k</b>&amp;', code: 'KeyM', bubbles: true }));
  }, points);

  await expect.poll(async () => (await historyRows(page)).length).toBe(3);
  const rows = await historyRows(page);
  expect(rows[0]?.[0]).toBe('compositionupdate');
  expect(rows[0]?.[11]).toBe(`${escaped(0x202e)}x${escaped(0)}${escaped(0x2066)}${escaped(0x200e)}`);
  expect(rows[1]?.[0]).toBe('keydown');
  expect(rows[1]?.[1]).toBe(`${escaped(0x202e)}k${escaped(0x1b)}`);
  expect(rows[1]?.[9]).toBe('true');
  expect(rows[2]?.[1]).toBe('<b>k</b>&amp;');
  expect(await page.locator('[role="log"] table b').count()).toBe(0);
  // No raw direction-changing or control character is left in the table.
  const shown = rows.flat().join('');
  for (const point of Object.values(points)) expect(shown.includes(String.fromCodePoint(point))).toBe(false);
});

test('keyboard-event-viewer: Tab and Shift+Tab leave the capture box even when other keys are prevented', async ({
  page,
}) => {
  const box = await openViewer(page);
  await option(page, /^Prevent the browser default/).check();
  // The option takes effect on the page's next run: press a until the row says its default was prevented.
  await expect(async () => {
    await clearButton(page).click();
    await box.focus();
    await page.keyboard.press('a');
    await expect
      .poll(async () => (await historyRows(page)).find((cells) => cells[0] === 'keydown')?.[10], { timeout: 1000 })
      .toBe(PREVENTED_BY_PAGE);
  }).toPass();
  await clearButton(page).click();
  await installReference(page);
  // A listener on the document in the capture phase runs before the capture box's own listeners, so it sees the value
  // the browser reported before this page did anything.
  await page.evaluate(() => {
    window.__FODT_KEY_BEFORE__ = [];
    document.addEventListener(
      'keydown',
      (event) => window.__FODT_KEY_BEFORE__!.push({ key: event.key, defaultPrevented: event.defaultPrevented }),
      true,
    );
  });
  await box.focus();

  await page.keyboard.press('a');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  // Focus left the box.
  await expect(box).not.toBeFocused();
  await expect(clearButton(page)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(box).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  // And again: focus is now before the capture area, in the input panel.
  await expect(box).not.toBeFocused();
  const insideArea = await page.evaluate(() => !!document.activeElement?.closest('#fodt-key-capture'));
  expect(insideArea).toBe(false);

  const events = await reference(page);
  const down = (key: string) => events.find((e) => e.type === 'keydown' && e.key === key);
  // The test's own listener comes after the page's, so it sees the default as prevented by the page.
  expect(down('a')?.defaultPrevented).toBe(true);
  // A prevented key down sends no key press (the legacy event never follows a prevented key down).
  expect(events.filter((e) => e.type === 'keypress' && e.key === 'a')).toEqual([]);
  expect(down('Escape')?.defaultPrevented).toBe(false);
  expect(down('Tab')?.defaultPrevented).toBe(false);
  expect(events.filter((e) => e.key === 'Tab' && e.type === 'keydown').every((e) => !e.defaultPrevented)).toBe(true);
  const rows = await historyRows(page);
  // The row keeps what the browser reported before this page acted (the capture-phase listener saw false), and says
  // that this page then prevented it.
  const before = await page.evaluate(() => window.__FODT_KEY_BEFORE__ ?? []);
  expect(before.find((e) => e.key === 'a')).toEqual({ key: 'a', defaultPrevented: false });
  expect(rows.find((cells) => cells[0] === 'keydown' && cells[1] === 'a')?.[10]).toBe(PREVENTED_BY_PAGE);
  expect(rows.find((cells) => cells[0] === 'keydown' && cells[1] === 'Escape')?.[10]).toBe('false');
  expect(rows.filter((cells) => cells[0] === 'keydown' && cells[1] === 'Tab').map((cells) => cells[10])).toEqual([
    'false',
    'false',
  ]);

  // The keys of an input method are exempt as well: a key named Process, a key code of 229, or a key pressed while
  // composing is never prevented, and an ordinary key is.
  await box.focus();
  const notPrevented = await box.evaluate((element) => {
    const send = (init: KeyboardEventInit & { keyCode?: number }) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      // dispatchEvent returns false when a listener prevented the default.
      return element.dispatchEvent(event);
    };
    return {
      process: send({ key: 'Process', code: 'KeyK' }),
      composing: send({ key: 'k', code: 'KeyK', isComposing: true }),
      ordinary: send({ key: 'k', code: 'KeyK' }),
    };
  });
  expect(notPrevented).toEqual({ process: true, composing: true, ordinary: false });
});

test('keyboard-event-viewer: the history is a real table and the live region is its wrapper', async ({ page }) => {
  await openViewer(page);
  await page.keyboard.press('a');
  await expect.poll(async () => (await historyRows(page)).length).toBe(3);
  // The table keeps its own semantics (table, row group, rows, column headers); the log role is on the wrapper around it.
  const shape = await page.evaluate(() => {
    const log = document.querySelector('#fodt-key-capture [role="log"]');
    const table = log?.querySelector('table');
    return {
      logTag: log?.tagName ?? '',
      logLabel: log?.getAttribute('aria-label') ?? '',
      live: log?.getAttribute('aria-live') ?? '',
      tableRole: table?.getAttribute('role') ?? null,
      tableLive: table?.getAttribute('aria-live') ?? null,
      headers: [...(table?.querySelectorAll('thead th') ?? [])].map((cell) => cell.textContent),
      logsInArea: document.querySelectorAll('#fodt-key-capture [role="log"]').length,
    };
  });
  expect(shape.logTag).toBe('DIV');
  expect(shape.logLabel).toBe('Key event history');
  expect(shape.live).toBe('off');
  expect(shape.tableRole).toBeNull();
  expect(shape.tableLive).toBeNull();
  expect(shape.headers).toContain('defaultPrevented');
  expect(shape.logsInArea).toBe(1);
  // Assistive technology finds the table by its role, with rows and column headers.
  await expect(page.locator('#fodt-key-capture').getByRole('table')).toHaveCount(1);
  await expect(page.locator('#fodt-key-capture').getByRole('columnheader', { name: 'keyCode' })).toBeVisible();
  expect(await page.locator('#fodt-key-capture').getByRole('row').count()).toBeGreaterThanOrEqual(4);
});

test('keyboard-event-viewer: keys pressed while the capture box does not have focus are not read', async ({ page }) => {
  const box = await openViewer(page);
  // The test's own document listener proves the keys really were dispatched somewhere.
  await page.evaluate(() => {
    window.__FODT_DOCUMENT_KEYS__ = 0;
    document.addEventListener('keydown', () => {
      window.__FODT_DOCUMENT_KEYS__ = (window.__FODT_DOCUMENT_KEYS__ ?? 0) + 1;
    });
  });
  expect(await historyRows(page)).toEqual([['No key events yet.']]);

  await page.getByRole('button', { name: 'Reset', exact: true }).focus();
  await page.keyboard.press('a');
  await page.keyboard.press('b');
  await page.keyboard.press('Shift+c');
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.press('x');
  await page.keyboard.press('y');

  expect(await page.evaluate(() => window.__FODT_DOCUMENT_KEYS__)).toBeGreaterThanOrEqual(5);
  expect(await reference(page)).toEqual([]);
  expect(await historyRows(page)).toEqual([['No key events yet.']]);
  await expect(box).toHaveValue('');

  // The same box still reads keys the moment it has focus again.
  await box.focus();
  await page.keyboard.press('q');
  await expect.poll(async () => (await historyRows(page)).length).toBe(3);
  expect((await historyRows(page)).map((cells) => cells[1])).toEqual(['q', 'q', 'q']);
});

test('keyboard-event-viewer: the history keeps the latest 200 rows and Clear empties the history and the box', async ({
  page,
}) => {
  const box = await openViewer(page);
  expect(await historyRows(page)).toEqual([['No key events yet.']]);

  // Every press of a letter is three events (key down, key press, key up), all shown, so the expected rows are known
  // from the order of the presses alone. The cap is on the events kept, hidden or shown.
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const events: string[][] = [];
  const press = async (i: number) => {
    const key = letters[i % 26]!;
    events.push(['keydown', key], ['keypress', key], ['keyup', key]);
    await page.keyboard.press(key);
  };
  const shownTypeAndKey = async () => (await historyRows(page)).map((cells) => [cells[0] ?? '', cells[1] ?? '']);

  // The notice about dropped events, above the table; it is absent while nothing has been dropped.
  const notice = page.locator('#fodt-key-capture').getByText(/older events? dropped/);

  // 66 presses are 198 events: all kept.
  for (let i = 0; i < 66; i++) await press(i);
  await expect.poll(async () => (await historyRows(page)).length).toBe(198);
  expect(await shownTypeAndKey()).toEqual(events);
  await expect(notice).toHaveCount(0);

  // The 67th press brings the 199th, 200th and 201st event: the 201st row arrives and the oldest row is the one dropped.
  await press(66);
  await expect.poll(async () => (await historyRows(page)).length).toBe(200);
  expect(await shownTypeAndKey()).toEqual(events.slice(1));
  expect((await historyRows(page))[0]?.slice(0, 2)).toEqual(['keypress', 'a']);
  // One event has been dropped (the key down of the first a).
  await expect(notice).toHaveText('1 older event dropped');

  // 205 presses in all: the rows are the last 200 events, in the order of the presses, newest last.
  for (let i = 67; i < 205; i++) await press(i);
  await expect.poll(async () => (await shownTypeAndKey()).slice(-1)[0]).toEqual(['keyup', letters[204 % 26]]);
  expect(events).toHaveLength(615);
  expect(await shownTypeAndKey()).toEqual(events.slice(-200));
  await expect(box).toHaveValue(Array.from({ length: 205 }, (_, i) => letters[i % 26]).join(''));
  // 615 events were typed and 200 are kept.
  await expect(notice).toHaveText('415 older events dropped');

  // Hiding event types changes only what is shown: the 200 kept events hold 66 key downs and a part of another.
  await option(page, 'keypress (legacy)').uncheck();
  await option(page, 'keyup').uncheck();
  await expect.poll(async () => (await shownTypeAndKey()).every(([type]) => type === 'keydown')).toBe(true);
  expect((await historyRows(page)).length).toBe(events.slice(-200).filter(([type]) => type === 'keydown').length);
  await option(page, 'keypress (legacy)').check();
  await option(page, 'keyup').check();
  await expect.poll(async () => (await historyRows(page)).length).toBe(200);
  expect(await shownTypeAndKey()).toEqual(events.slice(-200));

  await clearButton(page).click();
  expect(await historyRows(page)).toEqual([['No key events yet.']]);
  await expect(box).toHaveValue('');
  // Clear forgets the count as well.
  await expect(notice).toHaveCount(0);
  // Clear on an empty history changes nothing.
  await clearButton(page).click();
  expect(await historyRows(page)).toEqual([['No key events yet.']]);
  await expect(box).toHaveValue('');
});

test('keyboard-event-viewer: the capture box survives a field edit, Run and Reset and keeps its history', async ({
  page,
}) => {
  const box = await openViewer(page);
  // Before any key is pressed the table says so.
  expect(await historyRows(page)).toEqual([['No key events yet.']]);
  await page.keyboard.press('a');
  await expect.poll(async () => (await historyRows(page)).length).toBe(3);
  await page.evaluate(() => {
    window.__FODT_KEY_BOX__ = document.querySelector('textarea[aria-label="Key capture box"]');
  });
  const kept = () =>
    page.evaluate(
      () =>
        document.querySelectorAll('#fodt-key-capture').length === 1 &&
        document.querySelector('textarea[aria-label="Key capture box"]') === window.__FODT_KEY_BOX__,
    );

  // A field edit: hiding key ups only filters the display, for the rows already there and for the rows that follow.
  await option(page, 'keyup').uncheck();
  await expect.poll(async () => (await historyRows(page)).length).toBe(2);
  expect(await kept()).toBe(true);
  await expect(box).toHaveValue('a');
  await box.focus();
  await page.keyboard.press('c');
  await expect.poll(async () => (await historyRows(page)).length).toBe(4);
  expect((await historyRows(page)).map((cells) => `${cells[0]} ${cells[1]}`)).toEqual([
    'keydown a',
    'keypress a',
    'keydown c',
    'keypress c',
  ]);

  // The page's own run: an example button sets its values and runs the page again. Key down only shows the two key
  // downs of the keys pressed, which proves that run happened.
  await page.getByRole('button', { name: 'Key down only', exact: true }).click();
  await expect.poll(async () => (await historyRows(page)).length).toBe(2);
  expect(await kept()).toBe(true);
  await expect(box).toHaveValue('ac');

  // Reset: every option returns to its default, so the key presses and key ups are shown again, and the history, kept
  // all along, is still there.
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(option(page, 'keyup')).toBeChecked();
  await expect.poll(async () => (await historyRows(page)).length).toBe(6);
  expect(await kept()).toBe(true);
  await expect(box).toHaveValue('ac');
  expect((await historyRows(page)).map((cells) => cells[0])).toEqual([
    'keydown',
    'keypress',
    'keyup',
    'keydown',
    'keypress',
    'keyup',
  ]);

  // The box still reads keys after all of that.
  await box.focus();
  await page.keyboard.press('b');
  await expect.poll(async () => (await historyRows(page)).length).toBe(9);
});

test('keyboard-event-viewer: leaving the tool inside the site forgets the keys and the box at once, and a return finds both empty', async ({
  page,
}) => {
  const box = await openViewer(page);
  await page.keyboard.type('abc');
  await expect(box).toHaveValue('abc');
  await expect.poll(async () => (await historyRows(page)).length).toBe(9);
  // Keep hold of the capture box and the body of the history table, to look at them after the page has left them.
  await page.evaluate(() => {
    window.__FODT_KEY_OLD__ = {
      box: document.querySelector('textarea[aria-label="Key capture box"]') as HTMLTextAreaElement,
      body: document.querySelector('#fodt-key-capture tbody') as HTMLElement,
    };
  });

  // Another tool, reached through the site's own links (the single page app never reloads).
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tools', exact: true }).click();
  await page.locator('a[href$="/tools/base64"]').first().click();
  await expect(page).toHaveURL(/\/tools\/base64$/);
  await expect(page.locator('#fodt-key-capture')).toHaveCount(0);

  // The old box and table were emptied when the area left the page, not when a visitor comes back: what was typed is
  // no longer held by anything this page keeps.
  await expect
    .poll(() => page.evaluate(() => window.__FODT_KEY_OLD__?.box.value ?? 'missing'), { timeout: 5000 })
    .toBe('');
  expect(await page.evaluate(() => window.__FODT_KEY_OLD__?.body.children.length ?? -1)).toBe(0);

  // Back at the tool, the box and the history are empty.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tools', exact: true }).click();
  await page.locator('a[href$="/tools/keyboard-event-viewer"]').first().click();
  await expect(captureBox(page)).toBeVisible();
  await expect(captureBox(page)).toHaveValue('');
  expect(await historyRows(page)).toEqual([['No key events yet.']]);
  await expect(page.locator('#fodt-key-capture')).toHaveCount(1);
  // And the new box reads keys as before.
  await captureBox(page).focus();
  await page.keyboard.press('q');
  await expect.poll(async () => (await historyRows(page)).length).toBe(3);
});

/** Everything the recorder has seen since it was started. */
interface Recording {
  requests: { url: string; method: string; postData: string }[];
  consoleTexts: string[];
  pageErrors: string[];
}

/** Starts recording every request (address, method and body), console message and page error from now on. */
function recordEverything(page: Page): Recording {
  const recording: Recording = { requests: [], consoleTexts: [], pageErrors: [] };
  page.on('request', (request) => {
    recording.requests.push({ url: request.url(), method: request.method(), postData: request.postData() ?? '' });
  });
  page.on('console', (message) => recording.consoleTexts.push(message.text()));
  page.on('pageerror', (error) => recording.pageErrors.push(error.message));
  return recording;
}

/** Whether a piece of text holds any marker, as written or percent-encoded. */
function holdsAny(text: string, markers: string[]): boolean {
  return markers.some((marker) => text.includes(marker) || text.includes(encodeURIComponent(marker)));
}

/**
 * Asserts the marker went nowhere. Requests: each goes to the page's own origin or is a data or blob address, and none
 * holds a marker in its address or body. Messages: no console message or page error holds a marker. Everything else: the
 * page address, the document title, cookies, localStorage and sessionStorage hold none, no IndexedDB database or Cache
 * Storage entry exists, and the private file system root has no entries (each only where the browser offers the
 * interface). The list of markers must not be empty, so a silent pass is impossible.
 */
async function assertNothingLeft(page: Page, recording: Recording, markers: string[]): Promise<void> {
  expect(markers.length, 'there is no marker to look for').toBeGreaterThan(0);
  const origin = new URL(page.url()).origin;
  for (const request of recording.requests) {
    const own =
      request.url.startsWith('data:') || request.url.startsWith('blob:') || request.url.startsWith(`${origin}/`);
    expect(own, `a request left the page's own origin: ${request.method} ${request.url.slice(0, 80)}`).toBe(true);
    expect(holdsAny(request.url, markers), `a request address holds the marker: ${request.url.slice(0, 80)}`).toBe(
      false,
    );
    expect(holdsAny(request.postData, markers), `a request body holds the marker: ${request.url.slice(0, 80)}`).toBe(
      false,
    );
  }
  for (const text of [...recording.consoleTexts, ...recording.pageErrors]) {
    expect(holdsAny(text, markers), 'a console message or page error holds the marker').toBe(false);
  }
  expect(holdsAny(page.url(), markers), 'the page address holds the marker').toBe(false);
  expect(holdsAny(await page.title(), markers), 'the document title holds the marker').toBe(false);
  expect(holdsAny(JSON.stringify(await page.context().cookies()), markers), 'a cookie holds the marker').toBe(false);

  const inPage = await page.evaluate(async () => {
    const read = (store: Storage): string => {
      const entries: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i) ?? '';
        entries.push(`${key}=${store.getItem(key) ?? ''}`);
      }
      return entries.join('\n');
    };
    const result = {
      local: read(window.localStorage),
      session: read(window.sessionStorage),
      databases: [] as string[],
      caches: [] as string[],
      privateFiles: [] as string[],
    };
    const indexed = window.indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> };
    if (typeof indexed.databases === 'function') {
      result.databases = (await indexed.databases()).map((db) => db.name ?? '(unnamed)');
    }
    if (typeof window.caches !== 'undefined') result.caches = await window.caches.keys();
    const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
    if (typeof storage?.getDirectory === 'function') {
      try {
        const root = await storage.getDirectory();
        // Iterating a directory handle is not in every TypeScript library the project builds with.
        const entries = (root as unknown as { keys: () => AsyncIterable<string> }).keys();
        for await (const name of entries) result.privateFiles.push(name);
      } catch {
        // A browser that refuses the private file system to this page has nothing stored in it by this page.
      }
    }
    return result;
  });
  expect(holdsAny(inPage.local, markers), 'localStorage holds the marker').toBe(false);
  expect(holdsAny(inPage.session, markers), 'sessionStorage holds the marker').toBe(false);
  expect(inPage.databases, 'an IndexedDB database exists').toEqual([]);
  expect(inPage.caches, 'a Cache Storage entry exists').toEqual([]);
  expect(inPage.privateFiles, 'the private file system holds entries').toEqual([]);
}

const CANARY = 'FODT-KEYS-CANARY-4417';

test('keyboard-event-viewer: typed keys never reach a request, storage, a cookie, the console, the title or the address', async ({
  page,
}) => {
  const recording = recordEverything(page);
  const box = await openViewer(page);

  // Real key presses, one letter at a time, never a paste or a fill.
  await page.keyboard.type(CANARY);

  // The rows show it letter by letter: the key down column spells the canary.
  await expect.poll(async () => (await historyRows(page)).length).toBe(CANARY.length * 3);
  const rows = await historyRows(page);
  expect(
    rows
      .filter((cells) => cells[0] === 'keydown')
      .map((cells) => cells[1])
      .join(''),
  ).toBe(CANARY);
  await expect(box).toHaveValue(CANARY);

  const letters = [...CANARY];
  await assertNothingLeft(page, recording, [
    CANARY,
    letters.join(''),
    letters.join(','),
    letters.join(' '),
    letters.join('|'),
    letters.join('+'),
  ]);
  // The page prints nothing at all to the console and raises no error.
  expect(recording.consoleTexts).toEqual([]);
  expect(recording.pageErrors).toEqual([]);
});
