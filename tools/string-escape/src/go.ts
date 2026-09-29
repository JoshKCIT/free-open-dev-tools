/**
 * Go interpreted string literals (The Go Programming Language Specification,
 * "Rune literals" and "String literals"). Go strings are UTF-8 byte
 * sequences: `\ooo` and `\xHH` write bytes directly, so unescape accumulates
 * bytes with a byte-to-input-position map and validates the result as UTF-8
 * once scanning finishes, reporting the byte offset of the first bad byte.
 */
import {
  StringEscapeError,
  type LiteralResult,
  type LiteralWarning,
  hex2,
  hex4,
  hex8,
  walkCodePoints,
  encodeUtf8CodePoint,
  decodeUtf8Strict,
} from './shared';

const SIMPLE_ESCAPES: Record<number, string> = {
  0x5c: '\\\\',
  0x22: '\\"',
  0x07: '\\a',
  0x08: '\\b',
  0x0c: '\\f',
  0x0a: '\\n',
  0x0d: '\\r',
  0x09: '\\t',
  0x0b: '\\v',
};

export interface GoEscapeOptions {
  escapeNonAscii: boolean;
}

export function escapeContents(text: string, options: GoEscapeOptions): LiteralResult {
  const warnings: LiteralWarning[] = [];
  let out = '';
  for (const unit of walkCodePoints(text)) {
    const { code, astral, lone, index } = unit;
    if (lone) {
      throw new StringEscapeError(
        `U+${hex4(code)} is an unpaired surrogate, which cannot be represented in a Go string (Go strings are UTF-8, and a surrogate has no UTF-8 form)`,
        index,
      );
    }
    if (astral) {
      out += options.escapeNonAscii ? '\\U' + hex8(code) : String.fromCodePoint(code);
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

const SIMPLE_UNESCAPE_BYTES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
  '\\': 0x5c,
  '"': 0x22,
};

export function unescapeContents(body: string, baseOffset: number): LiteralResult {
  const warnings: LiteralWarning[] = [];
  const bytes: number[] = [];
  const bytePositions: number[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i]!;
    const code = body.charCodeAt(i);
    if (ch === '\n' || ch === '\r') {
      throw new StringEscapeError('a raw line break cannot appear in a Go interpreted string literal', baseOffset + i);
    }
    if (ch === '"') {
      throw new StringEscapeError('this quote would end the literal early', baseOffset + i);
    }
    if (ch === '`') {
      throw new StringEscapeError('raw string literals (backtick-quoted) are refused', baseOffset + i);
    }
    if (ch !== '\\') {
      let cp = code;
      let consumed = 1;
      if (code >= 0xd800 && code <= 0xdbff) {
        const nextCode = body.charCodeAt(i + 1);
        if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
          cp = (code - 0xd800) * 0x400 + (nextCode - 0xdc00) + 0x10000;
          consumed = 2;
        }
      }
      for (const b of encodeUtf8CodePoint(cp)) {
        bytes.push(b);
        bytePositions.push(baseOffset + i);
      }
      i += consumed;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) {
      throw new StringEscapeError('a reverse solidus at the end of the input has nothing to escape', baseOffset + i);
    }
    if (next === "'") {
      throw new StringEscapeError("\\' is only valid in a rune literal", baseOffset + i);
    }
    const simpleByte = SIMPLE_UNESCAPE_BYTES[next];
    if (simpleByte !== undefined) {
      bytes.push(simpleByte);
      bytePositions.push(baseOffset + i);
      i += 2;
      continue;
    }
    if (next >= '0' && next <= '7') {
      const digits = body.slice(i + 1, i + 4);
      if (!/^[0-7]{3}$/.test(digits)) {
        throw new StringEscapeError('"\\ooo" must be followed by exactly three octal digits', baseOffset + i);
      }
      const value = parseInt(digits, 8);
      if (value > 255) {
        throw new StringEscapeError(
          `\\${digits} is ${value}, greater than 255, which is not a valid byte value`,
          baseOffset + i,
        );
      }
      bytes.push(value);
      bytePositions.push(baseOffset + i);
      i += 4;
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
      bytes.push(parseInt(hex, 16));
      bytePositions.push(baseOffset + i);
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
      const value = parseInt(hex, 16);
      if (value >= 0xd800 && value <= 0xdfff) {
        throw new StringEscapeError(`\\u${hex} is a surrogate half, not a valid Go rune value`, baseOffset + i);
      }
      for (const b of encodeUtf8CodePoint(value)) {
        bytes.push(b);
        bytePositions.push(baseOffset + i);
      }
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
      if ((value >= 0xd800 && value <= 0xdfff) || value > 0x10ffff) {
        throw new StringEscapeError(`\\U${hex} is not a valid Go rune value`, baseOffset + i);
      }
      for (const b of encodeUtf8CodePoint(value)) {
        bytes.push(b);
        bytePositions.push(baseOffset + i);
      }
      i += 10;
      continue;
    }
    throw new StringEscapeError(`"\\${next}" is not a Go escape sequence`, baseOffset + i);
  }
  const decoded = decodeUtf8Strict(bytes);
  if (!decoded.ok) {
    const byteOffset = decoded.invalidByteOffset!;
    const pos = bytePositions[byteOffset] ?? baseOffset;
    throw new StringEscapeError(`byte offset ${byteOffset} of the decoded bytes is not valid UTF-8`, pos, byteOffset);
  }
  return { value: decoded.text!, warnings };
}
