import meta from './meta.json';
import { parseCsv, formatCsv, CsvSyntaxError } from './csv';
import { setOwn, hasOwn, getOwn } from './own-property';
import { parseJsonText, exceedsDepth, MAX_JSON_DEPTH } from './json-text';

export { meta };

const DEPTH_MESSAGE =
  'This document is nested more than 512 levels deep, so it was refused rather than risk freezing the tab.';

export class CsvJsonError extends Error {
  readonly line?: number;
  readonly column?: number;
  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'CsvJsonError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export interface CsvToJsonOptions {
  /** Field separator. Default ','. */
  delimiter?: string;
  /** Read the first row as column names. Default true. */
  header?: boolean;
  /** Turn true, false, null and RFC 8259 numbers into those values. Default false: every cell stays a string. */
  inferTypes?: boolean;
}

export interface CsvJsonResult {
  output: string;
  rows: number;
  columns: number;
}

function inferCell(cell: string): unknown {
  if (cell === 'true') return true;
  if (cell === 'false') return false;
  if (cell === 'null') return null;
  // RFC 8259's number grammar, matched over the whole cell.
  if (/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(cell)) return Number(cell);
  return cell;
}

/** Parses CSV text and returns pretty-printed JSON, either an array of header-keyed objects or an array of arrays. */
export function csvToJson(text: string, options: CsvToJsonOptions = {}): CsvJsonResult {
  const { delimiter = ',', header = true, inferTypes = false } = options;

  let parsed;
  try {
    parsed = parseCsv(text, { delimiter });
  } catch (err) {
    if (err instanceof CsvSyntaxError) throw new CsvJsonError(err.message, { line: err.line, column: err.column });
    throw err;
  }
  const { rows } = parsed;
  const cellValue = (cell: string): unknown => (inferTypes ? inferCell(cell) : cell);

  if (rows.length === 0) {
    return { output: JSON.stringify([], null, 2), rows: 0, columns: 0 };
  }

  if (!header) {
    const data = rows.map((row) => row.map(cellValue));
    const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
    return { output: JSON.stringify(data, null, 2), rows: rows.length, columns };
  }

  const [headerRow, ...dataRows] = rows;
  const columnNames = headerRow!;
  const seen = new Set<string>();
  for (const name of columnNames) {
    if (name === '') throw new CsvJsonError('The header row has an empty column name.');
    if (seen.has(name)) throw new CsvJsonError(`The header row repeats the column name "${name}".`);
    seen.add(name);
  }

  const data = dataRows.map((row, i) => {
    if (row.length !== columnNames.length) {
      throw new CsvJsonError(
        `Row ${i + 2} has ${row.length} field${row.length === 1 ? '' : 's'}, but the header has ${columnNames.length}.`,
      );
    }
    const obj: Record<string, unknown> = {};
    columnNames.forEach((name, col) => setOwn(obj, name, cellValue(row[col]!)));
    return obj;
  });

  return { output: JSON.stringify(data, null, 2), rows: dataRows.length, columns: columnNames.length };
}

export interface JsonToCsvOptions {
  /** Field separator. Default ','. */
  delimiter?: string;
  /** Write column names as the first row (array-of-objects input only). Default true. */
  header?: boolean;
  /** Quote every field, not only the ones RFC 4180 rule 6 requires. Default false. */
  quoteAll?: boolean;
  /** Record separator to write. Default 'crlf'. */
  lineEnding?: 'crlf' | 'lf';
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Parses JSON text (an array of objects, or an array of arrays) and returns CSV text. */
export function jsonToCsv(text: string, options: JsonToCsvOptions = {}): CsvJsonResult {
  const { delimiter = ',', header = true, quoteAll = false, lineEnding = 'crlf' } = options;

  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    throw new CsvJsonError(parsed.message ?? 'The document could not be parsed.', {
      line: parsed.line,
      column: parsed.column,
    });
  }
  if (exceedsDepth(parsed.value, MAX_JSON_DEPTH)) throw new CsvJsonError(DEPTH_MESSAGE);

  const value = parsed.value;
  if (!Array.isArray(value)) {
    throw new CsvJsonError('The input must be a JSON array of objects or a JSON array of arrays.');
  }

  const eol = lineEnding === 'lf' ? '\n' : '\r\n';
  if (value.length === 0) return { output: '', rows: 0, columns: 0 };

  const isObjectArray = value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item));
  const isArrayArray = value.every((item) => Array.isArray(item));
  if (!isObjectArray && !isArrayArray) {
    throw new CsvJsonError(
      'The input must be a JSON array of objects or a JSON array of arrays, not a mix of the two.',
    );
  }

  let rows: string[][];
  let columnCount: number;
  let dataRowCount: number;

  if (isObjectArray) {
    const columns: string[] = [];
    const known = new Set<string>();
    for (const item of value as Record<string, unknown>[]) {
      for (const key of Object.keys(item)) {
        if (!known.has(key)) {
          known.add(key);
          columns.push(key);
        }
      }
    }
    const dataRows = (value as Record<string, unknown>[]).map((item) =>
      columns.map((col) => (hasOwn(item, col) ? cellText(getOwn(item, col)) : '')),
    );
    rows = header ? [columns, ...dataRows] : dataRows;
    columnCount = columns.length;
    dataRowCount = dataRows.length;
  } else {
    const dataRows = (value as unknown[][]).map((row) => row.map(cellText));
    rows = dataRows;
    columnCount = dataRows.reduce((max, row) => Math.max(max, row.length), 0);
    dataRowCount = dataRows.length;
  }

  const output = formatCsv(rows, { delimiter, lineEnding: eol, quoteAll });
  return { output, rows: dataRowCount, columns: columnCount };
}
