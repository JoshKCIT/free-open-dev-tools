import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  KEY_COLUMNS,
  KeyHistory,
  LOCATION_NAMES,
  MAX_HISTORY_ROWS,
  MAX_SHOWN_CHARACTERS,
  droppedNotice,
  locationLegendRows,
  modifierText,
  recordRow,
  visible,
  type KeyEventRecord,
  type ShownTypes,
} from '../src/index';

// Expected values come from the UI Events specification (https://www.w3.org/TR/uievents/): the location constants
// DOM_KEY_LOCATION_STANDARD (0x00), DOM_KEY_LOCATION_LEFT (0x01), DOM_KEY_LOCATION_RIGHT (0x02) and
// DOM_KEY_LOCATION_NUMPAD (0x03), and from what the browsers themselves reported for Playwright key presses (press
// a gives keydown a KeyA 65, keypress charCode 97). The legacy keyCode and charCode values are not defined by the
// specification; they are shown as given.

let spies: { log: ReturnType<typeof makeSpy>; warn: ReturnType<typeof makeSpy>; error: ReturnType<typeof makeSpy> };

function makeSpy(method: 'log' | 'warn' | 'error') {
  return vi.spyOn(console, method).mockImplementation(() => undefined);
}

beforeEach(() => {
  spies = { log: makeSpy('log'), warn: makeSpy('warn'), error: makeSpy('error') };
});

afterEach(() => {
  spies.log.mockRestore();
  spies.warn.mockRestore();
  spies.error.mockRestore();
});

function record(partial: Partial<KeyEventRecord> = {}): KeyEventRecord {
  return {
    type: 'keydown',
    key: 'a',
    code: 'KeyA',
    keyCode: 65,
    which: 65,
    charCode: 0,
    location: 0,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    data: '',
    ...partial,
  };
}

const ALL_SHOWN: ShownTypes = { keydown: true, keypress: true, keyup: true, composition: true };

it('a key event record keeps key, code, keyCode, which, charCode, location, modifiers, repeat and isComposing exactly as given', () => {
  expect(KEY_COLUMNS).toEqual([
    'Event',
    'key',
    'code',
    'keyCode',
    'which',
    'charCode',
    'location',
    'Modifiers',
    'repeat',
    'isComposing',
    'defaultPrevented',
    'data',
  ]);

  // keydown of a: charCode is blank because only a key press reports one.
  expect(recordRow(record())).toEqual([
    'keydown',
    'a',
    'KeyA',
    '65',
    '65',
    '',
    '0 (standard)',
    'none',
    'false',
    'false',
    'false',
    '',
  ]);

  // keypress of a: the legacy key code 97 and charCode 97 the browsers reported.
  expect(recordRow(record({ type: 'keypress', keyCode: 97, which: 97, charCode: 97 }))).toEqual([
    'keypress',
    'a',
    'KeyA',
    '97',
    '97',
    '97',
    '0 (standard)',
    'none',
    'false',
    'false',
    'false',
    '',
  ]);

  // a left shift key held with Control, repeating, during a composition, with the default prevented.
  expect(
    recordRow(
      record({
        type: 'keydown',
        key: 'Shift',
        code: 'ShiftLeft',
        keyCode: 16,
        which: 16,
        location: 1,
        ctrlKey: true,
        shiftKey: true,
        repeat: true,
        isComposing: true,
        defaultPrevented: true,
      }),
    ),
  ).toEqual(['keydown', 'Shift', 'ShiftLeft', '16', '16', '', '1 (left)', 'Ctrl+Shift', 'true', 'true', 'true', '']);

  // a composition event carries its text in the data column and has no key.
  expect(
    recordRow(record({ type: 'compositionupdate', key: '', code: '', keyCode: 0, which: 0, data: 'にほ' })),
  ).toEqual(['compositionupdate', '', '', '0', '0', '', '0 (standard)', 'none', 'false', 'false', 'false', 'にほ']);

  expect(modifierText(record())).toBe('none');
  expect(modifierText(record({ ctrlKey: true, shiftKey: true, altKey: true, metaKey: true }))).toBe(
    'Ctrl+Shift+Alt+Meta',
  );
  expect(modifierText(record({ altKey: true }))).toBe('Alt');
  expect(modifierText(record({ metaKey: true, ctrlKey: true }))).toBe('Ctrl+Meta');
});

it('location numbers 0 to 3 are named as the UI Events specification names them', () => {
  expect(LOCATION_NAMES.get(0)).toEqual({ label: 'standard', constant: 'DOM_KEY_LOCATION_STANDARD' });
  expect(LOCATION_NAMES.get(1)).toEqual({ label: 'left', constant: 'DOM_KEY_LOCATION_LEFT' });
  expect(LOCATION_NAMES.get(2)).toEqual({ label: 'right', constant: 'DOM_KEY_LOCATION_RIGHT' });
  expect(LOCATION_NAMES.get(3)).toEqual({ label: 'numpad', constant: 'DOM_KEY_LOCATION_NUMPAD' });
  expect(LOCATION_NAMES.size).toBe(4);

  expect(recordRow(record({ location: 1 }))[6]).toBe('1 (left)');
  expect(recordRow(record({ location: 2 }))[6]).toBe('2 (right)');
  expect(recordRow(record({ location: 3 }))[6]).toBe('3 (numpad)');
  expect(recordRow(record({ location: 7 }))[6]).toBe('7 (unknown)');

  expect(locationLegendRows()).toEqual([
    ['0', 'standard', 'DOM_KEY_LOCATION_STANDARD'],
    ['1', 'left', 'DOM_KEY_LOCATION_LEFT'],
    ['2', 'right', 'DOM_KEY_LOCATION_RIGHT'],
    ['3', 'numpad', 'DOM_KEY_LOCATION_NUMPAD'],
  ]);
});

it('control and bidirectional characters in a key or composition text are shown escaped and cut at 64 characters', () => {
  const rlo = String.fromCodePoint(0x202e);
  const nul = String.fromCodePoint(0);
  const esc = String.fromCodePoint(0x1b);
  const del = String.fromCodePoint(0x7f);
  const c1 = String.fromCodePoint(0x85);
  const alm = String.fromCodePoint(0x61c);
  const lrm = String.fromCodePoint(0x200e);
  const rlm = String.fromCodePoint(0x200f);
  const lre = String.fromCodePoint(0x202a);
  const isolate = String.fromCodePoint(0x2066);
  const popIsolate = String.fromCodePoint(0x2069);

  // The brace form is the one the page documents: a backslash, a lowercase u, braces and the code point in hex.
  const open = String.fromCodePoint(92) + 'u{';
  expect(visible(rlo)).toEqual({ shown: open + '202E}', truncated: false });
  expect(visible(nul)).toEqual({ shown: open + '0}', truncated: false });
  expect(visible(esc)).toEqual({ shown: open + '1B}', truncated: false });
  expect(visible(del).shown).toBe(open + '7F}');
  expect(visible(c1).shown).toBe(open + '85}');
  expect(visible(alm).shown).toBe(open + '61C}');
  expect(visible(lrm).shown).toBe(open + '200E}');
  expect(visible(rlm).shown).toBe(open + '200F}');
  expect(visible(lre).shown).toBe(open + '202A}');
  expect(visible(isolate).shown).toBe(open + '2066}');
  expect(visible(popIsolate).shown).toBe(open + '2069}');

  // Letters, the space, digits and ordinary non-ASCII text are left as they are.
  expect(visible('Enter a 1 日本')).toEqual({ shown: 'Enter a 1 日本', truncated: false });
  expect(visible(' ')).toEqual({ shown: ' ', truncated: false });
  expect(visible('')).toEqual({ shown: '', truncated: false });

  // Exactly 64 code points are kept whole; 65 are cut to 64 and flagged.
  expect(MAX_SHOWN_CHARACTERS).toBe(64);
  expect(visible('a'.repeat(64))).toEqual({ shown: 'a'.repeat(64), truncated: false });
  expect(visible('a'.repeat(65))).toEqual({ shown: 'a'.repeat(64), truncated: true });
  expect(visible('a'.repeat(5000))).toEqual({ shown: 'a'.repeat(64), truncated: true });

  // The cut counts code points, never half of a character outside the Basic Multilingual Plane.
  const cat = String.fromCodePoint(0x1f431);
  expect(visible(cat.repeat(65))).toEqual({ shown: cat.repeat(64), truncated: true });

  // The row writes the cut as an ellipsis and escapes the text of the key and of a composition.
  const row = recordRow(record({ key: 'b'.repeat(70), type: 'compositionupdate', data: rlo + 'x' }));
  expect(row[1]).toBe('b'.repeat(64) + '…');
  expect(row[11]).toBe(open + '202E}x');
});

it('the history keeps at most 200 rows, drops the oldest first and Clear empties it', () => {
  expect(MAX_HISTORY_ROWS).toBe(200);
  const history = new KeyHistory();
  expect(history.size).toBe(0);
  expect(history.rows(ALL_SHOWN)).toEqual([]);

  for (let i = 0; i < 200; i++) history.add(record({ keyCode: i, which: i }));
  expect(history.size).toBe(200);
  expect(history.dropped).toBe(0);
  expect(history.rows(ALL_SHOWN)[0]?.keyCode).toBe(0);

  // The 201st row arrives: the oldest is the one dropped, newest last.
  history.add(record({ keyCode: 200, which: 200 }));
  expect(history.size).toBe(200);
  expect(history.dropped).toBe(1);
  const shown = history.rows(ALL_SHOWN);
  expect(shown[0]?.keyCode).toBe(1);
  expect(shown[199]?.keyCode).toBe(200);

  for (let i = 201; i < 1000; i++) history.add(record({ keyCode: i, which: i }));
  expect(history.size).toBe(200);
  expect(history.rows(ALL_SHOWN)[0]?.keyCode).toBe(800);
  expect(history.rows(ALL_SHOWN)[199]?.keyCode).toBe(999);

  history.clear();
  expect(history.size).toBe(0);
  expect(history.dropped).toBe(0);
  expect(history.rows(ALL_SHOWN)).toEqual([]);

  // Two events with identical key and code are two rows, never merged.
  history.add(record());
  history.add(record());
  expect(history.size).toBe(2);
});

it('filtering by event type changes only what is shown, never what is kept', () => {
  const history = new KeyHistory();
  history.add(record({ type: 'keydown' }));
  history.add(record({ type: 'keypress', charCode: 97 }));
  history.add(record({ type: 'keyup' }));
  history.add(record({ type: 'compositionstart' }));
  history.add(record({ type: 'compositionupdate', data: 'に' }));
  history.add(record({ type: 'compositionend', data: '日本' }));

  const types = (shown: ShownTypes) => history.rows(shown).map((r) => r.type);
  expect(types(ALL_SHOWN)).toEqual([
    'keydown',
    'keypress',
    'keyup',
    'compositionstart',
    'compositionupdate',
    'compositionend',
  ]);
  expect(types({ keydown: true, keypress: false, keyup: false, composition: false })).toEqual(['keydown']);
  expect(types({ keydown: false, keypress: true, keyup: false, composition: false })).toEqual(['keypress']);
  expect(types({ keydown: false, keypress: false, keyup: true, composition: false })).toEqual(['keyup']);
  expect(types({ keydown: false, keypress: false, keyup: false, composition: true })).toEqual([
    'compositionstart',
    'compositionupdate',
    'compositionend',
  ]);
  expect(types({ keydown: false, keypress: false, keyup: false, composition: false })).toEqual([]);

  // Everything is still there when the filter is widened again.
  expect(history.size).toBe(6);
  expect(types(ALL_SHOWN)).toHaveLength(6);

  // Hidden rows still count towards the bound: the cap is on what is kept, not on what is shown.
  const small = new KeyHistory();
  for (let i = 0; i < 250; i++) small.add(record({ type: i % 2 === 0 ? 'keydown' : 'keyup', keyCode: i }));
  expect(small.size).toBe(200);
  expect(small.rows({ keydown: true, keypress: false, keyup: false, composition: false })).toHaveLength(100);
});

it('nothing is written to the console while formatting events', () => {
  const history = new KeyHistory();
  for (let i = 0; i < 300; i++) history.add(record({ key: String.fromCodePoint(0x202e) + 'k', keyCode: i }));
  for (const r of history.rows(ALL_SHOWN)) recordRow(r);
  visible('x'.repeat(100));
  locationLegendRows();
  history.clear();
  expect(spies.log).not.toHaveBeenCalled();
  expect(spies.warn).not.toHaveBeenCalled();
  expect(spies.error).not.toHaveBeenCalled();
});

it('characters that show nothing in a key or composition text are shown as escapes, the Braille blank included', () => {
  const open = String.fromCodePoint(92) + 'u{';
  const hidden = [
    0xad, 0xa0, 0x34f, 0x1680, 0x180e, 0x2000, 0x200a, 0x200b, 0x200c, 0x200d, 0x2028, 0x2029, 0x202f, 0x205f, 0x2060,
    0x3000, 0x3164, 0xfe0f, 0xfeff, 0xffa0, 0x2800, 0xe0020, 0x1d173,
  ];
  for (const point of hidden) {
    const shown = visible('a' + String.fromCodePoint(point) + 'b').shown;
    expect(shown, 'U+' + point.toString(16)).toBe('a' + open + point.toString(16).toUpperCase() + '}b');
  }
  expect(visible(String.fromCharCode(0xd800)).shown).toBe(open + 'D800}');
  expect(visible(String.fromCodePoint(0x1f600)).shown).toBe(String.fromCodePoint(0x1f600));
  for (const point of [0x2801, 0x28ff, 0xfc, 0x65e5, 0x20, 0x2e, 0x1f600]) {
    expect(visible(String.fromCodePoint(point)).shown).toBe(String.fromCodePoint(point));
  }
  // The row shows the escape for a key whose name is a no-break space, and a composition text with a zero width space.
  const row = recordRow(
    record({ key: String.fromCodePoint(0xa0), type: 'compositionupdate', data: 'x' + String.fromCodePoint(0x200b) }),
  );
  expect(row[1]).toBe(open + 'A0}');
  expect(row[11]).toBe('x' + open + '200B}');
});

it('the notice for dropped events says nothing when none were dropped and counts the dropped ones otherwise', () => {
  expect(droppedNotice(0)).toBe('');
  expect(droppedNotice(1)).toBe('1 older event dropped');
  expect(droppedNotice(2)).toBe('2 older events dropped');
  expect(droppedNotice(415)).toBe('415 older events dropped');
  // It follows the history: 205 key presses are 615 events, 415 of them past the 200 kept.
  const history = new KeyHistory();
  for (let i = 0; i < 615; i++) history.add(record({ keyCode: i }));
  expect(droppedNotice(history.dropped)).toBe('415 older events dropped');
  history.clear();
  expect(droppedNotice(history.dropped)).toBe('');
});
