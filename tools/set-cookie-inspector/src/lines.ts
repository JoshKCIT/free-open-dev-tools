/**
 * Splitting a paste into lines. A line ends at a carriage return, a line feed or both together, so the numbers match
 * what an editor shows. Everything here is one pass over the text with index reads: no regular expression runs over the
 * paste, so a hostile paste costs time in proportion to its size and no more.
 */

const CARRIAGE_RETURN = 13;
const LINE_FEED = 10;
const SPACE = 32;
const TAB = 9;
const HEADER_PREFIX = 'set-cookie:';

/** One pasted line that holds something, with the number it has in the paste (blank lines are counted, not shown). */
export interface PastedLine {
  /** The line number in the paste, starting at 1 and counting blank lines. */
  number: number;
  /** The line without an optional `Set-Cookie:` prefix. */
  text: string;
  /** True when the line looks like several cookies joined by commas, which a browser never splits. */
  looksJoined: boolean;
}

/** Calls `visit(start, end, number)` for every line of the text, blank ones too. `end` is the index of the break. */
export function forEachLine(text: string, visit: (start: number, end: number, number: number) => void): void {
  let start = 0;
  let number = 1;
  const length = text.length;
  for (let i = 0; i < length; i++) {
    const code = text.charCodeAt(i);
    if (code === LINE_FEED || code === CARRIAGE_RETURN) {
      visit(start, i, number);
      number += 1;
      if (code === CARRIAGE_RETURN && i + 1 < length && text.charCodeAt(i + 1) === LINE_FEED) i += 1;
      start = i + 1;
    }
  }
  visit(start, length, number);
}

/** True when `text[start, end)` holds only spaces and tabs (or nothing). */
export function isBlank(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code !== SPACE && code !== TAB) return false;
  }
  return true;
}

/** Drops spaces and tabs from the start of `text[start, end)` and returns the new start. */
function skipBlanks(text: string, start: number, end: number): number {
  let i = start;
  while (i < end) {
    const code = text.charCodeAt(i);
    if (code !== SPACE && code !== TAB) break;
    i += 1;
  }
  return i;
}

/** Where the cookie text starts: after leading blanks and an optional `Set-Cookie:` prefix, in any letter case. */
function cookieStart(text: string, start: number, end: number): number {
  const begin = skipBlanks(text, start, end);
  if (end - begin < HEADER_PREFIX.length) return begin;
  for (let k = 0; k < HEADER_PREFIX.length; k++) {
    const code = text.charCodeAt(begin + k);
    const lower = code >= 65 && code <= 90 ? code + 32 : code;
    if (lower !== HEADER_PREFIX.charCodeAt(k)) return begin;
  }
  return skipBlanks(text, begin + HEADER_PREFIX.length, end);
}

/** True for the characters that cannot be inside a cookie name: controls, space, tab and the separators of RFC 9110. */
function isNameStopper(code: number): boolean {
  if (code <= 32 || code === 127) return true;
  // ( ) < > @ , ; : \ " / [ ] ? = { }
  return (
    code === 40 ||
    code === 41 ||
    code === 60 ||
    code === 62 ||
    code === 64 ||
    code === 44 ||
    code === 59 ||
    code === 61 ||
    code === 58 ||
    code === 92 ||
    code === 34 ||
    code === 47 ||
    code === 91 ||
    code === 93 ||
    code === 63 ||
    code === 123 ||
    code === 125
  );
}

/**
 * True when a comma is followed by something that looks like the start of another cookie (a name, then an equals sign).
 * A date such as `Fri, 01 Jan 2038` has a space before any equals sign, so it does not count. The look-ahead from each
 * comma stops at the next comma, so every character is read at most twice.
 */
function commaJoinedCookies(text: string): boolean {
  const length = text.length;
  let comma = text.indexOf(',');
  while (comma >= 0) {
    let i = comma + 1;
    while (i < length && (text.charCodeAt(i) === SPACE || text.charCodeAt(i) === TAB)) i += 1;
    const nameStart = i;
    while (i < length && !isNameStopper(text.charCodeAt(i))) i += 1;
    if (i > nameStart && i < length && text.charCodeAt(i) === 61) return true;
    comma = text.indexOf(',', comma + 1);
  }
  return false;
}

/**
 * The lines of a paste that hold something, in the order pasted. Blank lines (only spaces and tabs) are skipped and the
 * numbers keep counting them. A line that is only `Set-Cookie:` is kept (it holds an empty cookie, which is ignored).
 */
export function splitLines(text: string): PastedLine[] {
  const lines: PastedLine[] = [];
  forEachLine(text, (start, end, number) => {
    if (isBlank(text, start, end)) return;
    const from = cookieStart(text, start, end);
    const cookie = text.slice(from, end);
    lines.push({ number, text: cookie, looksJoined: commaJoinedCookies(cookie) });
  });
  return lines;
}
