import meta from './meta.json';
import { format, supportedDialects, type SqlLanguage } from 'sql-formatter';
import { minifySql as minifySqlImpl } from './minify';

export { meta };
export { minifySql } from './minify';

export type SqlFormatterMode = 'format' | 'minify';

export interface FormatSqlOptions {
  mode?: SqlFormatterMode;
  dialect?: string;
  /** Ignored in minify mode. */
  keywordCase?: 'preserve' | 'upper' | 'lower';
  /** Ignored in minify mode. */
  indent?: number;
}

export interface FormatSqlResult {
  output: string;
  warnings: string[];
}

export class SqlFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'SqlFormatterError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

/** Readable labels for every dialect the pinned sql-formatter package supports. `tsql` is `transactsql`'s own alias in that package, so it is left out here rather than offered twice under two names for the same formatter. */
const DIALECT_LABELS: Record<string, string> = {
  sql: 'Standard SQL',
  bigquery: 'GCP BigQuery',
  clickhouse: 'ClickHouse',
  db2: 'IBM DB2',
  db2i: 'IBM DB2i',
  duckdb: 'DuckDB',
  hive: 'Apache Hive',
  mariadb: 'MariaDB',
  mysql: 'MySQL',
  n1ql: 'Couchbase N1QL',
  plsql: 'Oracle PL/SQL',
  postgresql: 'PostgreSQL',
  redshift: 'Amazon Redshift',
  spark: 'Spark',
  sqlite: 'SQLite',
  tidb: 'TiDB',
  trino: 'Trino (and Presto)',
  transactsql: 'SQL Server (Transact-SQL)',
  singlestoredb: 'SingleStoreDB',
  snowflake: 'Snowflake',
};

export const SQL_DIALECTS: { value: string; label: string }[] = supportedDialects
  .filter((d) => d !== 'tsql')
  .map((value) => ({ value, label: DIALECT_LABELS[value] ?? value }));

/** Extracts the 1-based line and column sql-formatter's own parse-error message reports, e.g. "Parse error at token: «EOF» at line 1 column 22". */
function parseErrorPosition(message: string): { line?: number; column?: number } {
  const match = /at line (\d+) column (\d+)/.exec(message);
  if (!match) return {};
  return { line: Number(match[1]), column: Number(match[2]) };
}

/**
 * Formats `source` for the chosen dialect with the pinned sql-formatter
 * package, or minifies it with a quote-aware lexer that never runs the
 * grammar and never changes a string literal, a quoted identifier or a
 * token. Throws `SqlFormatterError` with `line`/`column` when the chosen
 * dialect's grammar cannot parse the input.
 */
export function formatSql(source: string, options: FormatSqlOptions = {}): FormatSqlResult {
  const { mode = 'format', dialect = 'sql', keywordCase = 'preserve', indent = 2 } = options;

  if (mode === 'minify') {
    return { output: minifySqlImpl(source, dialect), warnings: [] };
  }

  try {
    const output = format(source, {
      language: dialect as SqlLanguage,
      keywordCase,
      tabWidth: indent,
      useTabs: false,
    });
    return { output, warnings: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The query could not be parsed.';
    const pos = parseErrorPosition(message);
    throw new SqlFormatterError(message.split('\n')[0] ?? message, pos);
  }
}
