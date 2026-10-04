/** How many characters of a pattern line a page shows inside a sentence or a table cell. */
export const MAX_SHOWN_PATTERN = 40;
/** How many characters of a path a page shows in a table cell. */
export const MAX_SHOWN_PATH = 200;

const ELLIPSIS = String.fromCodePoint(0x2026);
const ESCAPE_OPEN = String.fromCodePoint(92) + 'u{';

/**
 * True for the characters shown as a code point instead of themselves: the control characters, and the characters that
 * change the direction of the text around them (Unicode Standard Annex 9: U+061C, U+200E, U+200F, U+202A to U+202E and
 * U+2066 to U+2069), which can make a path read as a different one.
 */
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
 * Pasted text made safe to show: control characters and direction-changing characters are written as a backslash, `u`,
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
