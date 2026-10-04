import { IdnConverterError } from './errors';

/** The most pasted text that is read at once, in characters (code points; a pair of UTF-16 units is one character). */
export const MAX_INPUT_CHARACTERS = 100_000;
/** The most names (lines that are not blank). */
export const MAX_LINES = 5_000;
/** The longest single name, before conversion. */
export const MAX_NAME_CHARACTERS = 4_096;
/** How many characters of a name or a result are shown in a table cell. */
export const MAX_SHOWN_CHARACTERS = 100;

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

/** How many characters a text has, counting a surrogate pair as one. */
export function countCharacters(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    count++;
  }
  return count;
}

/**
 * A name with the white space around it taken off: only an ASCII space, a tab and a carriage return count as white space
 * here. Any other character at an end of a name (a no-break space, an ideographic space, a line separator, a zero width
 * space) stays in the name, so it is judged and shown as an escape instead of being dropped without a word.
 */
export function trimName(line: string): string {
  let start = 0;
  let end = line.length;
  while (start < end && isEdgeSpace(line.charCodeAt(start))) start++;
  while (end > start && isEdgeSpace(line.charCodeAt(end - 1))) end--;
  return line.slice(start, end);
}

function isEdgeSpace(unit: number): boolean {
  return unit === 0x20 || unit === 0x09 || unit === 0x0d;
}

/**
 * Reads a pasted text one line at a time: lines end at a line feed. Line numbers start at 1 and count every line, blank
 * ones included, so a number shown to the visitor is the number in what they pasted. A byte order mark at the very start
 * of the text is dropped, and a carriage return before a line feed is taken off with the other ends by `trimName`.
 *
 * One pass with `indexOf`, no regular expression, no array of lines: a paste of many line feeds costs one visit each and
 * nothing is kept.
 */
export function forEachLine(text: string, visit: (line: string, number: number) => void): void {
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let number = 1;
  for (;;) {
    const lineFeed = text.indexOf('\n', start);
    if (lineFeed < 0) {
      visit(text.slice(start), number);
      return;
    }
    visit(text.slice(start, lineFeed), number);
    start = lineFeed + 1;
    number += 1;
  }
}

/**
 * Refuses a paste that is too big, before any name is converted. A refusal names the limit and, for a name, its line
 * number; it never holds any of the pasted text.
 */
export function checkSizes(text: string): void {
  const characters = countCharacters(text);
  if (characters > MAX_INPUT_CHARACTERS) {
    throw new IdnConverterError(
      `This paste is ${withCommas(characters)} characters. The limit is ${withCommas(MAX_INPUT_CHARACTERS)} because a longer list would make the page slow to answer.`,
    );
  }
  let names = 0;
  forEachLine(text, (line, number) => {
    const trimmed = trimName(line);
    if (trimmed === '') return;
    if (countCharacters(trimmed) > MAX_NAME_CHARACTERS) {
      throw new IdnConverterError(
        `This line is longer than ${withCommas(MAX_NAME_CHARACTERS)} characters. The limit for one name is ${withCommas(MAX_NAME_CHARACTERS)} characters because no domain name is anywhere near that long.`,
        number,
      );
    }
    names += 1;
    if (names > MAX_LINES) {
      throw new IdnConverterError(
        `There are more than ${withCommas(MAX_LINES)} lines of names (blank lines do not count). Line ${number} is the first one past the limit of ${withCommas(MAX_LINES)}.`,
        number,
      );
    }
  });
}

/**
 * Code point ranges that are shown as an escape instead of themselves: the control characters, the characters that change
 * the direction of the text around them (Unicode Standard Annex 9), characters with no visible shape (soft hyphen, zero
 * width space, joiners, word joiner, byte order mark, variation selectors, the invisible filler characters and the tag
 * characters), blank characters that look like a space, and unpaired surrogates. Domain name spoofing lives in exactly
 * these characters.
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
 * Pasted text made safe to show: hidden and direction-changing characters are written as a backslash, `u`, braces and the
 * code point in hex, and only the first `maxCharacters` characters (code points) are kept, with an ellipsis after them when
 * something was left out.
 */
export function visible(text: string, maxCharacters: number = MAX_SHOWN_CHARACTERS): string {
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
