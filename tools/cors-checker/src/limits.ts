import { CorsCheckerError, type CorsCheckerPart } from './errors';
import type { CorsInput } from './request';

/** The most characters one pasted block of headers may hold. Bounds the work before any line is read. */
export const MAX_HEADER_PASTE_CHARACTERS = 65_536;
/** The most lines in one pasted block of headers (blank lines do not count). */
export const MAX_HEADER_LINES = 500;
/** The longest address, and the longest page origin. */
export const MAX_URL_CHARACTERS = 8_192;
/** The longest method name. */
export const MAX_METHOD_CHARACTERS = 64;

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

/** True when a line holds anything but spaces, tabs and a carriage return. Stops at the first such character. */
function hasContent(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code !== 32 && code !== 9 && code !== 13) return true;
  }
  return false;
}

function checkBlock(text: string, part: CorsCheckerPart): void {
  if (text.length > MAX_HEADER_PASTE_CHARACTERS) {
    throw new CorsCheckerError(
      `The ${part} are ${withCommas(text.length)} characters. The limit is ${withCommas(MAX_HEADER_PASTE_CHARACTERS)}.`,
      part,
    );
  }
  let count = 0;
  let number = 1;
  let start = 0;
  for (;;) {
    const lineFeed = text.indexOf('\n', start);
    const end = lineFeed < 0 ? text.length : lineFeed;
    if (hasContent(text, start, end)) {
      count += 1;
      if (count > MAX_HEADER_LINES) {
        throw new CorsCheckerError(
          `The ${part} hold more than ${withCommas(MAX_HEADER_LINES)} lines (blank lines do not count). Line ${number} is the first one past the limit of ${withCommas(MAX_HEADER_LINES)}.`,
          part,
          number,
        );
      }
    }
    if (lineFeed < 0) return;
    start = lineFeed + 1;
    number += 1;
  }
}

/**
 * Refuses a description that is too big, before a single header is read or a single rule is applied. A refusal names the
 * part and the limit, and a line for a header block; it never holds any of the pasted text.
 */
export function checkInput(input: CorsInput): void {
  if (input.url.length > MAX_URL_CHARACTERS) {
    throw new CorsCheckerError(
      `The URL is ${withCommas(input.url.length)} characters. The limit is ${withCommas(MAX_URL_CHARACTERS)}.`,
      'url',
    );
  }
  if (input.pageOrigin.length > MAX_URL_CHARACTERS) {
    throw new CorsCheckerError(
      `The page origin is ${withCommas(input.pageOrigin.length)} characters. The limit is ${withCommas(MAX_URL_CHARACTERS)}.`,
      'page origin',
    );
  }
  if (input.method.length > MAX_METHOD_CHARACTERS) {
    throw new CorsCheckerError(
      `The method is ${withCommas(input.method.length)} characters. The limit is ${withCommas(MAX_METHOD_CHARACTERS)}.`,
      'method',
    );
  }
  checkBlock(input.requestHeaders, 'request headers');
  checkBlock(input.preflightHeaders, 'preflight headers');
  checkBlock(input.responseHeaders, 'response headers');
}
