/**
 * SQL string literals. Standard style follows the ISO/IEC 9075 character
 * string literal rule (`'` doubles), as also documented in the PostgreSQL
 * manual's "String Constants" section. MySQL/MariaDB style follows the
 * MySQL Reference Manual "String Literals" backslash-escape table.
 */
import { StringEscapeError, type LiteralResult, type LiteralWarning } from './shared';

export type SqlStyle = 'standard' | 'mysql';

const MYSQL_SIMPLE_ESCAPES: Record<number, string> = {
  0x00: '\\0',
  0x27: "\\'",
  0x22: '\\"',
  0x08: '\\b',
  0x0a: '\\n',
  0x0d: '\\r',
  0x09: '\\t',
  0x1a: '\\Z',
  0x5c: '\\\\',
};

export function escapeContents(text: string, style: SqlStyle): LiteralResult {
  const warnings: LiteralWarning[] = [];
  if (style === 'standard') {
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (ch === "'") {
        out += "''";
        continue;
      }
      if (text.charCodeAt(i) === 0) {
        warnings.push({
          message: 'PostgreSQL rejects NUL (U+0000) in text values, and the standard form has no escape for it',
          position: i,
        });
      }
      out += ch;
    }
    return { value: out, warnings };
  }
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const simple = MYSQL_SIMPLE_ESCAPES[code];
    out += simple !== undefined ? simple : ch;
  }
  return { value: out, warnings };
}

const START_MESSAGE =
  'expected the literal to start with a quote; untick "Input includes the surrounding quotes" to read the text between the quotes';

function unescapeStandardContent(body: string, baseOffset: number): LiteralResult {
  let out = '';
  let i = 0;
  while (i < body.length) {
    if (body[i] === "'") {
      if (body[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      throw new StringEscapeError('this quote would end the literal early', baseOffset + i);
    }
    out += body[i];
    i++;
  }
  return { value: out, warnings: [] };
}

const MYSQL_UNESCAPES: Record<string, string> = {
  '0': '\0',
  "'": "'",
  '"': '"',
  b: '\b',
  n: '\n',
  r: '\r',
  t: '\t',
  Z: '\x1a',
  '\\': '\\',
};

function unescapeMysqlContent(body: string, baseOffset: number, quoteChar: string): LiteralResult {
  let out = '';
  let i = 0;
  while (i < body.length) {
    const ch = body[i]!;
    if (ch === quoteChar) {
      if (body[i + 1] === quoteChar) {
        out += quoteChar;
        i += 2;
        continue;
      }
      throw new StringEscapeError('this quote would end the literal early', baseOffset + i);
    }
    if (ch !== '\\') {
      out += ch;
      i++;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) {
      out += '\\';
      i++;
      continue;
    }
    if (next === '%' || next === '_') {
      out += '\\' + next;
      i += 2;
      continue;
    }
    const mapped = MYSQL_UNESCAPES[next];
    out += mapped !== undefined ? mapped : next;
    i += 2;
  }
  return { value: out, warnings: [] };
}

export function unescape(literal: string, options: { wrap: boolean; sqlStyle: SqlStyle }): LiteralResult {
  if (options.sqlStyle === 'standard') {
    if (!options.wrap) return unescapeStandardContent(literal, 0);
    if (literal.length < 2 || literal[0] !== "'" || literal[literal.length - 1] !== "'") {
      throw new StringEscapeError(START_MESSAGE, 0);
    }
    return unescapeStandardContent(literal.slice(1, -1), 1);
  }
  if (!options.wrap) return unescapeMysqlContent(literal, 0, "'");
  const q = literal[0];
  if (!q || (q !== "'" && q !== '"') || literal.length < 2 || literal[literal.length - 1] !== q) {
    throw new StringEscapeError(START_MESSAGE, 0);
  }
  return unescapeMysqlContent(literal.slice(1, -1), 1, q);
}
