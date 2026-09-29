/**
 * JavaScript / TypeScript string literals (ECMA-262 13th edition, section
 * 12.9.4 String Literals, plus Annex B.1.2 legacy octal escape sequences).
 *
 * `escapeContents`/`unescapeContents` handle the literal's contents only;
 * the surrounding quote characters are added and stripped by index.ts so
 * the wrap and perLine rules stay in one place across every language that
 * shares them.
 */
import {
  StringEscapeError,
  type LiteralResult,
  type LiteralWarning,
  hex2,
  hex4,
  hexBare,
  walkCodePoints,
} from './shared';

export const QUOTE_CHARS = ['"', "'"] as const;
export const DEFAULT_QUOTE = '"';

const SIMPLE_ESCAPES: Record<number, string> = {
  0x08: '\\b',
  0x0c: '\\f',
  0x0a: '\\n',
  0x0d: '\\r',
  0x09: '\\t',
  0x0b: '\\v',
  0x5c: '\\\\',
};

export interface JsEscapeOptions {
  quote: string;
  escapeNonAscii: boolean;
}

export function escapeContents(text: string, options: JsEscapeOptions): LiteralResult {
  const { quote, escapeNonAscii } = options;
  const warnings: LiteralWarning[] = [];
  let out = '';
  for (const unit of walkCodePoints(text)) {
    const { code, astral, lone } = unit;
    if (lone) {
      out += '\\u' + hex4(code);
      continue;
    }
    if (astral) {
      if (escapeNonAscii) {
        out += '\\u{' + hexBare(code) + '}';
      } else {
        const c = code - 0x10000;
        out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
      }
      continue;
    }
    const simple = SIMPLE_ESCAPES[code];
    if (simple !== undefined) {
      out += simple;
      continue;
    }
    if (String.fromCharCode(code) === quote) {
      out += '\\' + quote;
      continue;
    }
    if (code === 0x00) {
      out += '\\x00';
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      out += '\\x' + hex2(code);
      continue;
    }
    if (code === 0x2028 || code === 0x2029) {
      out += '\\u' + hex4(code);
      continue;
    }
    if (escapeNonAscii && code > 0x7f) {
      out += '\\u' + hex4(code);
      continue;
    }
    out += String.fromCharCode(code);
  }
  return { value: out, warnings };
}

const SIMPLE_UNESCAPES: Record<string, string> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  '"': '"',
  "'": "'",
};

export interface JsUnescapeOptions {
  quote: string;
}

/**
 * Unescapes JavaScript string literal contents. Refuses a raw line feed or
 * carriage return (only legal inside a template literal, which this tool
 * refuses entirely) and a raw occurrence of the wrapping quote character.
 * U+2028/U+2029 are allowed raw (ECMA-262's LineTerminatorSequence excludes
 * them from what a plain string literal must escape).
 */
export function unescapeContents(text: string, options: JsUnescapeOptions): LiteralResult {
  const { quote } = options;
  const warnings: LiteralWarning[] = [];
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\n' || ch === '\r') {
      throw new StringEscapeError('a raw line break cannot appear in a JavaScript string literal', i);
    }
    if (ch === quote) {
      throw new StringEscapeError('this quote would end the literal early', i);
    }
    if (ch !== '\\') {
      out += ch;
      i++;
      continue;
    }
    const next = text[i + 1];
    if (next === undefined) {
      throw new StringEscapeError('a reverse solidus at the end of the input has nothing to escape', i);
    }
    // Line continuation: backslash followed by a line terminator yields nothing.
    if (next === '\n') {
      i += 2;
      continue;
    }
    if (next === '\r') {
      i += text[i + 2] === '\n' ? 3 : 2;
      continue;
    }
    if (next === ' ' || next === ' ') {
      i += 2;
      continue;
    }
    if (next === 'x') {
      const hex = text.slice(i + 2, i + 4);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        throw new StringEscapeError(`"\\x" must be followed by exactly two hexadecimal digits; found "${hex}"`, i);
      }
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
      continue;
    }
    if (next === 'u') {
      if (text[i + 2] === '{') {
        const end = text.indexOf('}', i + 3);
        if (end === -1) {
          throw new StringEscapeError('"\\u{" has no closing "}"', i);
        }
        const digits = text.slice(i + 3, end);
        if (digits.length === 0 || !/^[0-9a-fA-F]+$/.test(digits)) {
          throw new StringEscapeError('"\\u{...}" must contain one or more hexadecimal digits', i);
        }
        const value = parseInt(digits, 16);
        if (value > 0x10ffff) {
          throw new StringEscapeError(`\\u{${digits}} is ${value}, which is above the maximum code point 10FFFF`, i);
        }
        if (value >= 0x10000) {
          const c = value - 0x10000;
          out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
        } else {
          out += String.fromCharCode(value);
        }
        i = end + 1;
        continue;
      }
      const hex = text.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        throw new StringEscapeError(`"\\u" must be followed by exactly four hexadecimal digits; found "${hex}"`, i);
      }
      out += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    // \0 not followed by a decimal digit
    if (next === '0' && !/[0-9]/.test(text[i + 2] ?? '')) {
      out += '\0';
      i += 2;
      continue;
    }
    // Annex B legacy octal: \1-\377, and \0 followed by 8 or 9.
    const octalMatch = /^[0-7]{1,3}/.exec(text.slice(i + 1));
    if (next >= '0' && next <= '7' && octalMatch) {
      let digits = octalMatch[0];
      // Annex B: at most 3 digits, and if it starts with 0-3 up to 3 digits are allowed, else up to 2.
      if (digits[0]! >= '4' && digits.length > 2) digits = digits.slice(0, 2);
      const value = parseInt(digits, 8);
      warnings.push({
        message: `\\${digits} is a legacy octal escape, forbidden in strict mode and template literals`,
        position: i,
      });
      out += String.fromCharCode(value);
      i += 1 + digits.length;
      continue;
    }
    if (next === '8' || next === '9') {
      warnings.push({
        message: `\\${next} is a legacy escape, forbidden in strict mode and template literals`,
        position: i,
      });
      out += next;
      i += 2;
      continue;
    }
    const simple = SIMPLE_UNESCAPES[next];
    if (simple !== undefined) {
      out += simple;
      i += 2;
      continue;
    }
    // Identity escape: \q gives q.
    out += next;
    i += 2;
  }
  return { value: out, warnings };
}
