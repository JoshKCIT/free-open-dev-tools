import { SpfDmarcError, type SpfDmarcPart } from './errors';
import { MAX_RECORDS, boxName, checkPaste, withCommas } from './limits';

/** One record read from a box: the text of the record and where it came from. */
export interface TxtRecord {
  /** The owner name of a zone-file line, or null for a bare record. */
  label: string | null;
  /** The record as one string: its quoted strings joined with no space added (RFC 7208 section 3.3). */
  text: string;
  /** The quoted strings as written, each already unescaped. Empty for a bare record. */
  strings: string[];
  /** Things worth saying about how the box was read. */
  warnings: string[];
  /** The 1-based line of the box the record starts on. */
  line: number;
}

const NEWLINE = 10;
const RETURN = 13;
const SPACE = 32;
const TAB = 9;
const QUOTE = 34;
const SEMICOLON = 59;
const OPEN = 40;
const CLOSE = 41;
const BACKSLASH = 92;
const CURLY_OPEN = 0x201c;
const CURLY_CLOSE = 0x201d;

const NOTE_CURLY = 'Curly quotes were replaced with straight quotes.';
const NOTE_UNCLOSED = 'A string has no closing quote; it was read to the end of the line.';
const NOTE_SPF_TYPE =
  'The SPF record type (type 99) is no longer used; publish the record as a TXT record (RFC 7208 section 3.1).';

function isBlank(code: number): boolean {
  return code === SPACE || code === TAB || code === RETURN;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

interface Token {
  kind: 'word' | 'string';
  text: string;
}

const CLASSES: ReadonlySet<string> = new Set(['IN', 'CS', 'CH', 'HS']);

/** A time to live: digits, or digits with a BIND unit letter (1h, 30m, 2d, 1w, 45s). */
function isTtl(word: string): boolean {
  if (word.length === 0) return false;
  let i = 0;
  while (i < word.length && isDigit(word.charCodeAt(i))) i++;
  if (i === 0) return false;
  return i === word.length || (i === word.length - 1 && 'smhdwSMHDW'.includes(word.charAt(i)));
}

/**
 * Reads a box into records. A line that starts with v= is a bare record. Any other line is a zone-file entry: an optional
 * owner name, an optional time to live and class, the type word TXT (or the old SPF), and one or more quoted strings,
 * which may continue over several lines inside parentheses. Quotes are read before comment characters, so a semicolon
 * inside a string is data; outside one it starts a comment that runs to the end of the line.
 */
export function readTxtRecords(text: string, part: SpfDmarcPart = 'spf'): TxtRecord[] {
  checkPaste(text, part);
  const records: TxtRecord[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;

  const push = (record: TxtRecord, offset: number): void => {
    if (records.length >= MAX_RECORDS) {
      throw new SpfDmarcError(
        `The ${boxName(part)} holds more than ${MAX_RECORDS} records. The limit is ${MAX_RECORDS}, so the record that starts at character ${withCommas(offset + 1)} and the rest were not read.`,
        part,
        offset + 1,
      );
    }
    records.push(record);
  };

  while (i < n) {
    // The start of an entry: skip blanks, blank lines and comment lines.
    while (i < n && isBlank(text.charCodeAt(i))) i++;
    if (i >= n) break;
    const first = text.charCodeAt(i);
    if (first === NEWLINE) {
      i++;
      line++;
      continue;
    }
    if (first === SEMICOLON) {
      while (i < n && text.charCodeAt(i) !== NEWLINE) i++;
      continue;
    }
    const entryStart = i;
    const entryLine = line;

    // A bare record: the whole line is the record, kept exactly as typed (a tab or a semicolon is data here).
    if ((first === 118 || first === 86) && text.charCodeAt(i + 1) === 61) {
      let end = text.indexOf('\n', i);
      if (end < 0) end = n;
      let stop = end;
      if (stop > i && text.charCodeAt(stop - 1) === RETURN) stop--;
      push({ label: null, text: text.slice(i, stop), strings: [], warnings: [], line: entryLine }, entryStart);
      i = end;
      continue;
    }

    // A zone-file entry: words and quoted strings up to the end of the line, or past it while parentheses are open.
    const tokens: Token[] = [];
    const warnings: string[] = [];
    let depth = 0;
    let sawCurly = false;
    let sawUnclosed = false;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === NEWLINE) {
        i++;
        line++;
        if (depth === 0) break;
        continue;
      }
      if (isBlank(c)) {
        i++;
        continue;
      }
      if (c === SEMICOLON) {
        while (i < n && text.charCodeAt(i) !== NEWLINE) i++;
        continue;
      }
      if (c === OPEN) {
        depth++;
        i++;
        continue;
      }
      if (c === CLOSE) {
        if (depth > 0) depth--;
        i++;
        continue;
      }
      if (c === QUOTE || c === CURLY_OPEN) {
        if (c === CURLY_OPEN) sawCurly = true;
        const parts: string[] = [];
        let segment = i + 1;
        let j = i + 1;
        let closed = false;
        while (j < n) {
          const d = text.charCodeAt(j);
          if (d === QUOTE || d === CURLY_CLOSE) {
            if (d === CURLY_CLOSE) sawCurly = true;
            closed = true;
            break;
          }
          if (d === NEWLINE) break;
          if (d === BACKSLASH && j + 1 < n) {
            parts.push(text.slice(segment, j));
            const e = text.charCodeAt(j + 1);
            if (isDigit(e) && j + 3 < n && isDigit(text.charCodeAt(j + 2)) && isDigit(text.charCodeAt(j + 3))) {
              const value = Number(text.slice(j + 1, j + 4));
              parts.push(String.fromCharCode(value > 255 ? 63 : value));
              j += 4;
            } else if (e === NEWLINE) {
              j += 1;
            } else {
              parts.push(text.charAt(j + 1));
              j += 2;
            }
            segment = j;
            continue;
          }
          j++;
        }
        parts.push(text.slice(segment, j));
        if (!closed) sawUnclosed = true;
        tokens.push({ kind: 'string', text: parts.join('') });
        i = closed ? j + 1 : j;
        continue;
      }
      // A word ends at a blank, a quote, a comment or a parenthesis.
      let j = i;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (
          isBlank(d) ||
          d === NEWLINE ||
          d === QUOTE ||
          d === SEMICOLON ||
          d === OPEN ||
          d === CLOSE ||
          d === CURLY_OPEN
        )
          break;
        j++;
      }
      tokens.push({ kind: 'word', text: text.slice(i, j) });
      i = j;
    }
    if (tokens.length === 0) continue;
    const firstString = tokens.findIndex((t) => t.kind === 'string');
    if (firstString < 0) {
      // No quoted string: not a zone-file entry, so the line is read as a bare record exactly as typed.
      let end = text.indexOf('\n', entryStart);
      if (end < 0) end = n;
      let stop = end;
      if (stop > entryStart && text.charCodeAt(stop - 1) === RETURN) stop--;
      push({ label: null, text: text.slice(entryStart, stop), strings: [], warnings: [], line: entryLine }, entryStart);
      continue;
    }
    const head = tokens.slice(0, firstString).map((t) => t.text);
    const strings = tokens.filter((t) => t.kind === 'string').map((t) => t.text);
    const type = head.length > 0 ? (head[head.length - 1] ?? '').toUpperCase() : '';
    if (type === 'SPF') warnings.push(NOTE_SPF_TYPE);
    const owner = head[0];
    const hasLabel = owner !== undefined && head.length > 1 && !isTtl(owner) && !CLASSES.has(owner.toUpperCase());
    if (sawCurly) warnings.push(NOTE_CURLY);
    if (sawUnclosed) warnings.push(NOTE_UNCLOSED);
    push({ label: hasLabel ? owner : null, text: strings.join(''), strings, warnings, line: entryLine }, entryStart);
  }
  return records;
}
