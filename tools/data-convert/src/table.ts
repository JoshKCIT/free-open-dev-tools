/**
 * CSV and TSV as tables of records.
 *
 * Reading (CSV by RFC 4180, TSV by the IANA text/tab-separated-values registration):
 *  - with a header row, the result is a list of objects keyed by the header; an empty header becomes `column_N` (its
 *    1-based position) and a repeated one gets `_2`, `_3`, with a warning; without one, a list of lists of text;
 *  - every row must have as many fields as the first; one more or one fewer is refused, naming the row and its line;
 *  - every value is text unless `inferTypes` is on; then only `true`, `false`, `null` and RFC 8259 numbers that a
 *    double holds exactly become typed values, and any other number (a whole number beyond 2^53, one with more digits
 *    than a double keeps) stays text, with a warning;
 *  - blank lines at the very end are ignored, with a warning.
 *
 * Writing (a list of objects, a list of lists of scalars, or one object that is one row):
 *  - nested objects flatten to dotted column names; a key that itself holds a dot is refused, because it would read
 *    back as nesting; any array below a row is refused naming its path; lists of unequal length are refused naming the
 *    row; records with different keys share one header of every key in order of first appearance, with a warning;
 *    null and a missing key both become an empty cell, with a warning;
 *  - TSV also refuses a cell or a key holding a tab or a line break, because TSV has no way to quote it.
 *
 * Every refusal is a `DataConvertError`; one about a value carries an RFC 6901 `path`, one about input rows a `line`.
 */
import { parseCsv, formatCsv, CsvSyntaxError } from './csv';
import { DataConvertError } from './errors';
import { formatPointer } from './pointer';

export type TableFormat = 'csv' | 'tsv';

export interface TableReadOptions {
  /** The first row names the columns. */
  headerRow: boolean;
  /** Read true, false, null and numbers as typed values. */
  inferTypes: boolean;
}

export interface TableReadResult {
  value: unknown;
  warnings: string[];
}

export interface TableWriteResult {
  text: string;
  warnings: string[];
}

/** Sets an own, enumerable data property even for a key such as `__proto__`, which plain assignment would turn into a prototype change. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function fieldCount(n: number): string {
  return n === 1 ? '1 field' : `${n} fields`;
}

const LINE_BREAKS = /\r\n|\n|\r/g;

/** The 1-based line each CSV record starts on, counting the line breaks held inside quoted fields. */
function csvRecordLines(rows: string[][]): number[] {
  const lines: number[] = [];
  let line = 1;
  for (const row of rows) {
    lines.push(line);
    line += 1 + (row.join('').match(LINE_BREAKS)?.length ?? 0);
  }
  return lines;
}

/** Headers made unique: an empty one becomes column_N, a repeated one gets _2, _3. */
function uniqueHeaders(header: string[]): { names: string[]; renamed: string[] } {
  const used = new Set<string>();
  const names: string[] = [];
  const renamed: string[] = [];
  header.forEach((raw, index) => {
    const base = raw === '' ? `column_${index + 1}` : raw;
    let name = base;
    if (used.has(name)) {
      let n = 2;
      while (used.has(`${base}_${n}`)) n++;
      name = `${base}_${n}`;
    }
    if (name !== raw) renamed.push(name);
    used.add(name);
    names.push(name);
  });
  return { names, renamed };
}

/** The grammar of a JSON number, RFC 8259 section 6. */
const JSON_NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

interface InferState {
  stayedText: boolean;
}

/** True when a double holds `cell` exactly enough that writing the number back gives the same value. */
function numberIsExact(cell: string, n: number): boolean {
  if (!Number.isFinite(n) || Object.is(n, -0)) return false;
  const mantissa = cell.replace(/^-/, '').split(/[eE]/)[0]!;
  const isPlainInteger = !/[.eE]/.test(cell);
  if (isPlainInteger) return Number.isSafeInteger(n);
  const significant = mantissa.replace('.', '').replace(/^0+/, '').replace(/0+$/, '');
  if (significant === '') return n === 0;
  return n !== 0 && significant.length <= 15;
}

function inferCell(cell: string, state: InferState): unknown {
  if (cell === 'true') return true;
  if (cell === 'false') return false;
  if (cell === 'null') return null;
  if (!JSON_NUMBER.test(cell)) return cell;
  const n = Number(cell);
  if (!numberIsExact(cell, n)) {
    state.stayedText = true;
    return cell;
  }
  return n;
}

/** Reads CSV or TSV text by the rules at the top of this file. */
export function readTable(text: string, format: TableFormat, options: TableReadOptions): TableReadResult {
  const warnings: string[] = [];
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  let rows: string[][];
  let lines: number[];
  if (format === 'csv') {
    try {
      rows = parseCsv(source).rows;
    } catch (err) {
      if (err instanceof CsvSyntaxError)
        throw new DataConvertError(err.message, { line: err.line, column: err.column });
      throw err;
    }
    lines = csvRecordLines(rows);
  } else {
    // One record per line; a final line break ends the last record and starts no new one.
    const parts = source.split(LINE_BREAKS);
    if (parts[parts.length - 1] === '') parts.pop();
    rows = parts.map((line) => line.split('\t'));
    lines = rows.map((_, i) => i + 1);
  }

  let blankTail = 0;
  while (rows.length > 0 && rows[rows.length - 1]!.length === 1 && rows[rows.length - 1]![0] === '') {
    rows.pop();
    lines.pop();
    blankTail++;
  }
  if (blankTail > 0) warnings.push('Blank lines at the end of the input were ignored.');

  if (rows.length === 0) return { value: [], warnings };

  const width = rows[0]!.length;
  for (let i = 1; i < rows.length; i++) {
    const got = rows[i]!.length;
    if (got !== width) {
      const expected = options.headerRow ? `the header (row 1) has ${width}` : `row 1 has ${width}`;
      throw new DataConvertError(`Row ${i + 1} has ${fieldCount(got)}, but ${expected}.`, { line: lines[i] });
    }
  }

  const state: InferState = { stayedText: false };
  const cellValue = (cell: string): unknown => (options.inferTypes ? inferCell(cell, state) : cell);

  let value: unknown;
  if (options.headerRow) {
    const { names, renamed } = uniqueHeaders(rows[0]!);
    if (renamed.length > 0) {
      warnings.push(`Some headers were empty or repeated, so they were renamed: ${renamed.join(', ')}.`);
    }
    if (rows.length === 1) {
      warnings.push('The table has a header and no rows, so the result is an empty list; the header is not in it.');
    }
    value = rows.slice(1).map((row) => {
      const record: Record<string, unknown> = {};
      names.forEach((name, i) => setOwn(record, name, cellValue(row[i]!)));
      return record;
    });
  } else {
    value = rows.map((row) => row.map(cellValue));
  }

  if (state.stayedText) {
    warnings.push(
      'Numbers a JSON number cannot hold exactly (whole numbers beyond 2^53, or more digits than a double keeps) stayed text.',
    );
  }
  return { value, warnings };
}

/** True for a plain object (one made by `{}`, JSON or `Object.create(null)`); a Date, a byte array, a Set or a Map is not one. */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

interface WriteState {
  format: TableFormat;
  nullSeen: boolean;
  emptyObjectSeen: boolean;
}

function refuse(message: string, tokens: string[]): never {
  throw new DataConvertError(message, { path: formatPointer(tokens) });
}

/** The text of one cell, refusing what the format cannot hold. */
function cellText(value: unknown, tokens: string[], state: WriteState): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') text = String(value);
  else if (value === null) {
    state.nullSeen = true;
    text = '';
  } else {
    return refuse('A cell must be text, a number, true, false or null.', tokens);
  }
  if (state.format === 'tsv' && /[\t\r\n]/.test(text)) {
    refuse('This value holds a tab or a line break, which a TSV cell cannot hold.', tokens);
  }
  return text;
}

/** Flattens one record into [column, cell] pairs, nested objects becoming dotted column names. */
function flatten(
  record: Record<string, unknown>,
  tokens: string[],
  prefix: string,
  out: [string, string][],
  state: WriteState,
): void {
  for (const key of Object.keys(record)) {
    const here = [...tokens, key];
    if (key === '') refuse('An empty key cannot be a column name.', here);
    if (key.includes('.')) {
      refuse(`The key "${key}" contains a dot, which would read back as nesting, so it cannot be a column name.`, here);
    }
    if (state.format === 'tsv' && /[\t\r\n]/.test(key)) {
      refuse('This key holds a tab or a line break, which a TSV header cannot hold.', here);
    }
    const column = prefix === '' ? key : `${prefix}.${key}`;
    const child = record[key];
    if (Array.isArray(child)) refuse('Arrays inside a record cannot be flattened into columns.', here);
    if (isRecord(child)) {
      if (Object.keys(child).length === 0) {
        state.emptyObjectSeen = true;
        out.push([column, '']);
      } else {
        flatten(child, here, column, out, state);
      }
    } else {
      out.push([column, cellText(child, here, state)]);
    }
  }
}

/** Writes a list of objects, a list of lists, or one object as CSV or TSV text by the rules at the top of this file. */
export function writeTable(value: unknown, format: TableFormat): TableWriteResult {
  const state: WriteState = { format, nullSeen: false, emptyObjectSeen: false };
  const warnings: string[] = [];
  let rows: string[][];

  if (isRecord(value) || (Array.isArray(value) && value.length > 0 && isRecord(value[0]))) {
    const records = Array.isArray(value) ? value : [value];
    const base = Array.isArray(value) ? (i: number) => [String(i)] : () => [];
    const flat: [string, string][][] = [];
    records.forEach((record, i) => {
      if (!isRecord(record)) {
        refuse(`Row ${i + 1} is not an object, but row 1 is, and a table needs every row alike.`, [String(i)]);
      }
      const entries: [string, string][] = [];
      flatten(record as Record<string, unknown>, base(i), '', entries, state);
      flat.push(entries);
    });

    const columns: string[] = [];
    const seen = new Set<string>();
    for (const entries of flat) {
      for (const [column] of entries) {
        if (!seen.has(column)) {
          seen.add(column);
          columns.push(column);
        }
      }
    }
    if (columns.length === 0) {
      return { text: '', warnings: ['The records have no keys, so there is nothing to write.'] };
    }
    if (flat.some((entries) => entries.length !== columns.length)) {
      warnings.push(
        'Some records have different keys, so the header lists every key in order of first appearance and missing values are empty cells.',
      );
    }
    rows = [columns];
    for (const entries of flat) {
      const byColumn = new Map(entries);
      rows.push(columns.map((column) => byColumn.get(column) ?? ''));
    }
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      return { text: '', warnings: ['The list was empty, so there is nothing to write.'] };
    }
    if (!Array.isArray(value[0])) {
      refuse('Each item must be an object (a row with a header) or a list (a row of cells).', ['0']);
    }
    const width = (value[0] as unknown[]).length;
    rows = value.map((row, i) => {
      if (!Array.isArray(row)) {
        return refuse(`Row ${i + 1} is not a list, but row 1 is, and a table needs every row alike.`, [String(i)]);
      }
      if (row.length !== width) {
        return refuse(`Row ${i + 1} has ${row.length} cells, but row 1 has ${width}.`, [String(i)]);
      }
      return row.map((cell, j) => cellText(cell, [String(i), String(j)], state));
    });
  } else {
    throw new DataConvertError('A CSV or TSV table needs a list of objects, a list of lists, or one object.');
  }

  if (state.nullSeen) {
    warnings.push('A null became an empty cell, so it reads back as empty text, not null.');
  }
  if (state.emptyObjectSeen) {
    warnings.push('An empty object became an empty cell.');
  }
  const text =
    format === 'csv' ? formatCsv(rows, { lineEnding: '\r\n' }) : rows.map((row) => row.join('\t')).join('\n');
  return { text, warnings };
}
