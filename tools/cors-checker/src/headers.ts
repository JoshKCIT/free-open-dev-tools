import { CorsCheckerError, type CorsCheckerPart } from './errors';

/** One header as pasted: the name as written, the value without the white space around it, and its line number. */
export interface HeaderEntry {
  name: string;
  value: string;
  line: number;
}

/** A pasted block of headers read into entries, in the order pasted. */
export interface HeaderBlock {
  part: CorsCheckerPart;
  entries: HeaderEntry[];
  /** The line of a status line such as `HTTP/1.1 204 No Content` that was skipped, when there was one. */
  statusLine: number | null;
  /** The lines that are not a header and not a continuation: no colon, a name that is not a token, a NUL character. */
  malformed: number[];
}

/** Stops the list of malformed lines from growing with the paste: only the first ones are ever needed. */
const MAX_MALFORMED_KEPT = 20;

/** Characters allowed in a token (RFC 9110 section 5.6.2): letters, digits and ! # $ % & ' * + - . ^ _ ` | ~ */
function isTokenCode(code: number): boolean {
  if (code >= 48 && code <= 57) return true;
  if (code >= 65 && code <= 90) return true;
  if (code >= 97 && code <= 122) return true;
  switch (code) {
    case 33:
    case 35:
    case 36:
    case 37:
    case 38:
    case 39:
    case 42:
    case 43:
    case 45:
    case 46:
    case 94:
    case 95:
    case 96:
    case 124:
    case 126:
      return true;
    default:
      return false;
  }
}

/** A token: one or more token characters. */
export function isToken(text: string): boolean {
  if (text.length === 0) return false;
  for (let i = 0; i < text.length; i++) {
    if (!isTokenCode(text.charCodeAt(i))) return false;
  }
  return true;
}

/** HTTP white space: horizontal tab, line feed, carriage return and space (the Fetch Standard's HTTP whitespace byte). */
function isHttpWhitespaceCode(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || code === 32;
}

/** Removes HTTP white space from both ends. */
export function trimHttpWhitespace(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isHttpWhitespaceCode(text.charCodeAt(start))) start += 1;
  while (end > start && isHttpWhitespaceCode(text.charCodeAt(end - 1))) end -= 1;
  return start === 0 && end === text.length ? text : text.slice(start, end);
}

/** Removes the spaces and tabs around a list element (the optional white space of RFC 9110 section 5.6.3). */
export function trimSpaceAndTab(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && (text.charCodeAt(start) === 32 || text.charCodeAt(start) === 9)) start += 1;
  while (end > start && (text.charCodeAt(end - 1) === 32 || text.charCodeAt(end - 1) === 9)) end -= 1;
  return start === 0 && end === text.length ? text : text.slice(start, end);
}

function isStatusLine(line: string): boolean {
  return line.startsWith('HTTP/');
}

function isBlankLine(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i);
    if (code !== 32 && code !== 9) return false;
  }
  return true;
}

/**
 * Reads a pasted block of headers: one `Name: value` per line, an optional first status line (`HTTP/1.1 204 No Content`),
 * obsolete line folding (a line that starts with a space or tab continues the one before, joined with one space), blank
 * lines skipped, and every repeated name kept in order with its line number. A line that is not a header is listed in
 * `malformed` and skipped; the caller decides what a malformed line means. Line numbers count every line, blank ones
 * included, and a line feed ends a line with one carriage return before it dropped.
 *
 * One pass with `indexOf`, no regular expression: a paste of millions of line feeds costs one visit each.
 */
export function parseHeaderBlock(text: string, part: CorsCheckerPart): HeaderBlock {
  const block: HeaderBlock = { part, entries: [], statusLine: null, malformed: [] };
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let number = 1;
  let sawContent = false;
  // The pieces of the entry being built (a header and its folded lines), joined once at the end of the entry.
  let pieces: string[] | null = null;
  let current: HeaderEntry | null = null;

  const finish = (): void => {
    if (current && pieces) current.value = pieces.length === 1 ? (pieces[0] ?? '') : pieces.join(' ');
    current = null;
    pieces = null;
  };
  const flag = (line: number): void => {
    if (block.malformed.length < MAX_MALFORMED_KEPT) block.malformed.push(line);
  };

  for (;;) {
    const lineFeed = text.indexOf('\n', start);
    const stop = lineFeed < 0 ? text.length : lineFeed;
    const end = stop > start && text.charCodeAt(stop - 1) === 13 ? stop - 1 : stop;
    const line = text.slice(start, end);

    if (!isBlankLine(line)) {
      const first = line.charCodeAt(0);
      if (first === 32 || first === 9) {
        // Obsolete folding: a continuation of the header before it.
        if (current && pieces) {
          const piece = trimSpaceAndTab(line);
          if (piece !== '') pieces.push(piece);
        } else flag(number);
      } else {
        finish();
        if (!sawContent && isStatusLine(line)) {
          block.statusLine = number;
        } else {
          const colon = line.indexOf(':');
          const name = colon < 0 ? '' : line.slice(0, colon);
          if (!isToken(name) || line.indexOf('\u0000') >= 0) {
            flag(number);
          } else {
            current = { name, value: '', line: number };
            pieces = [trimSpaceAndTab(line.slice(colon + 1))];
            block.entries.push(current);
          }
        }
        sawContent = true;
      }
    }

    if (lineFeed < 0) break;
    start = lineFeed + 1;
    number += 1;
  }
  finish();
  return block;
}

/**
 * Reads a block the checks need and refuses it when a line is not a header, naming the part and the line and never the
 * text. (A browser throws a TypeError for a request header written this way; a pasted answer with such a line is far more
 * likely a paste mistake than something a server sent.)
 */
export function readBlock(text: string, part: CorsCheckerPart): HeaderBlock {
  const block = parseHeaderBlock(text, part);
  const first = block.malformed[0];
  if (first !== undefined) {
    throw new CorsCheckerError(
      `Line ${first} of the ${part} is not a header. Write one Name: value per line; a name is letters, digits and ! # $ % & ' * + - . ^ _ \` | ~ with no space before the colon.`,
      part,
      first,
    );
  }
  return block;
}

/** Every value of a name (compared without regard to letter case), in the order pasted. */
export function getAll(entries: readonly HeaderEntry[], name: string): string[] {
  const wanted = name.toLowerCase();
  const values: string[] = [];
  for (const entry of entries) {
    if (entry.name.toLowerCase() === wanted) values.push(entry.value);
  }
  return values;
}

/** The values of a name joined with a comma and a space, as the Fetch Standard's "get" does; null when the name is absent. */
export function getCombined(entries: readonly HeaderEntry[], name: string): string | null {
  const values = getAll(entries, name);
  return values.length === 0 ? null : values.join(', ');
}

/** The entries of a name, in the order pasted. */
export function getEntries(entries: readonly HeaderEntry[], name: string): HeaderEntry[] {
  const wanted = name.toLowerCase();
  return entries.filter((entry) => entry.name.toLowerCase() === wanted);
}
