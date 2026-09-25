/**
 * A single-pass, quote-aware SQL minifier. Never uses a regular expression
 * with nested quantifiers: every scan below is a plain linear walk forward
 * from the current index, so its running time is linear in the input
 * length regardless of what the input contains.
 *
 * Recognises, per dialect: single-quoted strings (doubled-quote escaping,
 * plus backslash escaping where the dialect has it: MySQL, MariaDB, and
 * PostgreSQL's E'...' escape-string syntax); double-quoted identifiers
 * (doubled-quote escaping, plus backslash escaping for MySQL and MariaDB,
 * which treat a double-quoted string the same as a single-quoted one when
 * ANSI_QUOTES is off); backtick identifiers (MySQL, MariaDB, SQLite,
 * BigQuery); bracket identifiers (SQL Server, SQLite); PostgreSQL
 * dollar-quoted strings with an optional tag; `--` line comments (every
 * dialect) and `#` line comments (MySQL, MariaDB); and `/* ... *\/` block
 * comments, nested in PostgreSQL.
 *
 * Removes every comment except one starting `/*!` (a MySQL executable
 * comment) or `/*+` (an optimiser hint), which are kept byte for byte.
 * Collapses every run of whitespace between two kept tokens to a single
 * space, except next to `(`, `)`, `,` or `;`, where the space is dropped
 * outright -- these four characters are always their own token in every
 * dialect's grammar, so removing the space beside them can never join two
 * tokens into a different one. Every other adjacency keeps its single
 * space rather than risk joining two tokens into a different one (for
 * example two minus signs into a line comment, or a slash and a star into
 * a block comment).
 */

export type MinifyDialect = string;

interface DialectQuoting {
  backtickIdentifiers: boolean;
  bracketIdentifiers: boolean;
  dollarQuotedStrings: boolean;
  hashLineComments: boolean;
  backslashEscapesInStrings: boolean;
  postgresEscapeStrings: boolean;
}

const MYSQL_LIKE = new Set(['mysql', 'mariadb', 'tidb', 'singlestoredb']);
const POSTGRES_LIKE = new Set(['postgresql', 'redshift']);
const SQLSERVER_LIKE = new Set(['transactsql', 'tsql']);

function quotingFor(dialect: MinifyDialect): DialectQuoting {
  const mysqlLike = MYSQL_LIKE.has(dialect);
  const sqlite = dialect === 'sqlite';
  const bigquery = dialect === 'bigquery';
  const sqlserverLike = SQLSERVER_LIKE.has(dialect);
  const postgresLike = POSTGRES_LIKE.has(dialect);
  return {
    backtickIdentifiers: mysqlLike || sqlite || bigquery,
    bracketIdentifiers: sqlserverLike || sqlite,
    dollarQuotedStrings: postgresLike,
    hashLineComments: mysqlLike,
    backslashEscapesInStrings: mysqlLike,
    postgresEscapeStrings: postgresLike,
  };
}

/** Characters that are always their own single-character token, so a space next to one is always safe to drop. */
const DROP_SPACE_NEAR = new Set(['(', ')', ',', ';']);

const DOLLAR_TAG_CHARS_FIRST = /[A-Za-z_]/;
const DOLLAR_TAG_CHARS_REST = /[A-Za-z0-9_]/;

/** Reads a PostgreSQL dollar-quote tag (`$tag$`) starting at `source[i]`, which must be `$`. Returns the delimiter text, or undefined if this `$` does not open a valid tag. */
function readDollarTag(source: string, i: number): string | undefined {
  let j = i + 1;
  if (j < source.length && DOLLAR_TAG_CHARS_FIRST.test(source[j]!)) {
    j++;
    while (j < source.length && DOLLAR_TAG_CHARS_REST.test(source[j]!)) j++;
  }
  if (source[j] === '$') return source.slice(i, j + 1);
  return undefined;
}

type Segment = { kind: 'content'; text: string } | { kind: 'gap' };

/** Splits `source` into content segments (quoted regions, kept executable comments, and runs of ordinary characters) and gaps (whitespace and dropped comments). */
function scan(source: string, dialect: MinifyDialect): Segment[] {
  const q = quotingFor(dialect);
  const segments: Segment[] = [];
  let i = 0;
  const n = source.length;
  let run = '';

  const flushRun = () => {
    if (run.length > 0) {
      segments.push({ kind: 'content', text: run });
      run = '';
    }
  };

  while (i < n) {
    const c = source[i]!;

    // Whitespace: ASCII space, tab, CR, LF, form feed, vertical tab.
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\v') {
      flushRun();
      segments.push({ kind: 'gap' });
      i++;
      while (i < n && /[ \t\r\n\f\v]/.test(source[i]!)) i++;
      continue;
    }

    // Line comments.
    if (c === '-' && source[i + 1] === '-') {
      flushRun();
      segments.push({ kind: 'gap' });
      i += 2;
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (q.hashLineComments && c === '#') {
      flushRun();
      segments.push({ kind: 'gap' });
      i++;
      while (i < n && source[i] !== '\n') i++;
      continue;
    }

    // Block comments, including executable comments and hints, which are kept.
    if (c === '/' && source[i + 1] === '*') {
      const isKept = source[i + 2] === '!' || source[i + 2] === '+';
      const start = i;
      i += 2;
      if (POSTGRES_LIKE.has(dialect)) {
        let depth = 1;
        while (i < n && depth > 0) {
          if (source[i] === '/' && source[i + 1] === '*') {
            depth++;
            i += 2;
          } else if (source[i] === '*' && source[i + 1] === '/') {
            depth--;
            i += 2;
          } else {
            i++;
          }
        }
      } else {
        while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
        i = Math.min(i + 2, n);
      }
      if (isKept) {
        flushRun();
        segments.push({ kind: 'content', text: source.slice(start, i) });
      } else {
        flushRun();
        segments.push({ kind: 'gap' });
      }
      continue;
    }

    // Single-quoted strings, with a PostgreSQL E'...' escape-string leg.
    if (c === "'") {
      const isEscapeString =
        q.postgresEscapeStrings &&
        run.length > 0 &&
        /[eE]$/.test(run) &&
        !/[A-Za-z0-9_]/.test(run[run.length - 2] ?? '');
      const backslashEscapes = q.backslashEscapesInStrings || isEscapeString;
      const start = i;
      i++;
      while (i < n) {
        if (backslashEscapes && source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === "'" && source[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (source[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      run += source.slice(start, i);
      continue;
    }

    // Double-quoted identifiers (or, for MySQL/MariaDB with ANSI_QUOTES off, strings).
    if (c === '"') {
      const backslashEscapes = q.backslashEscapesInStrings;
      const start = i;
      i++;
      while (i < n) {
        if (backslashEscapes && source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '"' && source[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (source[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      run += source.slice(start, i);
      continue;
    }

    // Backtick identifiers.
    if (q.backtickIdentifiers && c === '`') {
      const start = i;
      i++;
      while (i < n) {
        if (source[i] === '`' && source[i + 1] === '`') {
          i += 2;
          continue;
        }
        if (source[i] === '`') {
          i++;
          break;
        }
        i++;
      }
      run += source.slice(start, i);
      continue;
    }

    // Bracket identifiers.
    if (q.bracketIdentifiers && c === '[') {
      const start = i;
      i++;
      while (i < n) {
        if (source[i] === ']' && source[i + 1] === ']') {
          i += 2;
          continue;
        }
        if (source[i] === ']') {
          i++;
          break;
        }
        i++;
      }
      run += source.slice(start, i);
      continue;
    }

    // PostgreSQL dollar-quoted strings.
    if (q.dollarQuotedStrings && c === '$') {
      const openTag = readDollarTag(source, i);
      if (openTag) {
        const closeAt = source.indexOf(openTag, i + openTag.length);
        const end = closeAt === -1 ? n : closeAt + openTag.length;
        run += source.slice(i, end);
        i = end;
        continue;
      }
    }

    run += c;
    i++;
  }
  flushRun();
  return segments;
}

/** Minifies `source` for `dialect`: removes ordinary comments, keeps executable comments and hints, and collapses whitespace without ever changing a string literal, a quoted identifier or a token. */
export function minifySql(source: string, dialect: MinifyDialect): string {
  return joinSegments(scan(source, dialect));
}

function joinSegments(segments: Segment[]): string {
  let output = '';
  let pendingGap = false;

  for (const seg of segments) {
    if (seg.kind === 'gap') {
      pendingGap = true;
      continue;
    }
    if (output.length > 0 && pendingGap) {
      const lastChar = output[output.length - 1]!;
      const firstChar = seg.text[0]!;
      if (!DROP_SPACE_NEAR.has(lastChar) && !DROP_SPACE_NEAR.has(firstChar)) {
        output += ' ';
      }
    }
    output += seg.text;
    pendingGap = false;
  }

  return output;
}
