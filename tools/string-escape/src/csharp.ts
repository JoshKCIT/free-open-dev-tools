/**
 * C# string literals (C# language specification, Lexical structure, string
 * literals: regular_string_literal and verbatim_string_literal).
 */
import { StringEscapeError, type LiteralResult, type LiteralWarning, hex4, walkCodePoints } from './shared';

const SIMPLE_ESCAPES: Record<number, string> = {
  0x22: '\\"',
  0x5c: '\\\\',
  0x00: '\\0',
  0x07: '\\a',
  0x08: '\\b',
  0x0c: '\\f',
  0x0a: '\\n',
  0x0d: '\\r',
  0x09: '\\t',
  0x0b: '\\v',
};

/** New-line characters C# regular literals may never contain raw, beyond LF/CR. */
const EXTRA_NEWLINES = new Set([0x85, 0x2028, 0x2029]);

export interface CSharpEscapeOptions {
  escapeNonAscii: boolean;
}

export function escapeContents(text: string, options: CSharpEscapeOptions): LiteralResult {
  const warnings: LiteralWarning[] = [];
  let out = '';
  for (const unit of walkCodePoints(text)) {
    const { code, astral, lone } = unit;
    if (lone) {
      out += '\\u' + hex4(code);
      continue;
    }
    if (astral) {
      const c = code - 0x10000;
      const hi = 0xd800 + (c >> 10);
      const lo = 0xdc00 + (c & 0x3ff);
      out += options.escapeNonAscii ? '\\u' + hex4(hi) + '\\u' + hex4(lo) : String.fromCharCode(hi, lo);
      continue;
    }
    const simple = SIMPLE_ESCAPES[code];
    if (simple !== undefined) {
      out += simple;
      continue;
    }
    if (code < 0x20 || code === 0x7f || EXTRA_NEWLINES.has(code)) {
      out += '\\u' + hex4(code);
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
  '"': '"',
  "'": "'",
  '\\': '\\',
  '0': '\0',
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

/** Unescapes C# regular string literal contents (quotes already stripped). */
export function unescapeContents(body: string, baseOffset: number): LiteralResult {
  const warnings: LiteralWarning[] = [];
  let out = '';
  let i = 0;
  while (i < body.length) {
    const ch = body[i]!;
    const code = body.charCodeAt(i);
    if (ch === '\n' || ch === '\r' || EXTRA_NEWLINES.has(code)) {
      throw new StringEscapeError(
        'a raw new-line character cannot appear in a C# regular string literal',
        baseOffset + i,
      );
    }
    if (ch === '"') {
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
      if (value >= 0x10000) {
        const c = value - 0x10000;
        out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
      } else {
        out += String.fromCharCode(value);
      }
      i += 10;
      continue;
    }
    if (next === 'x') {
      // Greedy: one to four hex digits.
      const match = /^[0-9a-fA-F]{1,4}/.exec(body.slice(i + 2, i + 6));
      if (!match) {
        throw new StringEscapeError('"\\x" must be followed by one to four hexadecimal digits', baseOffset + i);
      }
      out += String.fromCharCode(parseInt(match[0], 16));
      i += 2 + match[0].length;
      continue;
    }
    if (next === 'e') {
      warnings.push({ message: '\\e needs C# 13 or later', position: baseOffset + i });
      out += '\x1b';
      i += 2;
      continue;
    }
    const simple = SIMPLE_UNESCAPES[next];
    if (simple !== undefined) {
      out += simple;
      i += 2;
      continue;
    }
    throw new StringEscapeError(`"\\${next}" is not a C# escape sequence`, baseOffset + i);
  }
  return { value: out, warnings };
}

/** Verbatim (@"...") escape: only the quote doubles. */
export function escapeVerbatim(text: string): LiteralResult {
  return { value: text.replace(/"/g, '""'), warnings: [] };
}

/** Verbatim unescape: "" reads as ", a lone " is refused, raw line breaks are fine. */
export function unescapeVerbatim(body: string, baseOffset: number): LiteralResult {
  let out = '';
  let i = 0;
  while (i < body.length) {
    if (body[i] === '"') {
      if (body[i + 1] === '"') {
        out += '"';
        i += 2;
        continue;
      }
      throw new StringEscapeError(
        'a lone quote is not valid inside a verbatim string; "" is needed to mean one quote',
        baseOffset + i,
      );
    }
    out += body[i];
    i++;
  }
  return { value: out, warnings: [] };
}
