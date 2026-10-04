import { DockerRunError } from './errors';

/** The most pasted characters that are read at once. */
export const MAX_INPUT_LENGTH = 65_536;
/** How many characters of pasted text a message, a table cell or a list item may show. */
export const MAX_SHOWN = 40;

const ELLIPSIS = String.fromCodePoint(0x2026);
const ESCAPE_OPEN = String.fromCodePoint(92) + 'u{';

/** A whole number with a comma between thousands, the same in every locale. */
export function withCommas(value: number): string {
  const digits = String(value);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/** Refuses a paste that is too long, before a single character of it is read. The message holds none of the paste. */
export function checkSize(text: string): void {
  if (text.length > MAX_INPUT_LENGTH) {
    throw new DockerRunError(
      `This paste is ${withCommas(text.length)} characters. The limit is ${withCommas(MAX_INPUT_LENGTH)} because a longer command would make the page slow to answer.`,
      1,
      1,
    );
  }
}

/**
 * True for the characters shown as a code point instead of themselves: the control characters, and the characters that
 * change the direction of the text around them (Unicode Standard Annex 9: U+061C, U+200E, U+200F, U+202A to U+202E and
 * U+2066 to U+2069), which can make one word read as another.
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
export function visible(text: string, maxCharacters: number = MAX_SHOWN): string {
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
