import { cleanLabel, decodeBytes, decodeHeaderBytes } from './charset';
import { trimWsp } from './lines';
import { MAX_CONTINUATIONS, MAX_PARAMETERS } from './limits';

/** One parameter of a Content-Type or Content-Disposition value. */
export interface ParamEntry {
  /** The parameter name in lower case, without any RFC 2231 asterisk part: title for title, title*, title*0 and title*1*. */
  name: string;
  /** The value: unquoted, and for an RFC 2231 parameter joined and percent-decoded in its character set. */
  value: string;
  /** True for the name* forms (an extended value, continued or not). */
  extended: boolean;
  /** True when the value was joined from numbered sections. */
  continued: boolean;
  /** The character set and language written in the first section of an RFC 2231 value, when there were any. */
  charset?: string;
  language?: string;
  /** True when this is one piece of a parameter that was not joined (a gap, a leading zero, too many sections). */
  raw: boolean;
  /** For a raw piece: the parameter name exactly as written. */
  rawName?: string;
  /** True when the character set of an extended value is not one the browser's decoder reads (shown as escaped bytes). */
  unknownCharset?: boolean;
}

export interface ParsedValue {
  /** The text before the first semicolon, comments removed and ends trimmed, as written (the media type or disposition). */
  primary: string;
  /** Parameters in the order written; a joined parameter appears at the place of its first piece. */
  params: ParamEntry[];
  notes: string[];
}

const SEMICOLON = 0x3b;
const QUOTE = 0x22;
const OPEN = 0x28;
const CLOSE = 0x29;
const BACKSLASH = 0x5c;
const EQUALS = 0x3d;

/** Where a comment that opens at `at` ends (the index after its closing parenthesis, or the end of the text). One pass. */
function skipComment(text: string, at: number): number {
  let depth = 0;
  let i = at;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === BACKSLASH) i += 2;
    else {
      if (code === OPEN) depth++;
      else if (code === CLOSE) {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
  }
  return text.length;
}

function isWsp(code: number): boolean {
  return code === 32 || code === 9 || code === 13 || code === 10;
}

/** Skips white space and comments from `at`. */
function skipSpace(text: string, at: number): number {
  let i = at;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (isWsp(code)) i++;
    else if (code === OPEN) i = skipComment(text, i);
    else break;
  }
  return i;
}

function hexDigit(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}

/** The bytes of an RFC 2231 percent-encoded value: %XX is a byte, any other character is its UTF-8 bytes. */
function percentBytes(text: string): Uint8Array {
  const out: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      code === 0x25 &&
      i + 2 < text.length &&
      hexDigit(text.charCodeAt(i + 1)) >= 0 &&
      hexDigit(text.charCodeAt(i + 2)) >= 0
    ) {
      out.push((hexDigit(text.charCodeAt(i + 1)) << 4) | hexDigit(text.charCodeAt(i + 2)));
      i += 2;
    } else if (code < 128) out.push(code);
    else {
      const point = text.codePointAt(i) ?? code;
      for (const byte of encoder.encode(String.fromCodePoint(point))) out.push(byte);
      if (point > 0xffff) i++;
    }
  }
  return Uint8Array.from(out);
}

interface Piece {
  /** The section number, or null for a plain parameter or an extended value with no number. */
  section: number | null;
  encoded: boolean;
  value: string;
  rawName: string;
}

/** The name split into its base and the RFC 2231 parts, or null for a name that only looks like one. */
function splitName(name: string): { base: string; section: number | null; encoded: boolean; invalidNumber: boolean } {
  let base = name;
  let encoded = false;
  if (base.endsWith('*')) {
    encoded = true;
    base = base.slice(0, -1);
  }
  const star = base.lastIndexOf('*');
  if (star === -1) return { base, section: null, encoded, invalidNumber: false };
  const digits = base.slice(star + 1);
  let numeric = digits.length > 0;
  for (let i = 0; numeric && i < digits.length; i++) {
    const code = digits.charCodeAt(i);
    if (code < 0x30 || code > 0x39) numeric = false;
  }
  if (!numeric) return { base: name, section: null, encoded: false, invalidNumber: false };
  const leadingZero = digits.length > 1 && digits.startsWith('0');
  return {
    base: base.slice(0, star),
    section: digits.length > 9 ? Number.MAX_SAFE_INTEGER : Number(digits),
    encoded,
    invalidNumber: leadingZero,
  };
}

/** Reads the charset and language that start an RFC 2231 extended value: charset'language'text. */
function splitExtended(value: string): { charset: string; language: string; rest: string; marked: boolean } {
  const first = value.indexOf("'");
  const second = first === -1 ? -1 : value.indexOf("'", first + 1);
  if (first === -1 || second === -1) return { charset: '', language: '', rest: value, marked: false };
  return {
    charset: value.slice(0, first),
    language: value.slice(first + 1, second),
    rest: value.slice(second + 1),
    marked: true,
  };
}

/**
 * Reads the value of a Content-Type or Content-Disposition header: the text before the first semicolon, then the
 * parameters. Quoted strings and comments are read; RFC 2231 continuations (name*0, name*1), character set and language
 * values (name*=us-ascii'en'...) and the two together are joined and decoded. A parameter with a gap or a leading zero
 * in its numbers, or with more than 100 sections, is not joined: each piece is returned raw, as written. Names are
 * plain text, kept in a Map while they are grouped, so __proto__ and constructor are only names.
 */
export function parseParameters(value: string): ParsedValue {
  const notes: string[] = [];
  const length = value.length;

  // The primary value: up to the first semicolon that is not in a quoted string or a comment.
  let i = 0;
  let primary = '';
  let segmentStart = 0;
  while (i < length) {
    const code = value.charCodeAt(i);
    if (code === SEMICOLON) break;
    if (code === OPEN) {
      primary += value.slice(segmentStart, i);
      i = skipComment(value, i);
      segmentStart = i;
    } else i++;
  }
  primary = trimWsp(primary + value.slice(segmentStart, Math.min(i, length)));

  const order: string[] = [];
  const groups = new Map<string, Piece[]>();
  let count = 0;

  while (i < length) {
    // At a semicolon (or the end): read the next name.
    i = skipSpace(value, i + 1);
    if (i >= length) break;
    if (value.charCodeAt(i) === SEMICOLON) {
      continue;
    }
    const nameStart = i;
    while (i < length && value.charCodeAt(i) !== EQUALS && value.charCodeAt(i) !== SEMICOLON) i++;
    if (i >= length || value.charCodeAt(i) === SEMICOLON) {
      // A name with no value: nothing to keep.
      continue;
    }
    const written = trimWsp(value.slice(nameStart, i));
    i = skipSpace(value, i + 1);
    let text = '';
    if (i < length && value.charCodeAt(i) === QUOTE) {
      i++;
      const parts: string[] = [];
      let start = i;
      while (i < length && value.charCodeAt(i) !== QUOTE) {
        if (value.charCodeAt(i) === BACKSLASH && i + 1 < length) {
          parts.push(value.slice(start, i));
          start = i + 1;
          i += 2;
        } else i++;
      }
      parts.push(value.slice(start, Math.min(i, length)));
      text = parts.join('');
      if (i < length) i++;
      // Anything between the closing quote and the next semicolon (such as a comment) is not part of the value.
      while (i < length && value.charCodeAt(i) !== SEMICOLON) i++;
    } else {
      const start = i;
      while (i < length && value.charCodeAt(i) !== SEMICOLON) i++;
      text = trimWsp(value.slice(start, i));
    }
    if (written === '') continue;
    if (count >= MAX_PARAMETERS) {
      notes.push(`More than ${MAX_PARAMETERS} parameters were written, so the rest were not read.`);
      break;
    }
    count++;
    const parts = splitName(written.toLowerCase());
    const key = parts.base;
    let list = groups.get(key);
    if (list === undefined) {
      list = [];
      groups.set(key, list);
      order.push(key);
    }
    list.push({
      section: parts.invalidNumber ? -1 : parts.section,
      encoded: parts.encoded,
      value: text,
      rawName: written,
    });
  }

  const params: ParamEntry[] = [];
  for (const key of order) {
    const list = groups.get(key) ?? [];
    const plain = list.filter((p) => p.section === null && !p.encoded);
    const single = list.filter((p) => p.section === null && p.encoded);
    const numbered = list.filter((p) => p.section !== null);

    if (plain[0] !== undefined) {
      params.push({ name: key, value: plain[0].value, extended: false, continued: false, raw: false });
      if (plain.length > 1) notes.push('A parameter was written more than once; the first value is used.');
    }
    if (single[0] !== undefined) {
      const split = splitExtended(single[0].value);
      const bytes = percentBytes(split.rest);
      params.push(extendedEntry(key, bytes, split.charset, split.language, false));
      if (single.length > 1) notes.push('A parameter was written more than once; the first value is used.');
    }
    if (numbered.length > 0) {
      const sections = new Map<number, Piece>();
      let valid = numbered.length <= MAX_CONTINUATIONS;
      for (const piece of numbered) {
        const n = piece.section ?? -1;
        if (n < 0 || sections.has(n)) valid = false;
        else sections.set(n, piece);
      }
      for (let n = 0; valid && n < numbered.length; n++) if (!sections.has(n)) valid = false;
      if (!valid) {
        notes.push(
          'A parameter is split into numbered sections with a gap, a leading zero or a repeat, so its pieces are shown as written.',
        );
        for (const piece of numbered) {
          params.push({
            name: key,
            value: piece.value,
            extended: piece.encoded,
            continued: false,
            raw: true,
            rawName: piece.rawName,
          });
        }
        continue;
      }
      const chunks: Uint8Array[] = [];
      let charset = '';
      let language = '';
      let anyEncoded = false;
      for (let n = 0; n < numbered.length; n++) {
        const piece = sections.get(n);
        if (piece === undefined) continue;
        let text = piece.value;
        if (n === 0 && piece.encoded) {
          const split = splitExtended(text);
          charset = split.charset;
          language = split.language;
          text = split.rest;
        }
        if (piece.encoded) {
          anyEncoded = true;
          chunks.push(percentBytes(text));
        } else chunks.push(new TextEncoder().encode(text));
      }
      let total = 0;
      for (const chunk of chunks) total += chunk.length;
      const joined = new Uint8Array(total);
      let at = 0;
      for (const chunk of chunks) {
        joined.set(chunk, at);
        at += chunk.length;
      }
      const entry = extendedEntry(key, joined, charset, language, true);
      if (!anyEncoded) entry.extended = false;
      params.push(entry);
    }
  }
  return { primary, params, notes };
}

function extendedEntry(
  name: string,
  bytes: Uint8Array,
  charset: string,
  language: string,
  continued: boolean,
): ParamEntry {
  const label = cleanLabel(charset);
  let value: string;
  let unknownCharset = false;
  if (label === '') value = decodeHeaderBytes(bytes);
  else {
    const decoded = decodeBytes(bytes, label);
    value = decoded.text;
    unknownCharset = !decoded.known;
  }
  const entry: ParamEntry = { name, value, extended: true, continued, raw: false };
  if (label !== '') entry.charset = label;
  if (language !== '') entry.language = language;
  if (unknownCharset) entry.unknownCharset = true;
  return entry;
}

/**
 * The parameter called `name` (lower case): an extended value first, then a plain one. Pieces that were not joined are
 * never returned here.
 */
export function findParam(parsed: ParsedValue, name: string): ParamEntry | undefined {
  let plain: ParamEntry | undefined;
  for (const entry of parsed.params) {
    if (entry.raw || entry.name !== name) continue;
    if (entry.extended) return entry;
    if (plain === undefined) plain = entry;
  }
  return plain;
}
