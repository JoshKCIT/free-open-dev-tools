import { ManifestBuilderError } from './errors';

/** The most characters (code points) one field or one grid cell may hold. */
export const MAX_FIELD_CHARACTERS = 2_048;
/** The most icons a manifest may list. */
export const MAX_ICONS = 50;
/** The most shortcuts a manifest may list. */
export const MAX_SHORTCUTS = 20;
/** The most bytes the manifest JSON may take. */
export const MAX_JSON_BYTES = 262_144;
/** How many characters of typed text a finding, a table cell or a label may show. */
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

/** How many code points (not UTF-16 code units) a text holds. Stops counting at `stopAfter`. */
export function countCodePoints(text: string, stopAfter: number = Number.MAX_SAFE_INTEGER): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    // A high surrogate followed by a low surrogate is one code point.
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    count++;
    if (count >= stopAfter) break;
  }
  return count;
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
 * Typed text made safe to show: control characters and direction-changing characters are written as a backslash, `u`,
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

/** Refuses a field or cell that holds more than the limit. The message names the place and never the text. */
export function checkFieldLength(text: string, place: string): void {
  // A text of more than twice the limit in UTF-16 code units can still hold exactly the limit in code points, so only
  // the code point count decides, and counting stops as soon as the limit is passed.
  if (countCodePoints(text, MAX_FIELD_CHARACTERS + 1) > MAX_FIELD_CHARACTERS) {
    throw new ManifestBuilderError(
      `The ${place} holds more than ${withCommas(MAX_FIELD_CHARACTERS)} characters. The limit is ${withCommas(MAX_FIELD_CHARACTERS)} because a longer value would make the page slow to answer.`,
    );
  }
}
