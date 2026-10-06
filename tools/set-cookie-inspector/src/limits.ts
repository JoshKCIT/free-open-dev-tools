import { SetCookieInspectorError } from './errors';
import { forEachLine, isBlank } from './lines';

/** The most characters one paste may hold. Bounds the work before any line is read. */
export const MAX_PASTE_CHARACTERS = 262_144;
/** The most lines in one paste (blank lines do not count). */
export const MAX_LINES = 500;
/** The most characters in one line. */
export const MAX_LINE_CHARACTERS = 16_384;
/** The most attributes (text between semicolons, after the first one) in one line. */
export const MAX_ATTRIBUTES = 100;
/** The most octets in a cookie name and value together (draft section 5.6 step 5 and section 5.7 step 4). */
export const MAX_NAME_VALUE_OCTETS = 4_096;
/** The most octets in an attribute value (draft section 5.6 step 6). */
export const MAX_ATTRIBUTE_VALUE_OCTETS = 1_024;
/** The longest lifetime a cookie keeps: 400 days in seconds (draft section 5.5). */
export const MAX_AGE_LIMIT_SECONDS = 34_560_000;
/** The longest address of the response. */
export const MAX_URL_CHARACTERS = 8_192;

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

/** The length of a text in UTF-8 octets. A lone surrogate counts 3, as its replacement character would. */
export function octetLength(text: string): number {
  let octets = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) octets += 1;
    else if (code < 0x800) octets += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        octets += 4;
        i += 1;
      } else octets += 3;
    } else octets += 3;
  }
  return octets;
}

/** Counts the semicolons of a line: one more than the number of attributes it can hold. */
function countSemicolons(text: string, start: number, end: number): number {
  let count = 0;
  for (let i = start; i < end; i++) {
    if (text.charCodeAt(i) === 59) count += 1;
  }
  return count;
}

/**
 * Refuses a paste that is too big, before a single line is read as a cookie. A refusal names the part, the limit and a
 * line; it never holds any of the pasted text.
 */
export function checkInput(text: string): void {
  if (text.length > MAX_PASTE_CHARACTERS) {
    throw new SetCookieInspectorError(
      `The paste is ${withCommas(text.length)} characters. The limit is ${withCommas(MAX_PASTE_CHARACTERS)}.`,
      'lines',
    );
  }
  let filled = 0;
  forEachLine(text, (start, end, number) => {
    if (isBlank(text, start, end)) return;
    filled += 1;
    if (filled > MAX_LINES) {
      throw new SetCookieInspectorError(
        `The paste holds more than ${withCommas(MAX_LINES)} lines (blank lines do not count). Line ${number} is the first one past the limit of ${withCommas(MAX_LINES)}.`,
        'lines',
        number,
      );
    }
    if (end - start > MAX_LINE_CHARACTERS) {
      throw new SetCookieInspectorError(
        `Line ${number} is ${withCommas(end - start)} characters. The limit is ${withCommas(MAX_LINE_CHARACTERS)} for one line.`,
        'lines',
        number,
      );
    }
    if (countSemicolons(text, start, end) > MAX_ATTRIBUTES) {
      throw new SetCookieInspectorError(
        `Line ${number} holds more than ${withCommas(MAX_ATTRIBUTES)} attributes. The limit is ${withCommas(MAX_ATTRIBUTES)} for one line.`,
        'lines',
        number,
      );
    }
  });
}

/** Refuses an address that is too long, before it is read. Never holds any of the address. */
export function checkUrl(url: string): void {
  if (url.length > MAX_URL_CHARACTERS) {
    throw new SetCookieInspectorError(
      `The response address is ${withCommas(url.length)} characters. The limit is ${withCommas(MAX_URL_CHARACTERS)}.`,
      'request url',
    );
  }
}
