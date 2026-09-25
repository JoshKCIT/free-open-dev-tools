import meta from './meta.json';
import { parseCsv, CsvSyntaxError } from './csv';
import { parseJsonText, exceedsDepth, MAX_JSON_DEPTH } from './json-text';
import { hasOwn, getOwn } from './own-property';
import {
  quoteIdentifier,
  quoteString,
  quoteBoolean,
  TYPE_NAMES,
  DIALECTS,
  type Dialect,
  type SqlTypeKind,
} from './dialects';

export { meta, DIALECTS };
export type { Dialect };

const DEPTH_MESSAGE =
  'This document is nested more than 512 levels deep, so it was refused rather than risk freezing the tab.';

/** No dialect in this package needs more than this many rows per INSERT; SQL Server's own table-value-constructor limit (1,000) is the tightest of the four, so every dialect uses it uniformly. */
const MAX_INSERT_ROWS = 1000;

export class DataToSqlError extends Error {
  readonly line?: number;
  readonly column?: number;
  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'DataToSqlError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export interface DataToSqlOptions {
  /** 'json' (an array of objects) or 'csv' (a header row plus data rows). Default 'json'. */
  format?: 'json' | 'csv';
  dialect?: Dialect;
  /** Default 'my_table'. */
  table?: string;
  /** Write a CREATE TABLE statement before the INSERT statements. Default true. */
  createTable?: boolean;
  /** CSV only: turn true, false and RFC 8259 numbers into those values, and an empty cell into NULL. Default true. */
  inferTypes?: boolean;
  /** CSV only. Default ','. */
  delimiter?: string;
}

export interface DataToSqlResult {
  output: string;
  columns: number;
  rows: number;
  warnings: string[];
}

function inferCsvCell(cell: string): unknown {
  if (cell === '') return null;
  if (cell === 'true') return true;
  if (cell === 'false') return false;
  // RFC 8259's number grammar, matched over the whole cell.
  if (/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(cell)) return Number(cell);
  return cell;
}

interface ReadResult {
  columnNames: string[];
  /** One entry per data row, aligned to `columnNames`; `undefined` marks a value missing from that row (JSON only). */
  rows: unknown[][];
}

function readCsv(text: string, inferTypes: boolean, delimiter: string): ReadResult {
  let parsed;
  try {
    parsed = parseCsv(text, { delimiter });
  } catch (err) {
    if (err instanceof CsvSyntaxError) throw new DataToSqlError(err.message, { line: err.line, column: err.column });
    throw err;
  }
  const { rows } = parsed;
  if (rows.length === 0) throw new DataToSqlError('The input has no rows.');

  const [headerRow, ...dataRows] = rows;
  const columnNames = headerRow!;
  const seen = new Set<string>();
  for (const name of columnNames) {
    if (name === '') throw new DataToSqlError('The header row has an empty column name.');
    if (seen.has(name)) throw new DataToSqlError(`The header row repeats the column name "${name}".`);
    seen.add(name);
  }

  const valueRows = dataRows.map((row, i) => {
    if (row.length !== columnNames.length) {
      throw new DataToSqlError(
        `Row ${i + 2} has ${row.length} field${row.length === 1 ? '' : 's'}, but the header has ${columnNames.length}.`,
      );
    }
    return row.map((cell) => (inferTypes ? inferCsvCell(cell) : (cell as unknown)));
  });

  return { columnNames, rows: valueRows };
}

function readJson(text: string): ReadResult {
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    throw new DataToSqlError(parsed.message ?? 'The document could not be parsed.', {
      line: parsed.line,
      column: parsed.column,
    });
  }
  if (exceedsDepth(parsed.value, MAX_JSON_DEPTH)) throw new DataToSqlError(DEPTH_MESSAGE);

  const value = parsed.value;
  if (!Array.isArray(value)) throw new DataToSqlError('The input must be a JSON array of objects.');

  // Columns are the union of keys in first-appearance order. A Map (not a
  // plain object) tracks which keys have been seen, so a key such as
  // __proto__ in the source document cannot influence this bookkeeping the
  // way a plain-object property assignment could.
  const columnOrder: string[] = [];
  const columnSeen = new Map<string, true>();
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new DataToSqlError('Every element of the input array must be a JSON object.');
    }
    for (const key of Object.keys(item as Record<string, unknown>)) {
      if (!columnSeen.has(key)) {
        columnSeen.set(key, true);
        columnOrder.push(key);
      }
    }
  }

  const rows = (value as Record<string, unknown>[]).map((item) =>
    columnOrder.map((key) => (hasOwn(item, key) ? getOwn(item, key) : undefined)),
  );

  return { columnNames: columnOrder, rows };
}

function toTextValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function numericKindOf(value: number): 'integer' | 'bigint' | 'double' {
  if (!Number.isInteger(value)) return 'double';
  if (value >= -2147483648 && value <= 2147483647) return 'integer';
  if (Number.isSafeInteger(value)) return 'bigint';
  return 'double';
}

const NUMERIC_WIDTH: Record<'integer' | 'bigint' | 'double', number> = { integer: 0, bigint: 1, double: 2 };

interface ColumnPlan {
  name: string;
  kind: SqlTypeKind;
  notNull: boolean;
}

/**
 * A column's kind comes from the coarse kinds (boolean, number, string, or
 * object/array meaning json) seen among its non-null values. Exactly one
 * coarse kind present gives that kind directly, widening a number column to
 * the narrowest of integer, bigint or double that fits every value seen.
 * More than one coarse kind falls back to text, with a warning naming the
 * column. A column with no non-null value anywhere defaults to text.
 */
function planColumns(columnNames: string[], rows: unknown[][]): { columns: ColumnPlan[]; warnings: string[] } {
  const warnings: string[] = [];
  const columns = columnNames.map((name, colIndex): ColumnPlan => {
    let notNull = true;
    const coarseKinds = new Set<'boolean' | 'number' | 'string' | 'json'>();
    let numeric: 'integer' | 'bigint' | 'double' = 'integer';

    for (const row of rows) {
      const value = row[colIndex];
      if (value === undefined || value === null) {
        notNull = false;
        continue;
      }
      if (typeof value === 'boolean') {
        coarseKinds.add('boolean');
      } else if (typeof value === 'number') {
        coarseKinds.add('number');
        const k = numericKindOf(value);
        if (NUMERIC_WIDTH[k] > NUMERIC_WIDTH[numeric]) numeric = k;
      } else if (typeof value === 'string') {
        coarseKinds.add('string');
      } else {
        coarseKinds.add('json');
      }
    }

    if (coarseKinds.size === 0) return { name, kind: 'text', notNull: false };
    if (coarseKinds.size > 1) {
      warnings.push(`Column "${name}" has mixed value kinds and was written as text.`);
      return { name, kind: 'text', notNull };
    }
    const only = [...coarseKinds][0]!;
    if (only === 'boolean') return { name, kind: 'boolean', notNull };
    if (only === 'string') return { name, kind: 'text', notNull };
    if (only === 'json') return { name, kind: 'json', notNull };
    return { name, kind: numeric, notNull };
  });
  return { columns, warnings };
}

function cellLiteral(dialect: Dialect, kind: SqlTypeKind, value: unknown, colName: string, rowNumber: number): string {
  if (value === undefined || value === null) return 'NULL';
  try {
    if (kind === 'boolean') return quoteBoolean(dialect, Boolean(value));
    if (kind === 'integer' || kind === 'bigint' || kind === 'double') {
      return typeof value === 'number' ? String(value) : quoteString(dialect, toTextValue(value));
    }
    if (kind === 'json') return quoteString(dialect, JSON.stringify(value));
    return quoteString(dialect, toTextValue(value));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new DataToSqlError(`Column "${colName}", row ${rowNumber}: ${message}`);
  }
}

function quoteIdentifierOrThrow(dialect: Dialect, name: string): string {
  try {
    return quoteIdentifier(dialect, name);
  } catch (err) {
    throw new DataToSqlError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Turns a JSON array of objects, or CSV text with a header row, into an
 * optional CREATE TABLE statement followed by one or more multi-row INSERT
 * statements (at most 1,000 rows each) for the chosen SQL dialect. No key or
 * index is invented; the only constraint ever written is NOT NULL, and only
 * for a column that has a value in every row.
 */
export function dataToSql(text: string, options: DataToSqlOptions = {}): DataToSqlResult {
  const format = options.format ?? 'json';
  const dialect = options.dialect ?? 'postgresql';
  const table = options.table ?? 'my_table';
  const createTable = options.createTable ?? true;
  const inferTypes = options.inferTypes ?? true;
  const delimiter = options.delimiter ?? ',';

  const { columnNames, rows } = format === 'csv' ? readCsv(text, inferTypes, delimiter) : readJson(text);

  if (columnNames.length === 0) {
    return { output: '', columns: 0, rows: 0, warnings: [] };
  }

  const quotedTable = quoteIdentifierOrThrow(dialect, table);
  const { columns, warnings } = planColumns(columnNames, rows);
  const quotedColumnNames = columns.map((col) => quoteIdentifierOrThrow(dialect, col.name));

  const statements: string[] = [];

  if (createTable) {
    const lines = columns.map((col, i) => {
      const typeName = TYPE_NAMES[dialect][col.kind];
      return `  ${quotedColumnNames[i]} ${typeName}${col.notNull ? ' NOT NULL' : ''}`;
    });
    statements.push(`CREATE TABLE ${quotedTable} (\n${lines.join(',\n')}\n);`);
  }

  for (let start = 0; start < rows.length; start += MAX_INSERT_ROWS) {
    const batch = rows.slice(start, start + MAX_INSERT_ROWS);
    const tuples = batch.map((row, i) => {
      const rowNumber = start + i + 1;
      const values = columns.map((col, colIndex) => cellLiteral(dialect, col.kind, row[colIndex], col.name, rowNumber));
      return `  (${values.join(', ')})`;
    });
    statements.push(`INSERT INTO ${quotedTable} (${quotedColumnNames.join(', ')}) VALUES\n${tuples.join(',\n')};`);
  }

  return { output: statements.join('\n\n'), columns: columns.length, rows: rows.length, warnings };
}
