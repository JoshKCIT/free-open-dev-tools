/**
 * Parses the documented CREATE TABLE subset (columns, types, NULL/NOT NULL,
 * primary keys, defaults, auto-increment markers) for PostgreSQL, MySQL,
 * SQLite and SQL Server. Grammar confirmed against each vendor's own
 * fetched CREATE TABLE reference (see this package's meta.json standards
 * list). Anything outside the subset -- other statements, other
 * constraints, other default expressions, table options and unknown types
 * -- is reported in `notConverted` with its line, never guessed at (D-54);
 * the column it was found on still converts using whatever was already
 * read from it.
 */
import { tokenize, SqlSyntaxError, type Token } from './tokenize';

export type Dialect = 'postgresql' | 'mysql' | 'sqlite' | 'sqlserver';

export type TypeKind =
  'int' | 'bigint' | 'decimal' | 'float' | 'boolean' | 'string' | 'datetime' | 'json' | 'bytes' | 'unknown';

export interface ColumnDefault {
  kind: 'literal' | 'now';
  /** Present only for kind 'literal'. The literal's own source text (a string is unquoted, a number or true/false/null is as written). */
  value?: string;
  valueType?: 'string' | 'number' | 'boolean' | 'null';
}

export interface ColumnDef {
  name: string;
  /** The type as written, including any (n) or (p, s) argument and multi-word modifiers. */
  rawType: string;
  typeKind: TypeKind;
  nullable: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  default?: ColumnDefault;
}

export interface TableDef {
  name: string;
  schema?: string;
  columns: ColumnDef[];
  line: number;
}

export interface NotConverted {
  line: number;
  text: string;
  reason: string;
}

export interface ParseResult {
  tables: TableDef[];
  notConverted: NotConverted[];
}

function isKw(tok: Token | undefined, word: string): boolean {
  return !!tok && tok.type === 'ident' && !tok.quoted && tok.text.toUpperCase() === word;
}

function isPunct(tok: Token | undefined, text: string): boolean {
  return !!tok && tok.type === 'punct' && tok.text === text;
}

class TokenStream {
  readonly tokens: Token[];
  pos = 0;
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }
  peek(ahead = 0): Token {
    return this.tokens[Math.min(this.pos + ahead, this.tokens.length - 1)]!;
  }
  advance(n = 1): void {
    this.pos = Math.min(this.pos + n, this.tokens.length - 1);
  }
  atEof(): boolean {
    return this.peek().type === 'eof';
  }
}

/** Renders a run of tokens back into readable source text, for a notConverted entry. */
function renderTokens(tokens: Token[]): string {
  return tokens
    .map((t) => {
      if (t.type === 'string') return `'${t.text.replace(/'/g, "''")}'`;
      if (t.type === 'ident' && t.quoted) return `"${t.text}"`;
      return t.text;
    })
    .join(' ')
    .replace(/\s+([,)])/g, '$1')
    .replace(/\(\s+/g, '(');
}

/** Advances past a balanced ( ... ) group starting at the current '('. */
function skipParenGroup(stream: TokenStream): void {
  if (!isPunct(stream.peek(), '(')) return;
  let depth = 0;
  do {
    const tok = stream.peek();
    if (tok.type === 'eof') return;
    if (isPunct(tok, '(')) depth++;
    else if (isPunct(tok, ')')) depth--;
    stream.advance();
  } while (depth > 0);
}

/**
 * Consumes tokens from the current position up to (not including) the next
 * top-level comma or closing paren -- the boundary of the current column or
 * table-constraint item -- tracking nested parens so a skipped `CHECK (...)`
 * or `REFERENCES t (col)` does not stop early on its own inner punctuation.
 * Returns the skipped tokens rendered back to text, for a notConverted entry.
 */
function skipToBoundary(stream: TokenStream): string {
  const start = stream.pos;
  let depth = 0;
  for (;;) {
    const tok = stream.peek();
    if (tok.type === 'eof') break;
    if (depth === 0 && (isPunct(tok, ',') || isPunct(tok, ')'))) break;
    if (isPunct(tok, '(')) depth++;
    else if (isPunct(tok, ')')) depth--;
    stream.advance();
  }
  return renderTokens(stream.tokens.slice(start, stream.pos));
}

const SINGLE_WORD_TYPES: Record<string, TypeKind> = {
  int: 'int',
  integer: 'int',
  int4: 'int',
  int2: 'int',
  smallint: 'int',
  mediumint: 'int',
  tinyint: 'int',
  bigint: 'bigint',
  int8: 'bigint',
  serial: 'int',
  serial4: 'int',
  smallserial: 'int',
  serial2: 'int',
  bigserial: 'bigint',
  serial8: 'bigint',
  decimal: 'decimal',
  numeric: 'decimal',
  dec: 'decimal',
  real: 'float',
  float4: 'float',
  float8: 'float',
  float: 'float',
  double: 'float',
  boolean: 'boolean',
  bool: 'boolean',
  bit: 'boolean',
  text: 'string',
  varchar: 'string',
  char: 'string',
  character: 'string',
  bpchar: 'string',
  nvarchar: 'string',
  nchar: 'string',
  ntext: 'string',
  clob: 'string',
  tinytext: 'string',
  mediumtext: 'string',
  longtext: 'string',
  date: 'datetime',
  time: 'datetime',
  datetime: 'datetime',
  datetime2: 'datetime',
  timestamp: 'datetime',
  smalldatetime: 'datetime',
  datetimeoffset: 'datetime',
  year: 'datetime',
  json: 'json',
  jsonb: 'json',
  bytea: 'bytes',
  blob: 'bytes',
  binary: 'bytes',
  varbinary: 'bytes',
  image: 'bytes',
  tinyblob: 'bytes',
  mediumblob: 'bytes',
  longblob: 'bytes',
};

const SERIAL_TYPES = new Set(['serial', 'serial4', 'smallserial', 'serial2', 'bigserial', 'serial8']);

interface TypeReadResult {
  /** Null means the type name was not found in the documented subset's lookup table. */
  kind: TypeKind | null;
  rawType: string;
  isSerial: boolean;
}

function readTypeName(stream: TokenStream): TypeReadResult {
  const first = stream.peek();
  if (first.type !== 'ident') {
    stream.advance();
    return { kind: null, rawType: first.text, isSerial: false };
  }
  stream.advance();
  const word = first.text.toLowerCase();
  let kind: TypeKind | null;
  const words = [first.text];

  if (word === 'double' && isKw(stream.peek(), 'PRECISION')) {
    stream.advance();
    words.push('precision');
    kind = 'float';
  } else if (word === 'character' && isKw(stream.peek(), 'VARYING')) {
    stream.advance();
    words.push('varying');
    kind = 'string';
  } else {
    kind = SINGLE_WORD_TYPES[word] ?? null;
  }

  // timestamp/time [with|without time zone]
  if (word === 'timestamp' || word === 'time') {
    if (isKw(stream.peek(), 'WITH') || isKw(stream.peek(), 'WITHOUT')) {
      const withoutWord = stream.peek().text;
      if (isKw(stream.peek(1), 'TIME') && isKw(stream.peek(2), 'ZONE')) {
        words.push(withoutWord, 'time', 'zone');
        stream.advance(3);
      }
    }
  }

  // MySQL numeric modifiers that do not change the kind.
  while (isKw(stream.peek(), 'UNSIGNED') || isKw(stream.peek(), 'ZEROFILL')) {
    words.push(stream.peek().text);
    stream.advance();
  }

  let argsText = '';
  if (isPunct(stream.peek(), '(')) {
    // Only consume the parens here when they hold the numeric (n) or (p, s)
    // argument shape; anything else is left for the constraint loop, which
    // reports it as an unrecognized construct rather than silently eating it.
    const lookahead = 1;
    const looksNumeric =
      stream.peek(lookahead).type === 'number' &&
      (isPunct(stream.peek(lookahead + 1), ')') ||
        (isPunct(stream.peek(lookahead + 1), ',') && stream.peek(lookahead + 2).type === 'number'));
    if (looksNumeric) {
      const parts: string[] = [];
      stream.advance(); // (
      parts.push(stream.peek().text);
      stream.advance();
      if (isPunct(stream.peek(), ',')) {
        stream.advance();
        parts.push(stream.peek().text);
        stream.advance();
      }
      if (isPunct(stream.peek(), ')')) stream.advance();
      argsText = `(${parts.join(', ')})`;
      // MySQL's own documented BOOL/BOOLEAN-as-TINYINT(1) convention: a
      // bare tinyint defaults to the int kind above; tinyint(1) specifically
      // is read as a boolean flag column, the same convention this
      // package's data-to-sql sibling tool documents independently.
      if (word === 'tinyint' && parts.length === 1 && parts[0] === '1') kind = 'boolean';
      void lookahead;
    }
  }

  return { kind, rawType: words.join(' ') + argsText, isSerial: SERIAL_TYPES.has(word) };
}

interface DefaultReadOutcome {
  default?: ColumnDefault;
  /** True when the default expression was unsupported and already consumed through the column boundary. */
  hitBoundary?: boolean;
}

function readDefault(stream: TokenStream): DefaultReadOutcome {
  const tok = stream.peek();
  if (tok.type === 'string') {
    stream.advance();
    return { default: { kind: 'literal', value: tok.text, valueType: 'string' } };
  }
  if (tok.type === 'number') {
    stream.advance();
    return { default: { kind: 'literal', value: tok.text, valueType: 'number' } };
  }
  if (isKw(tok, 'TRUE') || isKw(tok, 'FALSE')) {
    stream.advance();
    return { default: { kind: 'literal', value: tok.text.toUpperCase(), valueType: 'boolean' } };
  }
  if (isKw(tok, 'NULL')) {
    stream.advance();
    return { default: { kind: 'literal', value: 'NULL', valueType: 'null' } };
  }
  if (isKw(tok, 'CURRENT_TIMESTAMP')) {
    stream.advance();
    if (isPunct(stream.peek(), '(')) skipParenGroup(stream); // optional fractional-seconds precision
    return { default: { kind: 'now' } };
  }
  if (isKw(tok, 'NOW') && isPunct(stream.peek(1), '(') && isPunct(stream.peek(2), ')')) {
    stream.advance(3);
    return { default: { kind: 'now' } };
  }
  // An unsupported default expression: a function call, a parenthesized
  // expression, GETDATE(), or anything else this subset does not model.
  return { hitBoundary: true };
}

/** Reads a bare or quoted identifier token, or throws when the current token is not one. */
function readIdent(stream: TokenStream, what: string): string {
  const tok = stream.peek();
  if (tok.type !== 'ident') {
    throw new SqlSyntaxError(`Expected ${what}, found "${tok.text || tok.type}".`, tok.line, tok.column);
  }
  stream.advance();
  return tok.text;
}

function parseColumn(stream: TokenStream, notConverted: NotConverted[]): ColumnDef | null {
  const name = readIdent(stream, 'a column name');
  const typeTok = stream.peek();
  const typeInfo = readTypeName(stream);

  if (typeInfo.kind === null) {
    // The type name is not in this subset's lookup table. This column is
    // reported, not guessed at (D-54): the rest of the column definition is
    // still consumed here so the table's closing paren and sibling columns
    // parse normally, but no ColumnDef is produced for it.
    const rest = skipToBoundary(stream);
    notConverted.push({
      line: typeTok.line,
      text: `${name} ${typeInfo.rawType}${rest ? ' ' + rest : ''}`.trim(),
      reason: `unrecognized type "${typeInfo.rawType}"`,
    });
    return null;
  }
  const kind = typeInfo.kind;

  let nullable = true;
  let primaryKey = false;
  let autoIncrement = typeInfo.isSerial;
  let def: ColumnDefault | undefined;

  for (;;) {
    const tok = stream.peek();
    if (tok.type === 'eof' || isPunct(tok, ',') || isPunct(tok, ')')) break;

    if (isKw(tok, 'NOT') && isKw(stream.peek(1), 'NULL')) {
      stream.advance(2);
      nullable = false;
      continue;
    }
    if (isKw(tok, 'NULL')) {
      stream.advance();
      nullable = true;
      continue;
    }
    if (isKw(tok, 'PRIMARY') && isKw(stream.peek(1), 'KEY')) {
      stream.advance(2);
      primaryKey = true;
      nullable = false;
      if (isKw(stream.peek(), 'ASC') || isKw(stream.peek(), 'DESC')) stream.advance();
      if (isKw(stream.peek(), 'ON') && isKw(stream.peek(1), 'CONFLICT')) {
        stream.advance(2);
        if (stream.peek().type === 'ident') stream.advance();
      }
      if (isKw(stream.peek(), 'AUTOINCREMENT')) {
        stream.advance();
        autoIncrement = true;
      }
      continue;
    }
    if (isKw(tok, 'DEFAULT')) {
      stream.advance();
      const outcome = readDefault(stream);
      if (outcome.hitBoundary) {
        const start = stream.peek();
        const text = 'DEFAULT ' + skipToBoundary(stream);
        notConverted.push({ line: start.line, text, reason: 'unsupported DEFAULT expression' });
        break;
      }
      def = outcome.default;
      continue;
    }
    if (isKw(tok, 'AUTO_INCREMENT')) {
      stream.advance();
      autoIncrement = true;
      continue;
    }
    if (isKw(tok, 'IDENTITY')) {
      stream.advance();
      autoIncrement = true;
      if (isPunct(stream.peek(), '(')) skipParenGroup(stream);
      continue;
    }
    if (isKw(tok, 'GENERATED')) {
      const save = stream.pos;
      stream.advance();
      if (isKw(stream.peek(), 'ALWAYS') && isKw(stream.peek(1), 'AS') && isKw(stream.peek(2), 'IDENTITY')) {
        stream.advance(3);
        autoIncrement = true;
        if (isPunct(stream.peek(), '(')) skipParenGroup(stream);
        continue;
      }
      if (
        isKw(stream.peek(), 'BY') &&
        isKw(stream.peek(1), 'DEFAULT') &&
        isKw(stream.peek(2), 'AS') &&
        isKw(stream.peek(3), 'IDENTITY')
      ) {
        stream.advance(4);
        autoIncrement = true;
        if (isPunct(stream.peek(), '(')) skipParenGroup(stream);
        continue;
      }
      stream.pos = save;
      const start = stream.peek();
      const text = skipToBoundary(stream);
      notConverted.push({ line: start.line, text, reason: 'GENERATED computed column' });
      break;
    }

    const start = tok;
    const text = skipToBoundary(stream);
    const reasonWord = tok.type === 'ident' ? tok.text.toUpperCase() : tok.text;
    const reason = /^(CHECK|UNIQUE|REFERENCES|COLLATE|CONSTRAINT|COMMENT)$/.test(reasonWord)
      ? `unsupported ${reasonWord} constraint`
      : 'unsupported column constraint';
    notConverted.push({ line: start.line, text, reason });
    break;
  }

  return {
    name,
    rawType: typeInfo.rawType,
    typeKind: kind,
    nullable,
    primaryKey,
    autoIncrement,
    default: def,
  };
}

function parseTableBody(
  stream: TokenStream,
  notConverted: NotConverted[],
): { columns: ColumnDef[]; primaryKeyColumns: string[] } {
  const columns: ColumnDef[] = [];
  const primaryKeyColumns: string[] = [];

  while (!isPunct(stream.peek(), ')') && stream.peek().type !== 'eof') {
    let hasConstraintName = false;
    const save = stream.pos;
    if (isKw(stream.peek(), 'CONSTRAINT')) {
      stream.advance();
      if (stream.peek().type === 'ident') stream.advance();
      hasConstraintName = true;
    }

    if (isKw(stream.peek(), 'PRIMARY') && isKw(stream.peek(1), 'KEY') && isPunct(stream.peek(2), '(')) {
      stream.advance(2);
      stream.advance(); // (
      for (;;) {
        const colTok = stream.peek();
        if (colTok.type === 'ident') {
          primaryKeyColumns.push(colTok.text);
          stream.advance();
        }
        if (isPunct(stream.peek(), ',')) {
          stream.advance();
          continue;
        }
        break;
      }
      if (isPunct(stream.peek(), ')')) stream.advance();
    } else if (
      isKw(stream.peek(), 'CHECK') ||
      isKw(stream.peek(), 'UNIQUE') ||
      (isKw(stream.peek(), 'FOREIGN') && isKw(stream.peek(1), 'KEY')) ||
      isKw(stream.peek(), 'EXCLUDE')
    ) {
      const start = stream.peek();
      const text = skipToBoundary(stream);
      notConverted.push({
        line: start.line,
        text: (hasConstraintName ? '' : '') + text,
        reason: `unsupported table-level ${start.text.toUpperCase()} constraint`,
      });
    } else if (hasConstraintName) {
      // A named constraint that is not PRIMARY KEY -- rewind to include the
      // CONSTRAINT keyword and its name in the reported text.
      stream.pos = save;
      const start = stream.peek();
      const text = skipToBoundary(stream);
      notConverted.push({ line: start.line, text, reason: 'unsupported table-level constraint' });
    } else {
      const col = parseColumn(stream, notConverted);
      if (col) columns.push(col);
    }

    if (isPunct(stream.peek(), ',')) {
      stream.advance();
      continue;
    }
    break;
  }

  return { columns, primaryKeyColumns };
}

/** Splits a token stream into groups, one per top-level `;`-terminated (or final, unterminated) statement. */
function splitStatements(tokens: Token[]): Token[][] {
  const statements: Token[][] = [];
  let current: Token[] = [];
  for (const tok of tokens) {
    if (tok.type === 'eof') break;
    if (isPunct(tok, ';')) {
      if (current.length > 0) statements.push(current);
      current = [];
      continue;
    }
    current.push(tok);
  }
  if (current.length > 0) statements.push(current);
  return statements;
}

function describeStatement(tokens: Token[]): string {
  const words = tokens
    .slice(0, 6)
    .map((t) => (t.type === 'ident' ? t.text : t.text))
    .join(' ');
  return tokens.length > 6 ? words + ' ...' : words;
}

/** Parses every CREATE TABLE statement in `sql`. Statements are separated by `;`. */
export function parseCreateTableStatements(sql: string): ParseResult {
  const tokens = tokenize(sql);
  const statements = splitStatements(tokens);
  const tables: TableDef[] = [];
  const notConverted: NotConverted[] = [];

  for (const statementTokens of statements) {
    const eofTok: Token = { type: 'eof', text: '', line: statementTokens.at(-1)?.line ?? 1, column: 1 };
    const stream = new TokenStream([...statementTokens, eofTok]);

    if (!isKw(stream.peek(), 'CREATE')) {
      notConverted.push({
        line: stream.peek().line,
        text: describeStatement(statementTokens),
        reason: 'not a CREATE TABLE statement',
      });
      continue;
    }
    stream.advance();
    if (!isKw(stream.peek(), 'TABLE')) {
      const reason =
        isKw(stream.peek(), 'INDEX') || (isKw(stream.peek(), 'UNIQUE') && isKw(stream.peek(1), 'INDEX'))
          ? 'CREATE INDEX statement'
          : 'not a CREATE TABLE statement';
      notConverted.push({ line: stream.peek().line, text: describeStatement(statementTokens), reason });
      continue;
    }
    stream.advance();

    if (isKw(stream.peek(), 'IF') && isKw(stream.peek(1), 'NOT') && isKw(stream.peek(2), 'EXISTS')) {
      stream.advance(3);
    }

    const nameLine = stream.peek().line;
    const first = readIdent(stream, 'a table name');
    let schema: string | undefined;
    let name = first;
    if (isPunct(stream.peek(), '.')) {
      stream.advance();
      schema = first;
      name = readIdent(stream, 'a table name');
    }

    if (!isPunct(stream.peek(), '(')) {
      notConverted.push({
        line: nameLine,
        text: describeStatement(statementTokens),
        reason: 'CREATE TABLE without a column list is not in this subset',
      });
      continue;
    }
    stream.advance(); // (

    const { columns, primaryKeyColumns } = parseTableBody(stream, notConverted);
    if (isPunct(stream.peek(), ')')) stream.advance();

    for (const pkName of primaryKeyColumns) {
      const col = columns.find((c) => c.name === pkName);
      if (col) {
        col.primaryKey = true;
        col.nullable = false;
      }
    }

    if (!stream.atEof()) {
      const start = stream.peek();
      const trailing = renderTokens(stream.tokens.slice(stream.pos, stream.tokens.length - 1));
      if (trailing.trim() !== '') {
        notConverted.push({ line: start.line, text: trailing, reason: 'unsupported table option' });
      }
    }

    tables.push({ name, schema, columns, line: nameLine });
  }

  return { tables, notConverted };
}
