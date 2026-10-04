/**
 * Pure text for the rows of the key event table: the record shape, the names of the four key locations, the escaping
 * of control and direction-changing characters, and the cell text of one row. Nothing here reads a key; the page's own
 * capture box does that and hands this file plain records.
 */

export type KeyEventType =
  'keydown' | 'keypress' | 'keyup' | 'compositionstart' | 'compositionupdate' | 'compositionend';

/** Everything one event reported, as plain values. `data` is the composition text and is empty for key events. */
export interface KeyEventRecord {
  type: KeyEventType;
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

/** The most code points of a key name or composition text that a row shows. */
export const MAX_SHOWN_CHARACTERS = 64;

/** The four key locations of the UI Events specification (DOM_KEY_LOCATION_*). */
export const LOCATION_NAMES: ReadonlyMap<number, { label: string; constant: string }> = new Map([
  [0, { label: 'standard', constant: 'DOM_KEY_LOCATION_STANDARD' }],
  [1, { label: 'left', constant: 'DOM_KEY_LOCATION_LEFT' }],
  [2, { label: 'right', constant: 'DOM_KEY_LOCATION_RIGHT' }],
  [3, { label: 'numpad', constant: 'DOM_KEY_LOCATION_NUMPAD' }],
]);

/** The header of the history table, in the order `recordRow` writes its cells. */
export const KEY_COLUMNS: readonly string[] = [
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
];

const ELLIPSIS = String.fromCodePoint(0x2026);
const ESCAPE_OPEN = String.fromCodePoint(92) + 'u{';

/** True for the characters that are shown as a code point instead of themselves. */
function needsEscape(point: number): boolean {
  return (
    point <= 0x1f ||
    (point >= 0x7f && point <= 0x9f) ||
    point === 0x61c ||
    point === 0x200e ||
    point === 0x200f ||
    (point >= 0x202a && point <= 0x202e) ||
    (point >= 0x2066 && point <= 0x2069)
  );
}

/**
 * Text that is safe to show: control characters and characters that change text direction are written as
 * a backslash, `u`, braces and the code point in hex; only the first 64 code points are kept.
 */
export function visible(text: string): { shown: string; truncated: boolean } {
  let shown = '';
  let count = 0;
  let truncated = false;
  for (const ch of text) {
    if (count === MAX_SHOWN_CHARACTERS) {
      truncated = true;
      break;
    }
    const point = ch.codePointAt(0) ?? 0;
    shown += needsEscape(point) ? ESCAPE_OPEN + point.toString(16).toUpperCase() + '}' : ch;
    count++;
  }
  return { shown, truncated };
}

/** The modifiers held for an event: Ctrl, Shift, Alt and Meta joined with a plus, or `none`. */
export function modifierText(r: KeyEventRecord): string {
  const held: string[] = [];
  if (r.ctrlKey) held.push('Ctrl');
  if (r.shiftKey) held.push('Shift');
  if (r.altKey) held.push('Alt');
  if (r.metaKey) held.push('Meta');
  return held.length === 0 ? 'none' : held.join('+');
}

function locationText(location: number): string {
  const named = LOCATION_NAMES.get(location);
  return String(location) + ' (' + (named ? named.label : 'unknown') + ')';
}

function shownText(text: string): string {
  const v = visible(text);
  return v.truncated ? v.shown + ELLIPSIS : v.shown;
}

/** The cells of one table row, in the order of `KEY_COLUMNS`. */
export function recordRow(r: KeyEventRecord): string[] {
  return [
    r.type,
    shownText(r.key),
    shownText(r.code),
    String(r.keyCode),
    String(r.which),
    r.type === 'keypress' ? String(r.charCode) : '',
    locationText(r.location),
    modifierText(r),
    r.repeat ? 'true' : 'false',
    r.isComposing ? 'true' : 'false',
    r.defaultPrevented ? 'true' : 'false',
    shownText(r.data),
  ];
}

/** The location legend: value, name and the constant the specification gives it. */
export function locationLegendRows(): string[][] {
  return [...LOCATION_NAMES].map(([value, named]) => [String(value), named.label, named.constant]);
}
