/**
 * Shared primitives used by every language module: the error/result types,
 * upper-case hex helpers, a code-point walker that yields an unpaired
 * surrogate as its own unit (never silently merging or dropping it), a UTF-8
 * encoder, and a UTF-8 validator that decodes strictly and reports the first
 * invalid byte offset (used by the Go module, whose escapes are bytes).
 */

export class StringEscapeError extends Error {
  /** UTF-16 index into the input where the problem was found. */
  readonly position?: number;
  /** Byte offset into the accumulated byte stream (Go decode failures only). */
  readonly byteOffset?: number;
  constructor(message: string, position?: number, byteOffset?: number) {
    super(message);
    this.name = 'StringEscapeError';
    this.position = position;
    this.byteOffset = byteOffset;
  }
}

export interface LiteralWarning {
  message: string;
  position: number;
}

export interface LiteralResult {
  value: string;
  warnings: LiteralWarning[];
}

export function hex2(code: number): string {
  return code.toString(16).toUpperCase().padStart(2, '0');
}
export function hex4(code: number): string {
  return code.toString(16).toUpperCase().padStart(4, '0');
}
export function hex8(code: number): string {
  return code.toString(16).toUpperCase().padStart(8, '0');
}
/** Hex with no fixed width, upper case, no leading zero padding beyond one digit. */
export function hexBare(code: number): string {
  return code.toString(16).toUpperCase();
}

export interface CodeUnit {
  /** The code point for a complete character, or the lone surrogate's own code unit value. */
  code: number;
  /** True when this unit is a complete character outside the Basic Multilingual Plane. */
  astral: boolean;
  /** True when this unit is an unpaired surrogate half. */
  lone: boolean;
  /** Index into the original string where this unit starts. */
  index: number;
  /** Number of UTF-16 code units this entry consumed (1 or 2). */
  length: number;
}

/**
 * Walks a string by code point. A high surrogate immediately followed by a
 * low surrogate is combined into one astral entry; anything else in the
 * surrogate range is yielded as its own one-unit "lone" entry rather than
 * throwing or silently combining with an unrelated neighbour.
 */
export function* walkCodePoints(text: string): Generator<CodeUnit> {
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const astralCode = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        yield { code: astralCode, astral: true, lone: false, index: i, length: 2 };
        i += 2;
        continue;
      }
      yield { code, astral: false, lone: true, index: i, length: 1 };
      i += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      yield { code, astral: false, lone: true, index: i, length: 1 };
      i += 1;
      continue;
    }
    yield { code, astral: false, lone: false, index: i, length: 1 };
    i += 1;
  }
}

/** Encodes one Unicode code point (never a lone surrogate) as UTF-8 bytes. */
export function encodeUtf8CodePoint(code: number): number[] {
  if (code < 0x80) return [code];
  if (code < 0x800) return [0xc0 | (code >> 6), 0x80 | (code & 0x3f)];
  if (code < 0x10000) {
    return [0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)];
  }
  return [0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)];
}

export interface Utf8DecodeResult {
  ok: boolean;
  /** Byte offset of the first invalid byte, when ok is false. */
  invalidByteOffset?: number;
  text?: string;
}

/**
 * Decodes a byte array as UTF-8 by hand (never via TextDecoder) so the exact
 * byte offset of the first invalid byte can be reported. Rejects overlong
 * encodings, surrogate code points and out-of-range code points.
 */
export function decodeUtf8Strict(bytes: number[]): Utf8DecodeResult {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i]!;
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
      continue;
    }
    let need: number;
    let min: number;
    let code: number;
    if ((b0 & 0xe0) === 0xc0) {
      need = 1;
      min = 0x80;
      code = b0 & 0x1f;
    } else if ((b0 & 0xf0) === 0xe0) {
      need = 2;
      min = 0x800;
      code = b0 & 0x0f;
    } else if ((b0 & 0xf8) === 0xf0) {
      need = 3;
      min = 0x10000;
      code = b0 & 0x07;
    } else {
      return { ok: false, invalidByteOffset: i };
    }
    if (i + need >= bytes.length) return { ok: false, invalidByteOffset: i };
    for (let k = 1; k <= need; k++) {
      const b = bytes[i + k]!;
      if ((b & 0xc0) !== 0x80) return { ok: false, invalidByteOffset: i };
      code = (code << 6) | (b & 0x3f);
    }
    if (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return { ok: false, invalidByteOffset: i };
    }
    if (code >= 0x10000) {
      const c = code - 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
    i += 1 + need;
  }
  return { ok: true, text: out };
}

/**
 * Strips a wrap-mode literal's surrounding quote, matching the shared
 * unescape rule: the input must start and end with a quote character drawn
 * from `quoteChars`, both ends the same character, otherwise it throws at
 * position 0 with a message naming the "includes the surrounding quotes"
 * checkbox. An optional `prefix` (used by C# verbatim's leading `@`) must
 * appear before the quote.
 */
export const WRAP_START_MESSAGE =
  'expected the literal to start with a quote; untick "Input includes the surrounding quotes" to read the text between the quotes';

export function stripWrap(
  literal: string,
  quoteChars: readonly string[],
  prefix = '',
): { inner: string; quote: string } {
  const START_MESSAGE = WRAP_START_MESSAGE;
  let body = literal;
  if (prefix) {
    if (!literal.startsWith(prefix)) {
      throw new StringEscapeError(START_MESSAGE, 0);
    }
    body = literal.slice(prefix.length);
  }
  const q = body[0];
  if (!q || !quoteChars.includes(q) || body.length < 2 || body[body.length - 1] !== q) {
    throw new StringEscapeError(START_MESSAGE, 0);
  }
  return { inner: body.slice(1, -1), quote: q };
}
