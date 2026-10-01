import initSqlJs from 'sql.js';
import meta from './meta.json';

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

/** The text shown for one value: NULL, an integer of any size, a REAL in its shortest form, text, or a BLOB as X'hex'. */
function showCell(value: Cell): string {
  if (value === null) return 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  let hex = '';
  const shown = Math.min(value.length, 32);
  for (let i = 0; i < shown; i++) hex += (value[i] as number).toString(16).padStart(2, '0');
  return `X'${hex.toUpperCase()}${value.length > 32 ? '…' : ''}' (${value.length} bytes)`;
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

/**
 * Opens a fresh in-memory copy of `bytes` (an empty database for null), runs every statement of `sql` in order and
 * returns each result as text. The caller's array is never changed. Blank SQL returns the schema only. Every engine
 * error is thrown as SqliteViewerError with SQLite's own message, except a trap of the engine itself (out of memory),
 * which is thrown as it came so the caller can name it.
 */
export function runSqlite(bytes: Uint8Array | null, sql: string, options: SqliteRunOptions): SqliteRunResult {
  if (!engine) throw new SqliteViewerError('The SQLite engine has not been loaded yet.');
  let db: SqlDatabase | undefined;
  try {
    db = bytes && bytes.byteLength > 0 ? new engine.Database(bytes) : new engine.Database();
    const changesBefore = totalChanges(db);
    const results: SqliteResultSet[] = [];
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
        let total = 0;
        while (statement.step()) {
          total += 1;
          if (total <= options.displayRows) rows.push(readRow(statement).map(showCell));
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
    return { schema, results, changes, statements, exports: [], warnings: [] };
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
