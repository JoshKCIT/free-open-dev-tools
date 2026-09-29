/**
 * Java string literals (JLS SE 21 section 3.3 Unicode Escapes, section
 * 3.10.7 Escape Sequences for Character and String Literals -- numbered
 * section 3.10.6 in JLS SE 8 and earlier).
 *
 * Java source is translated in two passes before a string literal is ever
 * read: pass 1 turns every `\uXXXX` Unicode escape (however many `u`s, and
 * only when the backslash starting it is not itself escaped) into the raw
 * character, across the WHOLE literal including its quotes; pass 2 then
 * reads the ordinary escape sequences. This module reproduces both passes,
 * operating on the inner content once the surrounding quotes are stripped
 * (a `"` landing exactly on the quote boundary is not modelled).
 */
import { StringEscapeError, type LiteralResult, type LiteralWarning, hex4, walkCodePoints } from './shared';

const SIMPLE_ESCAPES: Record<number, string> = {
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
  0x22: '\\"',
  0x5c: '\\\\',
};

export interface JavaEscapeOptions {
  escapeNonAscii: boolean;
}

export function escapeContents(text: string, options: JavaEscapeOptions): LiteralResult {
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
    if (code === 0x00 || code < 0x20 || code === 0x7f) {
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

interface Pass1Result {
  text: string;
  positions: number[];
}

/** JLS 3.3: translates Unicode escapes across the whole input before any other reading happens. */
function translateUnicodeEscapes(input: string): Pass1Result {
  let out = '';
  const positions: number[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    if (input[i] === '\\') {
      let j = i;
      while (j < n && input[j] === '\\') j++;
      const bsCount = j - i;
      if (bsCount % 2 === 1 && input[j] === 'u') {
        let k = j;
        while (input[k] === 'u') k++;
        const hex = input.slice(k, k + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new StringEscapeError(`"\\u" must be followed by exactly four hexadecimal digits; found "${hex}"`, i);
        }
        const code = parseInt(hex, 16);
        const literalBackslashes = (bsCount - 1) / 2;
        for (let b = 0; b < literalBackslashes; b++) {
          out += '\\';
          positions.push(i);
        }
        out += String.fromCharCode(code);
        positions.push(i);
        i = k + 4;
        continue;
      }
      for (let b = 0; b < bsCount; b++) {
        out += '\\';
        positions.push(i + b);
      }
      i = j;
      continue;
    }
    out += input[i];
    positions.push(i);
    i++;
  }
  return { text: out, positions };
}

const SIMPLE_UNESCAPES: Record<string, string> = {
  b: '\b',
  t: '\t',
  n: '\n',
  f: '\f',
  r: '\r',
  '"': '"',
  "'": "'",
  '\\': '\\',
};

/** Unescapes Java string literal contents (quotes already stripped by the caller). */
export function unescapeContents(body: string, baseOffset: number): LiteralResult {
  const { text: translated, positions } = translateUnicodeEscapes(body);
  const warnings: LiteralWarning[] = [];
  let out = '';
  let i = 0;
  while (i < translated.length) {
    const origPos = baseOffset + positions[i]!;
    const ch = translated[i]!;
    if (ch === '\n' || ch === '\r') {
      throw new StringEscapeError('a raw line terminator cannot appear in a Java string literal', origPos);
    }
    if (ch === '"') {
      throw new StringEscapeError('this quote would end the literal early', origPos);
    }
    if (ch !== '\\') {
      out += ch;
      i++;
      continue;
    }
    const next = translated[i + 1];
    if (next === undefined) {
      throw new StringEscapeError('a reverse solidus at the end of the input has nothing to escape', origPos);
    }
    if (next === 's') {
      warnings.push({ message: '\\s needs Java 15 or later (text block escape)', position: origPos });
      out += ' ';
      i += 2;
      continue;
    }
    const simple = SIMPLE_UNESCAPES[next];
    if (simple !== undefined) {
      out += simple;
      i += 2;
      continue;
    }
    if (next >= '0' && next <= '7') {
      const maxLen = next <= '3' ? 3 : 2;
      let digits = next;
      let k = i + 2;
      while (digits.length < maxLen && translated[k] !== undefined && translated[k]! >= '0' && translated[k]! <= '7') {
        digits += translated[k];
        k++;
      }
      out += String.fromCharCode(parseInt(digits, 8));
      i = k;
      continue;
    }
    throw new StringEscapeError(`"\\${next}" is not a Java escape sequence`, origPos);
  }
  return { value: out, warnings };
}
