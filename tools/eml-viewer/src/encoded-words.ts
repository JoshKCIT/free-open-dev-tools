import { cleanLabel, decodeBytes } from './charset';
import { MAX_ENCODED_WORDS } from './limits';
import { decodeBase64Lenient } from './transfer';

/** A header text with its RFC 2047 encoded words decoded, and what happened on the way. */
export interface DecodedWords {
  text: string;
  /** How many encoded words were decoded. */
  words: number;
  /** True when the 201st word was met: it and every later one were left as written. */
  cut: boolean;
  /** The labels of the words whose character set the browser's decoder does not know, shown as escaped bytes. */
  unknownCharsets: string[];
}

function isWhite(code: number): boolean {
  return code === 32 || code === 9 || code === 13 || code === 10;
}

/** Characters that may stand right before an encoded word: the start, white space, an opening parenthesis, a quote, a comma. */
function boundaryBefore(text: string, at: number): boolean {
  if (at === 0) return true;
  const code = text.charCodeAt(at - 1);
  return isWhite(code) || code === 0x28 || code === 0x22 || code === 0x2c;
}

/** Characters that may stand right after an encoded word: the end, white space, a closing parenthesis, a quote, a comma, <. */
function boundaryAfter(text: string, end: number): boolean {
  if (end >= text.length) return true;
  const code = text.charCodeAt(end);
  return isWhite(code) || code === 0x29 || code === 0x22 || code === 0x2c || code === 0x3c;
}

const SPECIALS = '()<>@,;:"/[]?=';

function isTokenCode(code: number): boolean {
  return code > 32 && code < 127 && !SPECIALS.includes(String.fromCharCode(code));
}

function hex(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}

/** The bytes of a Q encoded text (RFC 2047 section 4.2), or null when it is not valid Q. */
function qBytes(text: string): Uint8Array | null {
  const out = new Uint8Array(text.length);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x5f) out[n++] = 0x20;
    else if (code === 0x3d) {
      const high = i + 1 < text.length ? hex(text.charCodeAt(i + 1)) : -1;
      const low = i + 2 < text.length ? hex(text.charCodeAt(i + 2)) : -1;
      if (high < 0 || low < 0) return null;
      out[n++] = (high << 4) | low;
      i += 2;
    } else if (code > 32 && code < 127) out[n++] = code;
    else return null;
  }
  return out.slice(0, n);
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The bytes of a B encoded text (RFC 2047 section 4.1), or null when it holds a character that is not Base64. */
function bBytes(text: string): Uint8Array | null {
  const raw = new Uint8Array(text.length);
  let letters = 0;
  let padding = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    raw[i] = code;
    if (code === 0x3d) padding++;
    else if (padding > 0) return null;
    else if (BASE64_CHARS.includes(String.fromCharCode(code))) letters++;
    else return null;
  }
  if (letters % 4 === 1) return null;
  return decodeBase64Lenient(raw);
}

interface WordShape {
  charset: string;
  encoding: string;
  encoded: string;
  end: number;
}

/** Reads one encoded word that starts at `at` (where "=?" is), or null when what follows is not one. */
function readWord(text: string, at: number): WordShape | null {
  let i = at + 2;
  const charsetStart = i;
  while (i < text.length && i - charsetStart <= 64 && (isTokenCode(text.charCodeAt(i)) || text.charCodeAt(i) === 0x2a))
    i++;
  if (i === charsetStart || text.charCodeAt(i) !== 0x3f) return null;
  const charset = text.slice(charsetStart, i);
  i++;
  const encoding = text[i];
  if (encoding === undefined || !'BbQq'.includes(encoding) || text.charCodeAt(i + 1) !== 0x3f) return null;
  i += 2;
  const encodedStart = i;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === 0x3f) break;
    if (code <= 32 || code >= 127) return null;
    i++;
  }
  if (i >= text.length || text.charCodeAt(i + 1) !== 0x3d) return null;
  return { charset, encoding: encoding.toUpperCase(), encoded: text.slice(encodedStart, i), end: i + 2 };
}

/**
 * Decodes the RFC 2047 encoded words of a header text, in one pass. B and Q words are read with the browser's decoder for
 * their character set (a language suffix after an asterisk is ignored); white space between two adjacent encoded words is
 * dropped, while a word next to plain text keeps its space; a word that does not decode is left as written. After 200
 * decoded words the rest of the text is left as written and `cut` is set.
 */
export function decodeEncodedWords(input: string): DecodedWords {
  const unknown: string[] = [];
  if (input.indexOf('=?') === -1) return { text: input, words: 0, cut: false, unknownCharsets: unknown };
  const out: string[] = [];
  let words = 0;
  let cut = false;
  let literalStart = 0;
  // Where the last decoded word ended, so the text between two words is judged only when they are adjacent.
  let lastEnd = -1;
  let from = 0;
  for (;;) {
    const at = input.indexOf('=?', from);
    if (at === -1) break;
    if (!boundaryBefore(input, at)) {
      from = at + 2;
      continue;
    }
    const shape = readWord(input, at);
    if (shape === null || !boundaryAfter(input, shape.end)) {
      from = at + 2;
      continue;
    }
    const bytes = shape.encoding === 'B' ? bBytes(shape.encoded) : qBytes(shape.encoded);
    if (bytes === null) {
      from = at + 2;
      continue;
    }
    if (words >= MAX_ENCODED_WORDS) {
      cut = true;
      break;
    }
    const decoded = decodeBytes(bytes, shape.charset);
    if (!decoded.known) {
      const label = cleanLabel(shape.charset);
      if (!unknown.includes(label)) unknown.push(label);
    }
    const between = input.slice(literalStart, at);
    let whiteOnly = between.length > 0;
    for (let k = 0; whiteOnly && k < between.length; k++) if (!isWhite(between.charCodeAt(k))) whiteOnly = false;
    if (!(lastEnd === literalStart && whiteOnly)) out.push(between);
    out.push(decoded.text);
    words++;
    lastEnd = shape.end;
    literalStart = shape.end;
    from = shape.end;
  }
  out.push(input.slice(literalStart));
  return { text: out.join(''), words, cut, unknownCharsets: unknown };
}
