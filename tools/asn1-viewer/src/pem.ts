/**
 * PEM scanning and the Base64 and hex codecs. This file is the canonical copy: the certificate decoder keeps a byte for
 * byte copy of it (never an import across tool folders), so a change is made here first and copied afterwards.
 *
 * Nothing in this file uses a regular expression with a lazy or nested repeat over a whole paste. PEM is scanned with
 * `indexOf` and bounded loops, Base64 is decoded in one pass with a table, and its padding is counted by a loop that
 * walks backwards from the end, so a hostile paste costs time in proportion to its length and no more.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */

export class PemError extends Error {
  /** Index into the text where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'PemError';
    this.position = position;
  }
}

/** The most characters of a pasted block label or algorithm identifier that a message repeats. */
export const MAX_ECHO_CHARS = 40;

/**
 * A name taken from the paste (a block label, an algorithm identifier) as a message may repeat it: whole up to 40
 * characters, then cut with three dots. A message names what it could not read, and never copies a long pasted value.
 */
export function shortened(text: string): string {
  return text.length <= MAX_ECHO_CHARS ? text : text.slice(0, MAX_ECHO_CHARS) + '...';
}

export interface PemBlock {
  /** The label between BEGIN and the dashes, for example PRIVATE KEY. */
  label: string;
  /** RFC 1421 header lines (for example Proc-Type) found before the body, without their line ends. */
  headers: string[];
  /** The decoded body. */
  body: Uint8Array;
  /** Index of the first dash of the BEGIN line. */
  start: number;
  /** Index just after the last dash of the END line. */
  end: number;
}

const BEGIN = '-----BEGIN ';
const END = '-----END ';
const DASHES = '-----';
const MAX_LABEL_LENGTH = 64;

const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function lookupTable(alphabet: string): Int8Array {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  return table;
}

const STANDARD_TABLE = lookupTable(STANDARD);
const URL_TABLE = lookupTable(URL_SAFE);

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

/**
 * Decodes Base64 in one pass. Whitespace is skipped anywhere; padding may be left off. The error carries the index of
 * the first character that is not part of the alphabet, and never repeats that character.
 */
export function base64ToBytes(text: string, options: { url?: boolean } = {}): Uint8Array {
  const table = options.url ? URL_TABLE : STANDARD_TABLE;
  // Padding is counted from the end, by index, so a run of equals signs is never copied or sliced.
  let stop = text.length;
  let padding = 0;
  while (stop > 0) {
    const code = text.charCodeAt(stop - 1);
    if (code === 61) padding++;
    else if (!isSpace(code)) break;
    stop--;
  }
  const out = new Uint8Array(Math.ceil((stop * 6) / 8));
  let accumulator = 0;
  let bits = 0;
  let count = 0;
  let written = 0;
  for (let i = 0; i < stop; i++) {
    const code = text.charCodeAt(i);
    if (isSpace(code)) continue;
    if (code === 61) {
      // An equals sign before the end of the data: padding must be last, so the first character after the run is the
      // problem. The run is walked once and the walk ends at the data character that must follow it.
      let after = i + 1;
      while (after < stop && (text.charCodeAt(after) === 61 || isSpace(text.charCodeAt(after)))) after++;
      throw new PemError(
        `This is not valid Base64: the character at position ${after} comes after the padding.`,
        after,
      );
    }
    const value = code < 128 ? table[code]! : -1;
    if (value < 0) {
      throw new PemError(`This is not valid Base64: the character at position ${i} is not a Base64 character.`, i);
    }
    accumulator = ((accumulator << 6) | value) & 0xffffff;
    bits += 6;
    count++;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (accumulator >> bits) & 255;
    }
  }
  if (padding > 2) {
    throw new PemError(
      `This is not valid Base64: it ends with ${padding} padding characters, and 2 is the most.`,
      stop,
    );
  }
  if (count % 4 === 1) {
    throw new PemError('This is not valid Base64: its length does not divide into whole groups.', stop);
  }
  if (padding > 0 && (count + padding) % 4 !== 0) {
    throw new PemError('This is not valid Base64: its padding does not match its length.', stop);
  }
  return out.subarray(0, written);
}

/** Writes Base64, standard or URL-safe, with or without the trailing equals signs. */
export function bytesToBase64(bytes: Uint8Array, url = false, pad = true): string {
  const alphabet = url ? URL_SAFE : STANDARD;
  const pieces: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const remaining = bytes.length - i;
    let chunk =
      alphabet[b0 >> 2]! +
      alphabet[((b0 & 3) << 4) | (b1 >> 4)]! +
      alphabet[((b1 & 15) << 2) | (b2 >> 6)]! +
      alphabet[b2 & 63]!;
    if (remaining === 1) chunk = chunk.slice(0, 2) + (pad ? '==' : '');
    else if (remaining === 2) chunk = chunk.slice(0, 3) + (pad ? '=' : '');
    pieces.push(chunk);
  }
  return pieces.join('');
}

/** PEM text: the label, the body wrapped at `width` columns (64 by default), and a line feed after every line. */
export function bytesToPem(label: string, bytes: Uint8Array, width = 64): string {
  const body = bytesToBase64(bytes);
  const lines: string[] = [];
  for (let i = 0; i < body.length; i += width) lines.push(body.slice(i, i + width));
  return `${BEGIN}${label}${DASHES}\n${lines.length > 0 ? lines.join('\n') + '\n' : ''}${END}${label}${DASHES}\n`;
}

/** Reads hex with spaces, colons and line breaks between the digits. Upper and lower case are both accepted. */
export function hexToBytes(text: string): Uint8Array {
  const digits: number[] = [];
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isSpace(code) || code === 58) continue;
    let value = -1;
    if (code >= 48 && code <= 57) value = code - 48;
    else if (code >= 97 && code <= 102) value = code - 87;
    else if (code >= 65 && code <= 70) value = code - 55;
    if (value < 0) throw new PemError(`This is not valid hex: the character at position ${i} is not a hex digit.`, i);
    digits.push(value);
    positions.push(i);
  }
  if (digits.length % 2 === 1) {
    throw new PemError(
      `This is not valid hex: it has an odd number of digits, and the one at position ${positions[positions.length - 1]} has no partner.`,
      positions[positions.length - 1],
    );
  }
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = (digits[i * 2]! << 4) | digits[i * 2 + 1]!;
  return out;
}

function isLabelCharacter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || code === 32;
}

/**
 * Reads the label after a BEGIN marker at `from` (the index just after "-----BEGIN "). Returns the label and the index
 * just after its closing dashes, or null when what follows is not a label. The scan is bounded by the longest label.
 */
function readLabel(text: string, from: number): { label: string; after: number } | null {
  for (let at = from; at <= from + MAX_LABEL_LENGTH; at++) {
    if (text.startsWith(DASHES, at)) {
      return at === from ? null : { label: text.slice(from, at), after: at + DASHES.length };
    }
    if (at >= text.length || !isLabelCharacter(text.charCodeAt(at))) return null;
  }
  return null;
}

/** Whether a line looks like an RFC 1421 header: a name, a colon and a value. Base64 never holds a colon. */
function isHeaderLine(line: string): boolean {
  return line.indexOf(':') > 0;
}

/**
 * Finds every PEM block in `text`. Each BEGIN line must be followed by an END line with the same label before the next
 * BEGIN; a BEGIN with no END, an END for another label, and more than `maxBlocks` blocks are refused with the position
 * of the problem. Text between and around the blocks is ignored. Line width, CRLF line ends and any blank lines are
 * accepted (RFC 7468 section 2: a parser accepts any width). The scan walks the text once.
 */
export function pemBlocks(text: string, maxBlocks: number): PemBlock[] {
  const blocks: PemBlock[] = [];
  let position = 0;
  for (;;) {
    const start = text.indexOf(BEGIN, position);
    if (start < 0) break;
    const labelRead = readLabel(text, start + BEGIN.length);
    if (labelRead === null) {
      position = start + BEGIN.length;
      continue;
    }
    // The block must end at the very next END marker. A BEGIN without one is refused at once, so no later BEGIN is ever
    // searched for an END that was already known to be missing, and the search cost is the length of the text once.
    const nextEnd = text.indexOf(END, labelRead.after);
    if (nextEnd < 0) {
      throw new PemError(`The BEGIN line at position ${start} has no END line after it.`, start);
    }
    const closing = readLabel(text, nextEnd + END.length);
    if (closing === null || closing.label !== labelRead.label) {
      throw new PemError(
        `The END line at position ${nextEnd} does not match the BEGIN line at position ${start}.`,
        start,
      );
    }
    if (blocks.length >= maxBlocks) {
      throw new PemError(`This paste holds more than ${maxBlocks} PEM blocks. Paste fewer at a time.`, start);
    }
    // Header lines (RFC 1421) come first, up to a blank line; everything after is the Base64 body.
    const inside = text.slice(labelRead.after, nextEnd);
    const headers: string[] = [];
    let bodyFrom = 0;
    let cursor = 0;
    let sawHeader = false;
    while (cursor < inside.length) {
      let lineEnd = inside.indexOf('\n', cursor);
      if (lineEnd < 0) lineEnd = inside.length;
      const line = inside.slice(cursor, lineEnd).replace(/\r$/, '');
      if (line.trim() === '') {
        cursor = lineEnd + 1;
        if (sawHeader) {
          bodyFrom = cursor;
          break;
        }
        continue;
      }
      if (sawHeader && (line.startsWith(' ') || line.startsWith('\t'))) {
        const last = headers.length - 1;
        headers[last] = headers[last]! + line;
        cursor = lineEnd + 1;
        continue;
      }
      if (!isHeaderLine(line)) break;
      headers.push(line);
      sawHeader = true;
      cursor = lineEnd + 1;
      bodyFrom = cursor;
    }
    const bodyText = inside.slice(Math.min(bodyFrom, inside.length));
    let body: Uint8Array;
    try {
      body = base64ToBytes(bodyText);
    } catch (err) {
      if (err instanceof PemError && err.position !== undefined) {
        const absolute = labelRead.after + Math.min(bodyFrom, inside.length) + err.position;
        throw new PemError(
          `The ${shortened(labelRead.label)} block holds invalid Base64 at position ${absolute}.`,
          absolute,
        );
      }
      throw new PemError(`The ${shortened(labelRead.label)} block holds invalid Base64.`, start);
    }
    blocks.push({ label: labelRead.label, headers, body, start, end: closing.after });
    position = closing.after;
  }
  return blocks;
}
