import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The test's own reader of Unicode's IdnaTestV2.txt (version 17.0.0), written from the format notes at the top of that
 * file. It is not the package under test and shares no code with it.
 *
 * Columns, separated by semicolons, with spaces and tabs around each ignored and a number sign starting a comment:
 *   1 source; 2 toUnicode; 3 toUnicodeStatus; 4 toAsciiN; 5 toAsciiNStatus; 6 toAsciiT; 7 toAsciiTStatus.
 * A blank column 2 means the source; a blank column 3 means no errors; a blank column 4 means column 2; a blank column 5
 * means column 3; a blank column 6 means column 4; a blank column 7 means column 5. A pair of double quotes is the empty
 * string and an explicit [] is no errors. Characters may be written as a backslash and u with four hex digits, or a
 * backslash and x with the hex digits in braces.
 */
export interface IdnaRow {
  /** The line of the file the row is on, counting from 1. */
  line: number;
  source: string;
  toUnicode: string;
  toUnicodeStatus: string[];
  toAsciiN: string;
  toAsciiNStatus: string[];
  toAsciiT: string;
  toAsciiTStatus: string[];
}

export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'idna');
export const IDNA_TEST_PATH = join(FIXTURE_DIR, 'IdnaTestV2.txt');

const BACKSLASH = String.fromCharCode(92);

/** Turns the file's written-out characters into the characters themselves. */
function unescapeColumn(text: string): string {
  if (text === '""') return '';
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (ch === BACKSLASH && text[i + 1] === 'u') {
      out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
      i += 6;
    } else if (ch === BACKSLASH && text[i + 1] === 'x' && text[i + 2] === '{') {
      const close = text.indexOf('}', i);
      out += String.fromCodePoint(parseInt(text.slice(i + 3, close), 16));
      i = close + 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** The status column: undefined when blank (the column inherits), otherwise the codes inside the brackets. */
function readStatus(column: string): string[] | undefined {
  if (column === '') return undefined;
  if (!column.startsWith('[') || !column.endsWith(']')) throw new Error('unreadable status column: ' + column);
  return column
    .slice(1, -1)
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code !== '');
}

export function readIdnaTestFile(text: string): IdnaRow[] {
  const rows: IdnaRow[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index] ?? '';
    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash);
    if (line.trim() === '') continue;
    // Only spaces and tabs are ignored around a column: other white space (a no-break space, for one) is part of it.
    const columns = line.split(';').map((column) => column.replace(/^[ \t]+/, '').replace(/[ \t]+$/, ''));
    while (columns.length < 7) columns.push('');
    const source = unescapeColumn(columns[0] ?? '');
    const toUnicode = columns[1] === '' ? source : unescapeColumn(columns[1] ?? '');
    const toUnicodeStatus = readStatus(columns[2] ?? '') ?? [];
    const toAsciiN = columns[3] === '' ? toUnicode : unescapeColumn(columns[3] ?? '');
    const toAsciiNStatus = readStatus(columns[4] ?? '') ?? toUnicodeStatus;
    const toAsciiT = columns[5] === '' ? toAsciiN : unescapeColumn(columns[5] ?? '');
    const toAsciiTStatus = readStatus(columns[6] ?? '') ?? toAsciiNStatus;
    rows.push({
      line: index + 1,
      source,
      toUnicode,
      toUnicodeStatus,
      toAsciiN,
      toAsciiNStatus,
      toAsciiT,
      toAsciiTStatus,
    });
  }
  return rows;
}

export function readVendoredRows(): IdnaRow[] {
  return readIdnaTestFile(readFileSync(IDNA_TEST_PATH, 'utf8'));
}

/**
 * Equality as the file's header asks for it: an implementation that turns an illegal code point into U+FFFD compares
 * with U+FFFD in the actual value standing for any one code point of the expected value.
 */
export function sameWithWildcard(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  const a = Array.from(actual);
  const e = Array.from(expected);
  if (a.length !== e.length) return false;
  return a.every((ch, i) => ch === e[i] || ch === String.fromCodePoint(0xfffd));
}

/** SHA-256 of a file's bytes, as lower case hex. */
export function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** The git blob SHA of a file: SHA-1 of the word blob, a space, the size, a zero byte and then the bytes. */
export function gitBlobShaOfFile(path: string): string {
  const bytes = readFileSync(path);
  return createHash('sha1')
    .update('blob ' + bytes.length + String.fromCharCode(0))
    .update(bytes)
    .digest('hex');
}

/**
 * The status families the conformance data uses, by the file's own key: hyphens (V2, V3), bidi (every B code), joiners
 * (every C code), STD3 (U1), length (A4_1, A4_2), an empty label (X4_2; A4_1 and A4_2 are also given for one) and
 * everything else, which is processing (P, V1, V4, V6, V7, A3).
 */
export function familiesOfCode(code: string): string[] {
  if (code === 'V2' || code === 'V3') return ['hyphen'];
  if (code.startsWith('B')) return ['bidi'];
  if (code.startsWith('C')) return ['joiner'];
  if (code === 'U1') return ['std3'];
  if (code === 'A4_1' || code === 'A4_2') return ['length', 'empty-label'];
  if (code === 'X4_2') return ['empty-label'];
  return ['processing'];
}
