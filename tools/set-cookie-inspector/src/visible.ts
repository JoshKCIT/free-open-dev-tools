/** How many characters of a pattern line a page shows inside a sentence or a table cell. */
export const MAX_SHOWN_PATTERN = 40;
/** How many characters of a path a page shows in a table cell. */
export const MAX_SHOWN_PATH = 200;

const ELLIPSIS = String.fromCodePoint(0x2026);
const ESCAPE_OPEN = String.fromCodePoint(92) + 'u{';

/**
 * Code point ranges that are shown as an escape instead of themselves: the control characters, the characters that change
 * the direction of the text around them (Unicode Standard Annex 9), characters with no visible shape (soft hyphen, zero
 * width space, joiners, word joiner, byte order mark, variation selectors, the invisible filler characters, the Braille
 * blank and the tag characters), blank characters that look like a space, and unpaired surrogates. A path or a key name can
 * hide in exactly these characters. The table is the one the IDN converter's own text uses, copied here because a tool
 * folder never imports from another, with U+2800 added.
 */
const HIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00a0, 0x00a0],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x1680, 0x1680],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x2000, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x206f],
  [0x2800, 0x2800],
  [0x3000, 0x3000],
  [0x3164, 0x3164],
  [0xd800, 0xdfff],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffb],
  [0xfffe, 0xffff],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
];

function needsEscape(point: number): boolean {
  for (const range of HIDDEN_RANGES) {
    if (point >= range[0] && point <= range[1]) return true;
  }
  return false;
}

/**
 * Pasted text made safe to show: hidden and direction-changing characters are written as a backslash, `u`,
 * braces and the code point in hex, and only the first `maxCharacters` characters (code points) are kept, with an
 * ellipsis after them when something was left out.
 */
export function visible(text: string, maxCharacters: number): string {
  let shown = '';
  let count = 0;
  for (const ch of text) {
    if (count === maxCharacters) return shown + ELLIPSIS;
    const point = ch.codePointAt(0) ?? 0;
    shown += needsEscape(point) ? ESCAPE_OPEN + point.toString(16).toUpperCase() + '}' : ch;
    count++;
  }
  return shown;
}
