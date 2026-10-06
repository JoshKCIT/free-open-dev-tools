import type { SpfDmarcPart } from './errors';
import { checkPaste } from './limits';

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

const SPACE = 32;
const TAB = 9;
const QUOTE = 34;

function isBlank(code: number): boolean {
  return code === SPACE || code === TAB;
}

/**
 * Reads a box into records. A line is either a bare record or a zone-file line (a name, an optional time to live and class,
 * the word TXT and quoted strings). Blank lines and lines that start with a semicolon are skipped.
 */
export function readTxtRecords(text: string, part: SpfDmarcPart = 'spf'): TxtRecord[] {
  checkPaste(text, part);
  const records: TxtRecord[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index] ?? '';
    if (line.endsWith('\r')) line = line.slice(0, -1);
    let from = 0;
    while (from < line.length && isBlank(line.charCodeAt(from))) from++;
    if (from === line.length || line.charAt(from) === ';') continue;
    const body = line.slice(from);
    const quote = body.indexOf('"');
    if (quote < 0) {
      records.push({ label: null, text: body, strings: [], warnings: [], line: index + 1 });
      continue;
    }
    const words = body
      .slice(0, quote)
      .split(/[ \t]+/)
      .filter((word) => word !== '');
    const last = words[words.length - 1];
    if (last === undefined || last.toUpperCase() !== 'TXT') {
      records.push({ label: null, text: body, strings: [], warnings: [], line: index + 1 });
      continue;
    }
    const strings: string[] = [];
    let at = quote;
    while (at < body.length && body.charCodeAt(at) === QUOTE) {
      const close = body.indexOf('"', at + 1);
      if (close < 0) {
        strings.push(body.slice(at + 1));
        at = body.length;
        break;
      }
      strings.push(body.slice(at + 1, close));
      at = close + 1;
      while (at < body.length && isBlank(body.charCodeAt(at))) at++;
    }
    const first = words[0];
    const label = words.length > 1 && first !== undefined ? first : null;
    records.push({ label, text: strings.join(''), strings, warnings: [], line: index + 1 });
  }
  return records;
}
