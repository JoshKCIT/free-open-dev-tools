/**
 * A small tokenizer for the documented CREATE TABLE subset (see index.ts).
 * Identifiers may be written bare, or quoted with double quotes, backticks
 * or square brackets -- SQLite's own keyword docs note that it accepts all
 * three quoting forms "for compatibility" with PostgreSQL, MySQL and SQL
 * Server respectively, so this tokenizer accepts all three regardless of
 * the dialect passed to the parser, rather than rejecting a MySQL-quoted
 * identifier in a PostgreSQL document or vice versa. A string literal is
 * always single-quoted; this project never assumes MySQL's non-default
 * ANSI_QUOTES mode, so a double-quoted token is always read as an
 * identifier, never as a string.
 */

export class SqlSyntaxError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = 'SqlSyntaxError';
    this.line = line;
    this.column = column;
  }
}

export type TokenType = 'ident' | 'string' | 'number' | 'punct' | 'eof';

export interface Token {
  type: TokenType;
  /** Decoded text: the unescaped identifier or string value, or the literal characters for a number or punctuation token. */
  text: string;
  /** True for an identifier token that was written quoted in the source (so it is never treated as a keyword). */
  quoted?: boolean;
  line: number;
  column: number;
}

const PUNCT = new Set(['(', ')', ',', '.', ';']);

class Reader {
  readonly source: string;
  index = 0;
  line = 1;
  lineStart = 0;

  constructor(source: string) {
    this.source = source;
  }

  get position(): { line: number; column: number } {
    return { line: this.line, column: this.index - this.lineStart + 1 };
  }

  peek(ahead = 0): string | undefined {
    return this.source[this.index + ahead];
  }

  advance(n = 1): void {
    for (let i = 0; i < n; i++) {
      if (this.source[this.index] === '\n') {
        this.line++;
        this.lineStart = this.index + 1;
      }
      this.index++;
    }
  }

  atEnd(): boolean {
    return this.index >= this.source.length;
  }
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

function skipWhitespaceAndComments(reader: Reader): void {
  for (;;) {
    const ch = reader.peek();
    if (ch === undefined) return;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      reader.advance();
      continue;
    }
    if (ch === '-' && reader.peek(1) === '-') {
      while (!reader.atEnd() && reader.peek() !== '\n') reader.advance();
      continue;
    }
    if (ch === '/' && reader.peek(1) === '*') {
      reader.advance(2);
      while (!reader.atEnd() && !(reader.peek() === '*' && reader.peek(1) === '/')) reader.advance();
      if (reader.atEnd()) {
        const at = reader.position;
        throw new SqlSyntaxError('A block comment here is never closed.', at.line, at.column);
      }
      reader.advance(2);
      continue;
    }
    return;
  }
}

function readQuoted(reader: Reader, open: string, close: string, kind: string): { text: string } {
  const start = reader.position;
  reader.advance(); // opening
  let out = '';
  for (;;) {
    if (reader.atEnd()) throw new SqlSyntaxError(`This ${kind} is never closed.`, start.line, start.column);
    const ch = reader.peek()!;
    if (ch === close) {
      if (reader.peek(1) === close) {
        out += close;
        reader.advance(2);
        continue;
      }
      reader.advance();
      return { text: out };
    }
    out += ch;
    reader.advance();
  }
}

/** Tokenizes `sql` into a flat stream ending with a single `eof` token. */
export function tokenize(sql: string): Token[] {
  const reader = new Reader(sql);
  const tokens: Token[] = [];

  for (;;) {
    skipWhitespaceAndComments(reader);
    if (reader.atEnd()) break;
    const at = reader.position;
    const ch = reader.peek()!;

    if (ch === '"') {
      const { text } = readQuoted(reader, '"', '"', 'quoted identifier');
      tokens.push({ type: 'ident', text, quoted: true, line: at.line, column: at.column });
      continue;
    }
    if (ch === '`') {
      const { text } = readQuoted(reader, '`', '`', 'backtick-quoted identifier');
      tokens.push({ type: 'ident', text, quoted: true, line: at.line, column: at.column });
      continue;
    }
    if (ch === '[') {
      // Bracket identifiers double an embedded closing bracket, per SQL
      // Server's own docs; there is no escape for an embedded opening bracket.
      reader.advance();
      let out = '';
      for (;;) {
        if (reader.atEnd())
          throw new SqlSyntaxError('This bracket-quoted identifier is never closed.', at.line, at.column);
        const c = reader.peek()!;
        if (c === ']') {
          if (reader.peek(1) === ']') {
            out += ']';
            reader.advance(2);
            continue;
          }
          reader.advance();
          break;
        }
        out += c;
        reader.advance();
      }
      tokens.push({ type: 'ident', text: out, quoted: true, line: at.line, column: at.column });
      continue;
    }
    if (ch === "'") {
      const { text } = readQuoted(reader, "'", "'", 'string');
      tokens.push({ type: 'string', text, line: at.line, column: at.column });
      continue;
    }
    if (isIdentStart(ch)) {
      let out = ch;
      reader.advance();
      while (!reader.atEnd() && isIdentPart(reader.peek()!)) {
        out += reader.peek();
        reader.advance();
      }
      tokens.push({ type: 'ident', text: out, line: at.line, column: at.column });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(reader.peek(1) ?? ''))) {
      let out = ch;
      reader.advance();
      while (!reader.atEnd() && /[0-9]/.test(reader.peek()!)) {
        out += reader.peek();
        reader.advance();
      }
      if (reader.peek() === '.' && /[0-9]/.test(reader.peek(1) ?? '')) {
        out += '.';
        reader.advance();
        while (!reader.atEnd() && /[0-9]/.test(reader.peek()!)) {
          out += reader.peek();
          reader.advance();
        }
      }
      tokens.push({ type: 'number', text: out, line: at.line, column: at.column });
      continue;
    }
    if (PUNCT.has(ch)) {
      reader.advance();
      tokens.push({ type: 'punct', text: ch, line: at.line, column: at.column });
      continue;
    }

    // Any other printable character (=, <, >, +, -, *, /, %, |, &, ~, :, ^,
    // !, and so on) becomes its own single-character punctuation token
    // rather than a tokenize-time failure. This grammar only ever models
    // the documented CREATE TABLE subset; everything outside it -- a CHECK
    // expression, a REFERENCES clause, an operator inside a DEFAULT
    // expression -- is meant to be skipped and reported at the PARSE level
    // (see parse.ts's skipToBoundary), never rejected before parsing even
    // starts. A genuinely unreadable document still fails, just later, at
    // the point parsing actually needs to make sense of the tokens.
    reader.advance();
    tokens.push({ type: 'punct', text: ch, line: at.line, column: at.column });
  }

  const end = reader.position;
  tokens.push({ type: 'eof', text: '', line: end.line, column: end.column });
  return tokens;
}
