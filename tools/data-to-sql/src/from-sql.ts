import { formatCsv } from './csv';
import type { Dialect } from './dialects';
import { DataToSqlError } from './errors';

/**
 * Reads INSERT ... VALUES statements back into rows.
 *
 * A hand-written tokenizer reads the text once, following each dialect's own quoting: doubled quotes everywhere,
 * backslash escapes in MySQL strings and PostgreSQL E'...' strings only, the N prefix of SQL Server and MySQL,
 * double-quoted, backtick and bracket identifiers where the dialect has them, and double-dash, block (nested in
 * PostgreSQL) and MySQL hash comments. Statements are split at semicolons that are outside strings, identifiers and
 * comments. Nothing is ever executed or evaluated: a function call or an expression in a value is kept as the text
 * it was written as.
 */

export interface SqlToRowsOptions {
  /** Which dialect's quoting to expect. Default 'postgresql'. */
  dialect?: Dialect;
  /** 'json' (default): numbers, booleans and null typed. 'csv': text. */
  rowsFormat?: 'json' | 'csv';
  /** Read only this table (its full name as written, or just its table part). Empty reads every table. */
  tableFilter?: string;
}

export interface SqlToRowsResult {
  output: string;
  /** Every table an INSERT statement named, in order of first appearance, whatever the filter. */
  tables: string[];
  /** How many statements were not INSERT statements and so were skipped. */
  skipped: number;
  warnings: string[];
  /** How many rows are in the output. */
  rows: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------------------------

type TokenType = 'word' | 'dq' | 'bt' | 'br' | 'str' | 'num' | 'hex' | 'dollar' | 'punct' | 'semi';

interface Token {
  type: TokenType;
  /** The source text of the token. */
  text: string;
  /** The decoded text of a string or identifier, `0x` and the digits of a hex literal, else the source text. */
  value: string;
  start: number;
  end: number;
}

type StringEscapes = 'none' | 'mysql' | 'postgres';

const isWordStart = (code: number): boolean =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code >= 128;
const isDigit = (code: number): boolean => code >= 48 && code <= 57;
const isWordPart = (code: number): boolean => isWordStart(code) || isDigit(code) || code === 36;
const isHexDigit = (ch: string | undefined): boolean => ch !== undefined && /^[0-9a-fA-F]$/.test(ch);
const isSpace = (code: number): boolean =>
  code === 32 ||
  code === 9 ||
  code === 10 ||
  code === 13 ||
  code === 12 ||
  code === 11 ||
  code === 0xa0 ||
  code === 0xfeff;

function positionAt(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index; i++) {
    const ch = text[i];
    if (ch === '\n') {
      line++;
      column = 1;
    } else if (ch === '\r') {
      if (text[i + 1] !== '\n') {
        line++;
        column = 1;
      }
    } else {
      column++;
    }
  }
  return { line, column };
}

interface Tokenized {
  tokens: Token[];
  /** How many PostgreSQL COPY data blocks were skipped. */
  copyBlocks: number;
}

function tokenize(text: string, dialect: Dialect): Tokenized {
  const n = text.length;
  const tokens: Token[] = [];
  let i = 0;
  let statementStart = 0;
  let copyBlocks = 0;

  const fail = (message: string, at: number): never => {
    throw new DataToSqlError(message, positionAt(text, at));
  };
  const push = (type: TokenType, start: number, end: number, value?: string): void => {
    const source = text.slice(start, end);
    tokens.push({ type, text: source, value: value ?? source, start, end });
  };

  /** A quoted string or identifier body starting at the opening quote `start`; returns the decoded text and the index after the closing quote. */
  const readQuoted = (start: number, quote: string, escapes: StringEscapes): { value: string; end: number } => {
    let out = '';
    let j = start + 1;
    let bytes: number[] = [];
    const flushBytes = (): void => {
      if (bytes.length === 0) return;
      try {
        out += new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
      } catch {
        fail('The byte escapes in this string do not make valid UTF-8 text.', start);
      }
      bytes = [];
    };
    for (;;) {
      if (j >= n) fail('A quoted string or name starting here is never closed.', start);
      const ch = text[j]!;
      if (ch === quote) {
        if (text[j + 1] === quote) {
          flushBytes();
          out += quote;
          j += 2;
          continue;
        }
        flushBytes();
        return { value: out, end: j + 1 };
      }
      if (ch === '\\' && escapes !== 'none') {
        j++;
        if (j >= n) fail('A quoted string or name starting here is never closed.', start);
        const e = text[j]!;
        if (escapes === 'mysql') {
          // MySQL 8.4 String Literals, Table 11.1; \% and \_ stay two characters, any other backslash is dropped.
          const map: Record<string, string> = {
            '0': '\u0000',
            b: '\b',
            n: '\n',
            r: '\r',
            t: '\t',
            Z: '\u001a',
            '%': '\\%',
            _: '\\_',
          };
          out += map[e] ?? e;
          j++;
          continue;
        }
        // PostgreSQL 4.1.2.2, Table 4.1.
        if (e >= '0' && e <= '7') {
          let k = j;
          let value = 0;
          while (k < j + 3 && text[k] !== undefined && text[k]! >= '0' && text[k]! <= '7') {
            value = value * 8 + Number(text[k]);
            k++;
          }
          if (value > 255) fail('An octal escape in this string is larger than one byte.', start);
          bytes.push(value);
          j = k;
          continue;
        }
        if (e === 'x' && isHexDigit(text[j + 1])) {
          let digits = text[j + 1]!;
          if (isHexDigit(text[j + 2])) digits += text[j + 2]!;
          bytes.push(parseInt(digits, 16));
          j += 1 + digits.length;
          continue;
        }
        flushBytes();
        if (e === 'u' || e === 'U') {
          const length = e === 'u' ? 4 : 8;
          const digits = text.slice(j + 1, j + 1 + length);
          if (digits.length !== length || !/^[0-9a-fA-F]+$/.test(digits)) {
            fail(`A \\${e} escape in this string needs ${length} hexadecimal digits.`, start);
          }
          const codePoint = parseInt(digits, 16);
          if (codePoint > 0x10ffff) fail('A Unicode escape in this string is beyond U+10FFFF.', start);
          out += String.fromCodePoint(codePoint);
          j += 1 + length;
          continue;
        }
        const controls: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        out += controls[e] ?? e;
        j++;
        continue;
      }
      flushBytes();
      out += ch;
      j++;
    }
  };

  /** True when the word at [start, end) is the only thing on its line. */
  const aloneOnLine = (start: number, end: number): boolean => {
    for (let k = start - 1; k >= 0 && text[k] !== '\n'; k--) if (!isSpace(text.charCodeAt(k))) return false;
    for (let k = end; k < n && text[k] !== '\n'; k++) if (!isSpace(text.charCodeAt(k))) return false;
    return true;
  };

  const endStatement = (start: number, end: number, source: string): void => {
    push('semi', start, end, source);
    const first = tokens[statementStart];
    if (
      dialect === 'postgresql' &&
      first !== undefined &&
      first.type === 'word' &&
      first.text.toUpperCase() === 'COPY' &&
      tokens.slice(statementStart).some((t) => t.type === 'word' && t.text.toUpperCase() === 'STDIN')
    ) {
      // The lines after COPY ... FROM stdin; are data, not SQL, up to a line holding only a backslash and a point.
      const rest = text.slice(i);
      const terminator = /^\\\.[ \t]*\r?$/m.exec(rest);
      i += terminator ? terminator.index + terminator[0].length : rest.length;
      copyBlocks++;
    }
    statementStart = tokens.length;
  };

  while (i < n) {
    const code = text.charCodeAt(i);
    const c = text[i]!;
    const next = text[i + 1];

    if (isSpace(code)) {
      i++;
      continue;
    }

    // Comments.
    if (c === '-' && next === '-') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }
    if (c === '#' && dialect === 'mysql') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const start = i;
      let depth = 1;
      i += 2;
      while (depth > 0) {
        if (i >= n) fail('A comment starting here is never closed.', start);
        if (text[i] === '*' && text[i + 1] === '/') {
          depth--;
          i += 2;
        } else if (dialect === 'postgresql' && text[i] === '/' && text[i + 1] === '*') {
          depth++;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }

    // Strings.
    if (c === "'") {
      const { value, end } = readQuoted(i, "'", dialect === 'mysql' ? 'mysql' : 'none');
      push('str', i, end, value);
      i = end;
      continue;
    }
    if (c === '"') {
      const { value, end } = readQuoted(i, '"', dialect === 'mysql' ? 'mysql' : 'none');
      push('dq', i, end, value);
      i = end;
      continue;
    }
    if (c === '`' && (dialect === 'mysql' || dialect === 'sqlite')) {
      const { value, end } = readQuoted(i, '`', 'none');
      push('bt', i, end, value);
      i = end;
      continue;
    }
    if (c === '[' && (dialect === 'sqlserver' || dialect === 'sqlite')) {
      // SQL Server doubles a closing bracket; SQLite ends the name at the first one.
      const start = i;
      let value = '';
      let j = i + 1;
      for (;;) {
        if (j >= n) fail('A bracketed name starting here is never closed.', start);
        if (text[j] === ']') {
          if (dialect === 'sqlserver' && text[j + 1] === ']') {
            value += ']';
            j += 2;
            continue;
          }
          j++;
          break;
        }
        value += text[j]!;
        j++;
      }
      push('br', start, j, value);
      i = j;
      continue;
    }
    if (c === '$' && dialect === 'postgresql') {
      const marker = /\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/y;
      marker.lastIndex = i;
      const match = marker.exec(text);
      if (match) {
        const close = text.indexOf(match[0], i + match[0].length);
        if (close === -1) fail('A dollar-quoted string starting here is never closed.', i);
        push('dollar', i, close + match[0].length, text.slice(i + match[0].length, close));
        i = close + match[0].length;
        continue;
      }
    }

    // Prefixed strings: SQL Server and MySQL N'..', PostgreSQL E'..', and X'..' hex literals.
    if (next === "'") {
      if ((c === 'N' && (dialect === 'sqlserver' || dialect === 'mysql')) || (c === 'n' && dialect === 'mysql')) {
        const { value, end } = readQuoted(i + 1, "'", dialect === 'mysql' ? 'mysql' : 'none');
        push('str', i, end, value);
        i = end;
        continue;
      }
      if ((c === 'E' || c === 'e') && dialect === 'postgresql') {
        const { value, end } = readQuoted(i + 1, "'", 'postgres');
        push('str', i, end, value);
        i = end;
        continue;
      }
      if ((c === 'X' || c === 'x') && dialect !== 'postgresql') {
        const close = text.indexOf("'", i + 2);
        if (close === -1) fail('A hexadecimal literal starting here is never closed.', i);
        const digits = text.slice(i + 2, close);
        if (!/^[0-9a-fA-F]*$/.test(digits))
          fail('A hexadecimal literal here holds a character that is not a hex digit.', i);
        push('hex', i, close + 1, '0x' + digits);
        i = close + 1;
        continue;
      }
    }

    // Numbers.
    if (isDigit(code) || (c === '.' && next !== undefined && isDigit(next.charCodeAt(0)))) {
      if (c === '0' && (next === 'x' || next === 'X') && dialect !== 'postgresql' && isHexDigit(text[i + 2])) {
        let j = i + 2;
        while (isHexDigit(text[j])) j++;
        push('hex', i, j, '0x' + text.slice(i + 2, j));
        i = j;
        continue;
      }
      let j = i;
      while (j < n && isDigit(text.charCodeAt(j))) j++;
      if (text[j] === '.') {
        j++;
        while (j < n && isDigit(text.charCodeAt(j))) j++;
      }
      if (text[j] === 'e' || text[j] === 'E') {
        let k = j + 1;
        if (text[k] === '+' || text[k] === '-') k++;
        if (k < n && isDigit(text.charCodeAt(k))) {
          while (k < n && isDigit(text.charCodeAt(k))) k++;
          j = k;
        }
      }
      push('num', i, j);
      i = j;
      continue;
    }

    // Words.
    if (isWordStart(code)) {
      let j = i + 1;
      while (j < n && isWordPart(text.charCodeAt(j))) j++;
      const word = text.slice(i, j);
      if (dialect === 'sqlserver' && word.toUpperCase() === 'GO' && aloneOnLine(i, j)) {
        endStatement(i, j, word);
      } else {
        push('word', i, j);
      }
      i = j;
      continue;
    }

    if (c === ';') {
      i++;
      endStatement(i - 1, i, ';');
      continue;
    }

    push('punct', i, i + 1);
    i++;
  }

  return { tokens, copyBlocks };
}

// ---------------------------------------------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------------------------------------------

interface Statement {
  tokens: Token[];
  /** 1-based, counting every statement that holds anything. */
  number: number;
}

function splitStatements(tokens: Token[]): Statement[] {
  const statements: Statement[] = [];
  let current: Token[] = [];
  const finish = (): void => {
    if (current.length > 0) statements.push({ tokens: current, number: statements.length + 1 });
    current = [];
  };
  for (const token of tokens) {
    if (token.type === 'semi') finish();
    else current.push(token);
  }
  finish();
  return statements;
}

type Value = { t: 'null' } | { t: 'bool'; v: boolean } | { t: 'num'; text: string } | { t: 'str'; v: string };

interface TableRecord {
  columns: string[];
  values: Value[];
}

interface TableData {
  name: string;
  lastPart: string;
  columnOrder: string[];
  records: TableRecord[];
}

const upper = (token: Token | undefined): string =>
  token !== undefined && token.type === 'word' ? token.text.toUpperCase() : '';
const isIdentifier = (token: Token | undefined): token is Token =>
  token !== undefined && (token.type === 'word' || token.type === 'dq' || token.type === 'bt' || token.type === 'br');
const isPunct = (token: Token | undefined, text: string): boolean =>
  token !== undefined && token.type === 'punct' && token.text === text;

/** A table name written with dots: each part is a word or a quoted name. */
function readQualifiedName(tokens: Token[], from: number): { parts: string[]; next: number } | null {
  let p = from;
  const parts: string[] = [];
  if (!isIdentifier(tokens[p])) return null;
  parts.push(tokens[p]!.value);
  p++;
  while (isPunct(tokens[p], '.') && isIdentifier(tokens[p + 1])) {
    parts.push(tokens[p + 1]!.value);
    p += 2;
  }
  return { parts, next: p };
}

const TABLE_CONSTRAINT_WORDS = new Set([
  'CONSTRAINT',
  'PRIMARY',
  'FOREIGN',
  'UNIQUE',
  'CHECK',
  'KEY',
  'INDEX',
  'FULLTEXT',
  'SPATIAL',
  'EXCLUDE',
  'LIKE',
  'PERIOD',
]);

/** The column names of a CREATE TABLE statement, or null when it has no parenthesised list (CREATE TABLE ... AS). */
function createTableColumns(tokens: Token[]): { name: string; lastPart: string; columns: string[] } | null {
  let p = 0;
  while (p < tokens.length && upper(tokens[p]) !== 'TABLE') {
    if (p > 8) return null;
    p++;
  }
  if (p >= tokens.length) return null;
  p++;
  if (upper(tokens[p]) === 'IF' && upper(tokens[p + 1]) === 'NOT' && upper(tokens[p + 2]) === 'EXISTS') p += 3;
  const name = readQualifiedName(tokens, p);
  if (name === null || !isPunct(tokens[name.next], '(')) return null;

  const columns: string[] = [];
  let depth = 0;
  let itemStart = name.next + 1;
  const endItem = (end: number): void => {
    const first = tokens[itemStart];
    if (end > itemStart && first !== undefined && isIdentifier(first)) {
      if (!(first.type === 'word' && TABLE_CONSTRAINT_WORDS.has(first.text.toUpperCase()))) columns.push(first.value);
    }
  };
  for (let k = name.next; k < tokens.length; k++) {
    const token = tokens[k]!;
    if (token.type !== 'punct') continue;
    if (token.text === '(') {
      depth++;
    } else if (token.text === ')') {
      depth--;
      if (depth === 0) {
        endItem(k);
        break;
      }
    } else if (token.text === ',' && depth === 1) {
      endItem(k);
      itemStart = k + 1;
    }
  }
  return { name: name.parts.join('.'), lastPart: name.parts[name.parts.length - 1]!, columns };
}

/** What a number literal reads as in JSON text, and whether a program reading it as a double could round it. */
function jsonNumber(sign: string, literal: string): { text: string; lossy: boolean } {
  const match = /^([0-9]*)(?:\.([0-9]*))?([eE][+-]?[0-9]+)?$/.exec(literal);
  if (!match) return { text: sign + literal, lossy: false };
  const integer = (match[1] ?? '').replace(/^0+(?=[0-9])/, '') || '0';
  const fraction = match[2] ?? '';
  const exponent = match[3] ?? '';
  const text = (sign === '-' ? '-' : '') + integer + (fraction === '' ? '' : '.' + fraction) + exponent;
  const significant = (integer + fraction).replace(/^0+/, '').replace(/0+$/, '');
  const wholeBeyondSafe =
    fraction === '' && exponent === '' && integer.length >= 16 && BigInt(integer) > BigInt(Number.MAX_SAFE_INTEGER);
  const lossy = wholeBeyondSafe || significant.length > 15 || !Number.isFinite(Number(text));
  return { text, lossy };
}

interface ReadState {
  dialect: Dialect;
  created: Map<string, { lastPart: string; columns: string[] }>;
  tables: Map<string, TableData>;
  skipped: number;
  expressions: { text: string; column: string; table: string; statement: number }[];
  doubleQuoted: number;
  hexSeen: boolean;
  lossyNumber: boolean;
  trailing: { statement: number; text: string }[];
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

function parseInsert(statement: Statement, state: ReadState, source: string): void {
  const t = statement.tokens;
  const fail = (message: string): never => {
    const first = t[0];
    const position = first ? positionAt(source, first.start) : {};
    throw new DataToSqlError(message, position);
  };

  if (t.some((token) => token.type === 'dollar')) {
    fail(
      `Statement ${statement.number} uses a dollar-quoted string, which is not read. Write the value as an ordinary quoted string.`,
    );
  }
  const selectFail = (): never =>
    fail(
      `Statement ${statement.number} is an INSERT ... SELECT, which cannot be read as rows because the database makes them. Use INSERT ... VALUES.`,
    );

  let p = 1;
  for (;;) {
    const word = upper(t[p]);
    if (word === 'LOW_PRIORITY' || word === 'DELAYED' || word === 'HIGH_PRIORITY' || word === 'IGNORE') {
      p++;
    } else if (word === 'OR' && t[p + 1]?.type === 'word') {
      p += 2;
    } else {
      break;
    }
  }
  if (upper(t[p]) === 'INTO') p++;

  const name = readQualifiedName(t, p);
  if (name === null) fail(`Statement ${statement.number} is an INSERT with no table name after it.`);
  const { parts } = name!;
  p = name!.next;
  const tableName = parts.join('.');
  const lastPart = parts[parts.length - 1]!;

  let columns: string[] | null = null;
  if (isPunct(t[p], '(')) {
    const after = upper(t[p + 1]);
    if (after === 'SELECT' || after === 'WITH') selectFail();
    columns = [];
    p++;
    for (;;) {
      const token = t[p];
      if (!isIdentifier(token))
        fail(`Statement ${statement.number} has something other than a column name in its column list.`);
      if (columns.includes(token!.value)) {
        fail(`Statement ${statement.number} repeats the column "${token!.value}" in its column list.`);
      }
      columns.push(token!.value);
      p++;
      if (isPunct(t[p], ',')) {
        p++;
        continue;
      }
      if (isPunct(t[p], ')')) {
        p++;
        break;
      }
      fail(`Statement ${statement.number} has a column list that is never closed.`);
    }
  }

  const keyword = upper(t[p]);
  if (
    keyword === 'SELECT' ||
    keyword === 'WITH' ||
    (isPunct(t[p], '(') && ['SELECT', 'WITH'].includes(upper(t[p + 1])))
  ) {
    selectFail();
  }
  if (keyword !== 'VALUES' && keyword !== 'VALUE') {
    fail(
      `Statement ${statement.number} is an INSERT without VALUES rows (it continues with ${t[p] ? t[p]!.text : 'nothing'}); only INSERT ... VALUES is read.`,
    );
  }
  p++;

  // The column names: the INSERT's own list, else the list of a CREATE TABLE of the same table, else column_1 on.
  let created: string[] | null = null;
  if (columns === null) {
    const exact = state.created.get(tableName);
    if (exact) {
      created = exact.columns;
    } else {
      for (const entry of state.created.values()) {
        if (entry.lastPart === lastPart) {
          created = entry.columns;
          break;
        }
      }
    }
  }
  let known: string[] | null = columns ?? created;

  const table = ((): TableData => {
    let existing = state.tables.get(tableName);
    if (!existing) {
      existing = { name: tableName, lastPart, columnOrder: [], records: [] };
      state.tables.set(tableName, existing);
    }
    return existing;
  })();

  const postgres = state.dialect === 'postgresql';
  let rowNumber = 0;
  for (;;) {
    rowNumber++;
    if (!isPunct(t[p], '('))
      fail(`Statement ${statement.number}, row ${rowNumber} does not start with an opening parenthesis.`);
    p++;
    const values: Value[] = [];
    for (;;) {
      const valueTokens: Token[] = [];
      let depth = 0;
      while (p < t.length) {
        const token = t[p]!;
        if (token.type === 'punct') {
          if (token.text === '(' || (postgres && token.text === '[')) {
            depth++;
          } else if (token.text === ')' || (postgres && token.text === ']')) {
            if (depth === 0) break;
            depth--;
          } else if (token.text === ',' && depth === 0) {
            break;
          }
        }
        valueTokens.push(token);
        p++;
      }
      if (p >= t.length) fail(`Statement ${statement.number}, row ${rowNumber} is never closed with a parenthesis.`);
      if (valueTokens.length === 0) {
        fail(`Statement ${statement.number}, row ${rowNumber}, value ${values.length + 1} is empty.`);
      }
      values.push(
        readValue(valueTokens, state, source, {
          statement: statement.number,
          table: tableName,
          column: () => (known ?? [])[values.length] ?? `column_${values.length + 1}`,
        }),
      );
      if (isPunct(t[p], ',')) {
        p++;
        continue;
      }
      p++; // the closing parenthesis of the row
      break;
    }

    if (known === null) known = values.map((_, k) => `column_${k + 1}`);
    if (values.length !== known.length) {
      fail(
        `Statement ${statement.number}, row ${rowNumber} has ${values.length} ${plural(values.length, 'value', 'values')} but the table has ${known.length} ${plural(known.length, 'column', 'columns')}.`,
      );
    }
    table.records.push({ columns: known, values });
    for (const column of known) if (!table.columnOrder.includes(column)) table.columnOrder.push(column);

    if (isPunct(t[p], ',')) {
      p++;
      continue;
    }
    break;
  }

  if (p < t.length) {
    state.trailing.push({
      statement: statement.number,
      text: source.slice(t[p]!.start, t[t.length - 1]!.end),
    });
  }
}

function readValue(
  tokens: Token[],
  state: ReadState,
  source: string,
  where: { statement: number; table: string; column: () => string },
): Value {
  if (tokens.length === 1) {
    const token = tokens[0]!;
    switch (token.type) {
      case 'str':
        return { t: 'str', v: token.value };
      case 'num': {
        const number = jsonNumber('', token.text);
        if (number.lossy) state.lossyNumber = true;
        return { t: 'num', text: number.text };
      }
      case 'hex':
        state.hexSeen = true;
        return { t: 'str', v: token.value };
      case 'dq':
        if (state.dialect === 'mysql') return { t: 'str', v: token.value };
        if (state.dialect === 'sqlite') {
          state.doubleQuoted++;
          return { t: 'str', v: token.value };
        }
        break;
      case 'word': {
        const word = token.text.toUpperCase();
        if (word === 'NULL') return { t: 'null' };
        if (word === 'TRUE') return { t: 'bool', v: true };
        if (word === 'FALSE') return { t: 'bool', v: false };
        break;
      }
      default:
        break;
    }
  } else if (
    tokens.length === 2 &&
    tokens[1]!.type === 'num' &&
    tokens[0]!.type === 'punct' &&
    (tokens[0]!.text === '-' || tokens[0]!.text === '+')
  ) {
    const number = jsonNumber(tokens[0]!.text, tokens[1]!.text);
    if (number.lossy) state.lossyNumber = true;
    return { t: 'num', text: number.text };
  }

  const text = source.slice(tokens[0]!.start, tokens[tokens.length - 1]!.end);
  state.expressions.push({ text, column: where.column(), table: where.table, statement: where.statement });
  return { t: 'str', v: text };
}

// ---------------------------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------------------------

function jsonValue(value: Value): string {
  switch (value.t) {
    case 'null':
      return 'null';
    case 'bool':
      return value.v ? 'true' : 'false';
    case 'num':
      return value.text;
    case 'str':
      return JSON.stringify(value.v);
  }
}

/** The records as a JSON array laid out as JSON.stringify(value, null, 2) would, `base` spaces in. */
function jsonArray(records: TableRecord[], base: number): string {
  if (records.length === 0) return '[]';
  const pad = (width: number): string => ' '.repeat(width);
  const items = records.map((record) => {
    if (record.columns.length === 0) return `${pad(base + 2)}{}`;
    const entries = record.columns.map(
      (column, k) => `${pad(base + 4)}${JSON.stringify(column)}: ${jsonValue(record.values[k]!)}`,
    );
    return `${pad(base + 2)}{\n${entries.join(',\n')}\n${pad(base + 2)}}`;
  });
  return `[\n${items.join(',\n')}\n${pad(base)}]`;
}

function csvText(value: Value): string {
  switch (value.t) {
    case 'null':
      return '';
    case 'bool':
      return value.v ? 'true' : 'false';
    case 'num':
      return value.text;
    case 'str':
      return value.v;
  }
}

const names = (list: TableData[]): string => list.map((table) => table.name).join(', ');

/**
 * Turns INSERT ... VALUES statements into rows: a JSON array of objects (several tables give an object keyed by
 * table name) or CSV. Other statements are skipped and counted; a CREATE TABLE column list names the columns of an
 * INSERT that has none. Nothing is executed: a function call or expression in a value is kept as text with a
 * warning. INSERT ... SELECT, dollar-quoted strings in an INSERT and procedural code are refused naming the
 * statement. Pure: the result depends only on the text and the options.
 */
export function sqlToRows(text: string, options: SqlToRowsOptions = {}): SqlToRowsResult {
  const dialect = options.dialect ?? 'postgresql';
  const rowsFormat = options.rowsFormat ?? 'json';
  const filter = (options.tableFilter ?? '').trim();

  if (text.trim() === '') return { output: '', tables: [], skipped: 0, warnings: [], rows: 0 };

  const { tokens, copyBlocks } = tokenize(text, dialect);
  const statements = splitStatements(tokens);
  if (statements.length === 0) return { output: '', tables: [], skipped: 0, warnings: [], rows: 0 };

  const state: ReadState = {
    dialect,
    created: new Map(),
    tables: new Map(),
    skipped: 0,
    expressions: [],
    doubleQuoted: 0,
    hexSeen: false,
    lossyNumber: false,
    trailing: [],
  };

  for (const statement of statements) {
    const first = upper(statement.tokens[0]);
    const where = (): { line: number; column: number } => positionAt(text, statement.tokens[0]!.start);
    if (first === 'DELIMITER') {
      throw new DataToSqlError(
        `Statement ${statement.number} is a DELIMITER command of the mysql client, which changes where statements end, so nothing after it can be split safely.`,
        where(),
      );
    }
    if (first === 'INSERT') {
      parseInsert(statement, state, text);
      continue;
    }
    state.skipped++;
    if (first === 'CREATE') {
      const head = statement.tokens.slice(0, 9).map(upper);
      const procedural = head.some((w) => w === 'TRIGGER' || w === 'PROCEDURE' || w === 'FUNCTION' || w === 'EVENT');
      if (procedural && statement.tokens.some((token) => upper(token) === 'BEGIN')) {
        throw new DataToSqlError(
          `Statement ${statement.number} is procedural code (a CREATE with BEGIN ... END), which holds statements of its own, so it cannot be split safely. Remove it and read the INSERT statements alone.`,
          where(),
        );
      }
      const created = createTableColumns(statement.tokens);
      if (created !== null) state.created.set(created.name, { lastPart: created.lastPart, columns: created.columns });
    }
  }

  const allTables = [...state.tables.values()];
  if (allTables.length === 0) {
    throw new DataToSqlError(
      `No INSERT ... VALUES statement was found. ${state.skipped} other ${plural(state.skipped, 'statement was', 'statements were')} skipped.`,
    );
  }

  let selected = allTables;
  if (filter !== '') {
    selected = allTables.filter((table) => table.name === filter || table.lastPart === filter);
    if (selected.length === 0) {
      throw new DataToSqlError(`No table named "${filter}" was found. The tables are: ${names(allTables)}.`);
    }
  }

  const warnings: string[] = [];
  if (copyBlocks > 0) {
    warnings.push(
      `${copyBlocks} COPY data ${plural(copyBlocks, 'block was', 'blocks were')} skipped, because its lines are data and not SQL. Dump with INSERT statements (pg_dump --inserts) to get its rows.`,
    );
  }
  if (state.hexSeen) {
    warnings.push(
      "Hex values (X'..' and 0x..) are shown as text starting with 0x, because JSON and CSV have no bytes.",
    );
  }
  if (state.doubleQuoted > 0) {
    warnings.push('A double-quoted word in a value was read as a string, as SQLite does when no name can be meant.');
  }
  if (state.lossyNumber && rowsFormat === 'json') {
    warnings.push(
      'A whole number beyond 2^53 or a number with more than 15 significant digits was written with every digit it has, but a program that reads JSON numbers as ordinary doubles may round it.',
    );
  }
  if (state.expressions.length > 0) {
    const count = state.expressions.length;
    const first = state.expressions[0]!;
    warnings.push(
      `${count} ${plural(count, 'value was a function call or expression, which is', 'values were function calls or expressions, which are')} kept as text and never evaluated (first: ${first.text} in column "${first.column}" of "${first.table}", statement ${first.statement}).`,
    );
  }
  for (const item of state.trailing.slice(0, 3)) {
    warnings.push(`Statement ${item.statement} has text after its rows that was left out: ${item.text}`);
  }
  if (state.trailing.length > 3) {
    warnings.push(`${state.trailing.length - 3} more statements had text after their rows that was left out.`);
  }

  let output: string;
  let rows = 0;
  if (rowsFormat === 'csv') {
    if (selected.length !== 1) {
      throw new DataToSqlError(
        `CSV holds one table, but this SQL inserts into ${selected.length} tables (${names(selected)}). Type one of them in Table filter.`,
      );
    }
    const table = selected[0]!;
    const grid: string[][] = [table.columnOrder];
    let nulls = 0;
    let shortRows = false;
    for (const record of table.records) {
      const byColumn = new Map<string, Value>();
      record.columns.forEach((column, k) => byColumn.set(column, record.values[k]!));
      if (record.columns.length < table.columnOrder.length) shortRows = true;
      grid.push(
        table.columnOrder.map((column) => {
          const value = byColumn.get(column);
          if (value === undefined) return '';
          if (value.t === 'null') nulls++;
          return csvText(value);
        }),
      );
    }
    rows = table.records.length;
    if (nulls > 0) {
      warnings.push(
        `${nulls} NULL ${plural(nulls, 'value was', 'values were')} written as an empty cell, because CSV cannot tell NULL from an empty string.`,
      );
    }
    if (shortRows) {
      warnings.push(
        'Some INSERT statements named fewer columns than others, so their rows have empty cells for the rest.',
      );
    }
    output = formatCsv(grid);
  } else if (selected.length === 1) {
    rows = selected[0]!.records.length;
    output = jsonArray(selected[0]!.records, 0);
  } else {
    const entries = selected.map((table) => {
      rows += table.records.length;
      return `  ${JSON.stringify(table.name)}: ${jsonArray(table.records, 2)}`;
    });
    output = `{\n${entries.join(',\n')}\n}`;
  }

  return { output, tables: allTables.map((table) => table.name), skipped: state.skipped, warnings, rows };
}
