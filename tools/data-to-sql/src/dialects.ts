/**
 * Per-dialect identifier quoting, string escaping and type names.
 *
 * Quoting rules, fetched and quoted in this package's tests:
 * - PostgreSQL (https://www.postgresql.org/docs/current/sql-syntax-lexical.html,
 *   sections 4.1.1 and 4.1.2.1): a delimited identifier is enclosed in double
 *   quotes, doubling an embedded double quote; unquoted identifiers fold to
 *   lower case, quoted ones are case-sensitive. A single quote inside a
 *   string constant is written as two adjacent single quotes.
 * - MySQL (https://dev.mysql.com/doc/refman/8.4/en/identifiers.html and
 *   .../string-literals.html): identifiers are backtick-quoted, doubling an
 *   embedded backtick. String literals use single quotes (ANSI_QUOTES is
 *   not assumed); backslash begins an escape sequence unless
 *   NO_BACKSLASH_ESCAPES is set (not assumed either), so both a quote and a
 *   backslash are doubled in the literal this package writes.
 * - SQLite (https://www.sqlite.org/lang_keywords.html and
 *   https://www.sqlite.org/lang_expr.html): a double-quoted identifier
 *   doubles an embedded double quote (the standard-SQL form, used here
 *   instead of the backtick or bracket compatibility forms). A single
 *   quoted string constant doubles an embedded single quote; there is no
 *   C-style backslash escape.
 * - SQL Server (.../database-identifiers and .../constants-transact-sql):
 *   a bracket-delimited identifier doubles an embedded closing bracket (an
 *   opening bracket needs no escaping). A string constant uses single
 *   quotes, doubling an embedded quote; a Unicode string is prefixed with
 *   an uppercase N.
 *
 * A value or identifier containing a U+0000 character is refused outright
 * in every dialect: PostgreSQL's own docs say a quoted identifier "can
 * contain any character, except the character with code zero," and none of
 * the four dialects has a way to write a literal NUL byte inside a quoted
 * string or identifier that every driver reliably round-trips.
 */

export type Dialect = 'postgresql' | 'mysql' | 'sqlite' | 'sqlserver';

export const DIALECTS: Dialect[] = ['postgresql', 'mysql', 'sqlite', 'sqlserver'];

export type SqlTypeKind = 'boolean' | 'integer' | 'bigint' | 'double' | 'text' | 'json';

function refuseNul(kind: string, text: string): void {
  if (text.includes('\u0000')) {
    throw new Error(`${kind} contains a NUL character (U+0000), which cannot be written into a SQL literal.`);
  }
}

/** Always quotes `name` for `dialect`, doubling the closing quote character. */
export function quoteIdentifier(dialect: Dialect, name: string): string {
  refuseNul('An identifier', name);
  switch (dialect) {
    case 'postgresql':
    case 'sqlite':
      return '"' + name.replace(/"/g, '""') + '"';
    case 'mysql':
      return '`' + name.replace(/`/g, '``') + '`';
    case 'sqlserver':
      return '[' + name.replace(/]/g, ']]') + ']';
  }
}

/** Quotes `value` as a string literal for `dialect`, doubling an embedded quote (and, for MySQL, a backslash). */
export function quoteString(dialect: Dialect, value: string): string {
  refuseNul('A value', value);
  const doubled = value.replace(/'/g, "''");
  switch (dialect) {
    case 'mysql':
      // Backslash must be doubled first, or the doubled quote's own
      // backslash-free apostrophes would be mistaken for the escape this
      // step is trying to introduce.
      return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
    case 'sqlserver':
      return "N'" + doubled + "'";
    case 'postgresql':
    case 'sqlite':
      return "'" + doubled + "'";
  }
}

/** Type name per dialect for each inferred column kind. */
export const TYPE_NAMES: Record<Dialect, Record<SqlTypeKind, string>> = {
  postgresql: {
    boolean: 'boolean',
    integer: 'integer',
    bigint: 'bigint',
    double: 'double precision',
    text: 'text',
    json: 'json',
  },
  mysql: {
    // BOOL/BOOLEAN are documented synonyms for TINYINT(1) in every MySQL
    // version since 4.1; written directly as tinyint(1) since that is what
    // a client actually reads back from the information schema.
    boolean: 'tinyint(1)',
    integer: 'int',
    bigint: 'bigint',
    double: 'double',
    text: 'text',
    json: 'json',
  },
  sqlite: {
    // SQLite has no separate boolean storage class: TRUE/FALSE are just
    // spellings of the integer literals 1 and 0 (datatype3.html section 2.1).
    boolean: 'integer',
    integer: 'integer',
    bigint: 'integer',
    double: 'real',
    text: 'text',
    // No native JSON storage class either; JSON is kept as TEXT.
    json: 'text',
  },
  sqlserver: {
    boolean: 'bit',
    integer: 'int',
    bigint: 'bigint',
    double: 'float',
    text: 'nvarchar(max)',
    // No native JSON storage class in this package's targeted version; JSON
    // text is stored the same way SQL Server's own JSON functions expect it.
    json: 'nvarchar(max)',
  },
};

/** How a boolean value is written as a literal for `dialect`. */
export function quoteBoolean(dialect: Dialect, value: boolean): string {
  switch (dialect) {
    case 'sqlite':
    case 'sqlserver':
      return value ? '1' : '0';
    case 'postgresql':
    case 'mysql':
      return value ? 'TRUE' : 'FALSE';
  }
}
