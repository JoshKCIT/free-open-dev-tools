import initSqlJs from 'sql.js';
import meta from './meta.json';
import { formatCsv } from './csv';

export { meta };

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>;
type SqlDatabase = InstanceType<SqlJsStatic['Database']>;
type SqlStatement = ReturnType<SqlDatabase['prepare']>;

/** Raised with SQLite's own message for every error the engine reports. No partial result ever goes with it. */
export class SqliteViewerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqliteViewerError';
  }
}

/** The largest database accepted: 100 MiB, because the file is copied into memory up to three times. */
export const MAX_DATABASE_BYTES = 104857600;
/** The most rows one result may show at once (the visitor may ask for 100). */
export const MAX_DISPLAY_ROWS = 500;
/** The most rows one export carries per result. */
export const MAX_EXPORT_ROWS = 200000;

export interface SqliteRunOptions {
  displayRows: 100 | 500;
  exportFormat: 'none' | 'csv' | 'json';
  includeDatabase: boolean;
}

export interface SqliteColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: boolean;
  /** SQLite's text for the default, quotes included; empty when the column has no default. */
  dflt_value: string;
  /** 0 when the column is not part of the primary key, otherwise its 1-based position in it. */
  pk: number;
}

export interface SqliteSchemaEntry {
  type: 'table' | 'view' | 'index' | 'trigger';
  name: string;
  table: string;
  sql: string;
  columns: SqliteColumnInfo[];
}

export interface SqliteResultSet {
  statement: string;
  columns: string[];
  rows: string[][];
  total: number;
  truncated: boolean;
}

export interface SqliteExport {
  name: string;
  mime: string;
  content: string;
}

export interface SqliteRunResult {
  schema: SqliteSchemaEntry[];
  results: SqliteResultSet[];
  changes: number;
  statements: number;
  exports: SqliteExport[];
  database?: Uint8Array;
  warnings: string[];
}

let engine: SqlJsStatic | undefined;
let loading: Promise<void> | undefined;

/** The text of an engine failure, or a plain fallback when it carries none. */
function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'SQLite reported an error without a message.';
}

/**
 * Hands the sql.js WebAssembly bytes to the engine, once. The bytes are copied into a fresh ArrayBuffer so a
 * view with an offset (a Node Buffer) can never hand the engine somebody else's memory. `wasmBinary` is the only
 * way the engine is started, so no file is ever located or fetched.
 */
export function loadEngine(wasmBinary: Uint8Array): Promise<void> {
  if (engine) return Promise.resolve();
  if (!loading) {
    const copy = new ArrayBuffer(wasmBinary.byteLength);
    new Uint8Array(copy).set(wasmBinary);
    loading = initSqlJs({ wasmBinary: copy }).then(
      (loaded) => {
        engine = loaded;
      },
      (err: unknown) => {
        // A failed load can be tried again with fresh bytes; it is never half-loaded.
        loading = undefined;
        throw new SqliteViewerError(messageOf(err));
      },
    );
  }
  return loading;
}

type Cell = number | bigint | string | Uint8Array | null;

/** Uppercase hex of the first `count` bytes, the way SQLite's own hex() writes it. */
function hexOf(bytes: Uint8Array, count: number): string {
  let hex = '';
  const shown = Math.min(bytes.length, count);
  for (let i = 0; i < shown; i++) hex += (bytes[i] as number).toString(16).padStart(2, '0');
  return hex.toUpperCase();
}

/**
 * A REAL as the SQLite shell prints it: a whole number keeps its point (1.0, -0.0, so it is not read as an INTEGER) and
 * infinity is Inf. (Integers arrive as bigint, so every number here is a REAL.)
 */
function showReal(value: number): string {
  if (value === Infinity) return 'Inf';
  if (value === -Infinity) return '-Inf';
  if (Object.is(value, -0)) return '-0.0';
  const text = String(value);
  return /^-?\d+$/.test(text) ? `${text}.0` : text;
}

/** The text shown for one value: NULL, an integer of any size, a REAL in its shortest form, text, or a BLOB as X'hex'. */
function showCell(value: Cell): string {
  if (value === null) return 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return showReal(value);
  if (typeof value === 'string') return value;
  return `X'${hexOf(value, 32)}${value.length > 32 ? '…' : ''}' (${value.length} bytes)`;
}

/** The text of one value in a CSV field: NULL is an empty field and a BLOB is written whole, as X'hex'. */
function csvCell(value: Cell): string {
  if (value === null) return '';
  if (value instanceof Uint8Array) return `X'${hexOf(value, value.length)}'`;
  return String(value);
}

/** The largest integer magnitude a JSON reader that uses doubles keeps exactly: 2 to the 53. */
const LARGEST_EXACT_INTEGER = 9007199254740992n;

/** Column names made unique for a JSON object: the second a is a_2, the third a_3, never colliding with another name. */
function uniqueNames(columns: string[]): { names: string[]; renamed: Map<string, string[]> } {
  const taken = new Set(columns);
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const renamed = new Map<string, string[]>();
  const names = columns.map((column) => {
    if (!seen.has(column)) {
      seen.add(column);
      return column;
    }
    let count = counts.get(column) ?? 1;
    let candidate: string;
    do {
      count += 1;
      candidate = `${column}_${count}`;
    } while (taken.has(candidate));
    counts.set(column, count);
    taken.add(candidate);
    renamed.set(column, [...(renamed.get(column) ?? []), candidate]);
    return candidate;
  });
  return { names, renamed };
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** One result as CSV per RFC 4180: records end with CRLF, the header comes first, no line break after the last record. */
function csvExport(n: number, columns: string[], rows: Cell[][]): SqliteExport {
  return {
    name: `query-${n}.csv`,
    mime: 'text/csv;charset=utf-8',
    content: formatCsv([columns, ...rows.map((row) => row.map(csvCell))]),
  };
}

/** One result as a JSON array of objects keyed by column; what cannot be kept exactly as a JSON number becomes text. */
function jsonExport(n: number, columns: string[], rows: Cell[][], warnings: string[]): SqliteExport {
  const { names, renamed } = uniqueNames(columns);
  for (const [column, later] of renamed) {
    warnings.push(
      `Result ${n} repeats the column name ${column}, so the JSON export writes the later ones as ${later.join(', ')}.`,
    );
  }
  let largeIntegers = 0;
  let nonFinite = 0;
  const objects = rows.map((row) => {
    // No prototype, so a column named __proto__ is an ordinary key.
    const object = Object.create(null) as Record<string, unknown>;
    row.forEach((value, i) => {
      const key = names[i] as string;
      if (value === null) object[key] = null;
      else if (typeof value === 'bigint') {
        if (value <= LARGEST_EXACT_INTEGER && value >= -LARGEST_EXACT_INTEGER) object[key] = Number(value);
        else {
          largeIntegers += 1;
          object[key] = value.toString();
        }
      } else if (typeof value === 'number') {
        if (Number.isFinite(value)) object[key] = value;
        else {
          nonFinite += 1;
          object[key] = String(value);
        }
      } else if (typeof value === 'string') object[key] = value;
      else object[key] = `X'${hexOf(value, value.length)}'`;
    });
    return object;
  });
  if (largeIntegers > 0) {
    warnings.push(
      `Result ${n}: ${largeIntegers} ${plural(largeIntegers, 'integer', 'integers')} outside plus or minus ${LARGEST_EXACT_INTEGER} ${plural(largeIntegers, 'is', 'are')} written as ${plural(largeIntegers, 'a string', 'strings')} in the JSON export, so no reader rounds ${plural(largeIntegers, 'it', 'them')}.`,
    );
  }
  if (nonFinite > 0) {
    warnings.push(
      `Result ${n}: ${nonFinite} ${plural(nonFinite, 'number', 'numbers')} that JSON cannot hold (Infinity) ${plural(nonFinite, 'is', 'are')} written as text in the JSON export.`,
    );
  }
  return { name: `query-${n}.json`, mime: 'application/json', content: JSON.stringify(objects, null, 2) };
}

/** One row of the current statement with 64-bit integers as exact bigint (the declarations omit the option). */
function readRow(statement: SqlStatement): Cell[] {
  const get = statement.get as unknown as (params: null, config: { useBigInt: boolean }) => Cell[];
  return get.call(statement, null, { useBigInt: true });
}

function quoteLiteral(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

function columnsOf(db: SqlDatabase, name: string): SqliteColumnInfo[] {
  try {
    const found = db.exec(`pragma table_info(${quoteLiteral(name)})`)[0];
    return (found?.values ?? []).map((row) => ({
      cid: Number(row[0]),
      name: String(row[1]),
      type: String(row[2]),
      notnull: Number(row[3]) !== 0,
      dflt_value: row[4] === null || row[4] === undefined ? '' : String(row[4]),
      pk: Number(row[5]),
    }));
  } catch {
    // A virtual table whose module this build does not have: list the object, without columns, rather than fail.
    return [];
  }
}

/** Tables, views, indexes and triggers in the order sqlite_master holds them; implicit indexes have no SQL and are left out. */
function readSchema(db: SqlDatabase): SqliteSchemaEntry[] {
  const found = db.exec(
    "select type, name, tbl_name, sql from sqlite_master where sql is not null and type in ('table', 'view', 'index', 'trigger') order by rowid",
  )[0];
  return (found?.values ?? []).map((row) => {
    const type = String(row[0]) as SqliteSchemaEntry['type'];
    const name = String(row[1]);
    return {
      type,
      name,
      table: String(row[2]),
      sql: String(row[3]),
      columns: type === 'table' || type === 'view' ? columnsOf(db, name) : [],
    };
  });
}

function totalChanges(db: SqlDatabase): number {
  return Number(db.exec('select total_changes()')[0]?.values[0]?.[0] ?? 0);
}

/** The size of a file for the refusal sentence, rounded up so a file over the limit never reads as the limit itself. */
function sizeText(byteLength: number): string {
  return `${(Math.ceil((byteLength / 1048576) * 10) / 10).toFixed(1)} MiB`;
}

/** Refuses a database over 100 MiB with a plain sentence. Called with the file's size before any byte of it is read. */
export function checkDatabaseSize(byteLength: number): void {
  if (byteLength <= MAX_DATABASE_BYTES) return;
  throw new SqliteViewerError(
    `This file is ${sizeText(byteLength)}. The limit is 100 MiB because the database is copied into memory up to three times while it is open.`,
  );
}

/**
 * Opens a fresh in-memory copy of `bytes` (an empty database for null), runs every statement of `sql` in order and
 * returns each result as text. The caller's array is never changed. Blank SQL returns the schema only. Every engine
 * error is thrown as SqliteViewerError with SQLite's own message, except a trap of the engine itself (out of memory),
 * which is thrown as it came so the caller can name it.
 */
export function runSqlite(bytes: Uint8Array | null, sql: string, options: SqliteRunOptions): SqliteRunResult {
  if (!engine) throw new SqliteViewerError('The SQLite engine has not been loaded yet.');
  if (bytes) checkDatabaseSize(bytes.byteLength);
  const wantsExport = options.exportFormat !== 'none';
  let db: SqlDatabase | undefined;
  try {
    db = bytes && bytes.byteLength > 0 ? new engine.Database(bytes) : new engine.Database();
    const changesBefore = totalChanges(db);
    const results: SqliteResultSet[] = [];
    const exports: SqliteExport[] = [];
    const warnings: string[] = [];
    let statements = 0;
    if (sql.trim() !== '') {
      for (const statement of db.iterateStatements(sql)) {
        statements += 1;
        const columns = statement.getColumnNames();
        if (columns.length === 0) {
          statement.step();
          statement.free();
          continue;
        }
        const rows: string[][] = [];
        const exportRows: Cell[][] = [];
        let total = 0;
        while (statement.step()) {
          total += 1;
          const shown = total <= options.displayRows;
          const exported = wantsExport && total <= MAX_EXPORT_ROWS;
          if (!shown && !exported) continue;
          const row = readRow(statement);
          if (shown) rows.push(row.map(showCell));
          if (exported) exportRows.push(row);
        }
        if (wantsExport) {
          const n = results.length + 1;
          if (total > MAX_EXPORT_ROWS) {
            warnings.push(`Result ${n} has ${total} rows. Its export holds the first ${MAX_EXPORT_ROWS}.`);
          }
          exports.push(
            options.exportFormat === 'csv'
              ? csvExport(n, columns, exportRows)
              : jsonExport(n, columns, exportRows, warnings),
          );
        }
        results.push({
          statement: statement.getSQL().trim(),
          columns,
          rows,
          total,
          truncated: total > rows.length,
        });
        statement.free();
      }
    }
    const changes = totalChanges(db) - changesBefore;
    const schema = readSchema(db);
    // Last, because exporting a database closes and reopens it inside the engine.
    const database = options.includeDatabase ? db.export() : undefined;
    return { schema, results, changes, statements, exports, ...(database ? { database } : {}), warnings };
  } catch (err) {
    if (err instanceof SqliteViewerError) throw err;
    if (err instanceof Error && (err.name === 'RuntimeError' || /^Aborted/.test(err.message))) throw err;
    throw new SqliteViewerError(messageOf(err));
  } finally {
    try {
      db?.close();
    } catch {
      // Closing a database the engine has already abandoned can fail; the run's own outcome is what matters.
    }
  }
}
