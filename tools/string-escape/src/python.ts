/**
 * Python str literals (Python Language Reference, Lexical analysis, 2.4.1
 * String and Bytes literals and 2.4.2 Escape sequences).
 */
import { StringEscapeError, type LiteralResult, type LiteralWarning, hex2, hex4, hex8, walkCodePoints } from './shared';

const SIMPLE_ESCAPES: Record<number, string> = {
  0x5c: '\\\\',
  0x0a: '\\n',
  0x0d: '\\r',
  0x09: '\\t',
};

export interface PyEscapeOptions {
  quote: string;
  escapeNonAscii: boolean;
}

export function escapeContents(text: string, options: PyEscapeOptions): LiteralResult {
  const warnings: LiteralWarning[] = [];
  let out = '';
  for (const unit of walkCodePoints(text)) {
    const { code, astral, lone } = unit;
    if (lone) {
      out += '\\u' + hex4(code);
      continue;
    }
    if (astral) {
      out += options.escapeNonAscii ? '\\U' + hex8(code) : String.fromCodePoint(code);
      continue;
    }
    if (String.fromCharCode(code) === options.quote) {
      out += '\\' + options.quote;
      continue;
    }
    const simple = SIMPLE_ESCAPES[code];
    if (simple !== undefined) {
      out += simple;
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      out += '\\x' + hex2(code);
      continue;
    }
    if (options.escapeNonAscii && code > 0x7f) {
      out += '\\u' + hex4(code);
      continue;
    }
    out += String.fromCharCode(code);
  }
  return { value: out, warnings };
}

const SIMPLE_UNESCAPES: Record<string, string> = {
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  "'": "'",
  '"': '"',
};

function unescapeContents(body: string, baseOffset: number, quoteChar: string): LiteralResult {
  const warnings: LiteralWarning[] = [];
  let out = '';
  let i = 0;
  while (i < body.length) {
    const ch = body[i]!;
    if (ch === '\n' || ch === '\r') {
      throw new StringEscapeError('a raw line break cannot appear in a Python string literal', baseOffset + i);
    }
    if (ch === quoteChar) {
      throw new StringEscapeError('this quote would end the literal early', baseOffset + i);
    }
    if (ch !== '\\') {
      out += ch;
      i++;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) {
      throw new StringEscapeError('a reverse solidus at the end of the input has nothing to escape', baseOffset + i);
    }
    if (next === '\n') {
      i += 2;
      continue;
    }
    if (next === '\r') {
      i += body[i + 2] === '\n' ? 3 : 2;
      continue;
    }
    if (next === 'x') {
      const hex = body.slice(i + 2, i + 4);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        throw new StringEscapeError(
          `"\\x" must be followed by exactly two hexadecimal digits; found "${hex}"`,
          baseOffset + i,
        );
      }
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
      continue;
    }
    if (next === 'u') {
      const hex = body.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        throw new StringEscapeError(
          `"\\u" must be followed by exactly four hexadecimal digits; found "${hex}"`,
          baseOffset + i,
        );
      }
      out += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    if (next === 'U') {
      const hex = body.slice(i + 2, i + 10);
      if (!/^[0-9a-fA-F]{8}$/.test(hex)) {
        throw new StringEscapeError(
          `"\\U" must be followed by exactly eight hexadecimal digits; found "${hex}"`,
          baseOffset + i,
        );
      }
      const value = parseInt(hex, 16);
      if (value > 0x10ffff) {
        throw new StringEscapeError(`\\U${hex} is above the maximum code point 10FFFF`, baseOffset + i);
      }
      out += String.fromCodePoint(value);
      i += 10;
      continue;
    }
    if (next === 'N') {
      throw new StringEscapeError(
        'Unicode character names are not supported: this tool bundles no name table',
        baseOffset + i,
      );
    }
    if (next >= '0' && next <= '7') {
      let digits = next;
      let k = i + 2;
      while (digits.length < 3 && body[k] !== undefined && body[k]! >= '0' && body[k]! <= '7') {
        digits += body[k];
        k++;
      }
      const value = parseInt(digits, 8);
      if (value > 0o377) {
        warnings.push({
          message: `octal escape \\${digits} is above \\377; Python 3.12+ warns about this`,
          position: baseOffset + i,
        });
      }
      out += String.fromCharCode(value);
      i = k;
      continue;
    }
    const simple = SIMPLE_UNESCAPES[next];
    if (simple !== undefined) {
      out += simple;
      i += 2;
      continue;
    }
    warnings.push({
      message: `"\\${next}" is not a recognised escape sequence; kept as written, as CPython does`,
      position: baseOffset + i,
    });
    out += '\\' + next;
    i += 2;
  }
  return { value: out, warnings };
}

/** Unescapes a full Python literal, handling the optional `u`/`U` prefix and refusing `r`, `b`, `f` prefixes and triple-quoted forms. */
export function unescape(literal: string, options: { wrap: boolean; quote: string }): LiteralResult {
  if (!options.wrap) {
    return unescapeContents(literal, 0, options.quote);
  }
  const prefixMatch = /^[A-Za-z]*/.exec(literal)!;
  const prefix = prefixMatch[0];
  const rest = literal.slice(prefix.length);
  const lowerPrefix = prefix.toLowerCase();
  if (/r/.test(lowerPrefix)) {
    throw new StringEscapeError(
      'raw string prefixes (r"...") are refused: this tool reads and writes ordinary escaped literals only',
      0,
    );
  }
  if (/b/.test(lowerPrefix)) {
    throw new StringEscapeError('byte string prefixes (b"...") are refused', 0);
  }
  if (/f/.test(lowerPrefix)) {
    throw new StringEscapeError('f-string prefixes (f"...") are refused: expressions inside {} are not evaluated', 0);
  }
  if (prefix !== '' && lowerPrefix !== 'u') {
    throw new StringEscapeError(`"${prefix}" is not a supported string literal prefix`, 0);
  }
  if (rest.startsWith('"""') || rest.startsWith("'''")) {
    throw new StringEscapeError('triple-quoted strings are refused', 0);
  }
  const q = rest[0];
  if (!q || (q !== '"' && q !== "'") || rest.length < 2 || rest[rest.length - 1] !== q) {
    throw new StringEscapeError(
      'expected the literal to start with a quote; untick "Input includes the surrounding quotes" to read the text between the quotes',
      0,
    );
  }
  const body = rest.slice(1, -1);
  return unescapeContents(body, prefix.length + 1, q);
}
