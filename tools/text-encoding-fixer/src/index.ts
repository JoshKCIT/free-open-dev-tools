import meta from './meta.json';
import { decodeWindows1252, encodeWindows1252 } from './windows-1252';

export { meta };

/** The most bytes read, in a file, in pasted hex or in pasted text counted as UTF-8: 20 MiB. */
export const MAX_INPUT_BYTES = 20971520;

/** A problem with what the visitor gave. `position` counts characters (code points) from 1 where one applies. */
export class TextEncodingFixerError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'TextEncodingFixerError';
    if (position !== undefined) this.position = position;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Sizes and hex

/** Refuses a size over the limit before anything is read or decoded. `subject` starts the sentence. */
export function checkInputSize(size: number, subject = 'This file'): void {
  if (size > MAX_INPUT_BYTES) {
    throw new TextEncodingFixerError(
      `${subject} is ${size.toLocaleString('en-US')} bytes. The limit is 20 MiB (${MAX_INPUT_BYTES.toLocaleString('en-US')} bytes) because it is held in the page while it is converted.`,
    );
  }
}

/** How many bytes a text takes as UTF-8, counted without making the bytes (a lone surrogate counts as U+FFFD would). */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** Refuses a text whose UTF-8 form is over the limit. A text that cannot reach the limit is not even counted. */
export function checkTextSize(text: string): void {
  if (text.length * 3 <= MAX_INPUT_BYTES) return;
  checkInputSize(utf8Length(text), 'This text');
}

/** Writes a text as UTF-8, refusing a lone surrogate instead of quietly writing U+FFFD for it. */
export function utf8Bytes(text: string): Uint8Array {
  checkTextSize(text);
  let position = 0;
  for (let i = 0; i < text.length; i++, position++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      i++;
    } else if (unit >= 0xd800 && unit <= 0xdfff) {
      throw new TextEncodingFixerError(
        `Character ${position + 1} is half of a surrogate pair, which UTF-8 cannot write.`,
        position + 1,
      );
    }
  }
  return new TextEncoder().encode(text);
}

/** Lower case hex pairs of the first 8 bytes, separated by spaces. */
function hexPreview(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < Math.min(8, bytes.length); i++) parts.push(bytes[i]!.toString(16).padStart(2, '0'));
  return parts.join(' ');
}

function hexValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  return -1;
}

/** Reads pasted hex: pairs of digits, with spaces, tabs and line breaks allowed anywhere between them. */
export function parseHex(text: string): Uint8Array {
  let digits = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c) continue;
    if (hexValue(code) < 0) {
      throw new TextEncodingFixerError(`The hex text: character ${i + 1} is not a hex digit (0 to 9, a to f).`, i + 1);
    }
    digits++;
  }
  checkInputSize(Math.ceil(digits / 2), 'The hex text');
  if (digits % 2 !== 0) {
    throw new TextEncodingFixerError('The hex text has an odd number of digits, so its last byte is incomplete.');
  }
  const bytes = new Uint8Array(digits / 2);
  let filled = 0;
  let high = -1;
  for (let i = 0; i < text.length; i++) {
    const value = hexValue(text.charCodeAt(i));
    if (value < 0) continue;
    if (high < 0) high = value;
    else {
      bytes[filled++] = (high << 4) | value;
      high = -1;
    }
  }
  return bytes;
}

// ---------------------------------------------------------------------------------------------------------------------
// Decoding

/**
 * The labels the WHATWG Encoding Standard gives to windows-1252 that name ISO-8859-1 (Latin-1). Only these can be
 * asked to mean true ISO-8859-1; the labels ascii, us-ascii, cp1252, x-cp1252 and windows-1252 name windows-1252 itself.
 */
const LATIN1_LABELS: ReadonlySet<string> = new Set([
  'cp819',
  'csisolatin1',
  'ibm819',
  'iso-8859-1',
  'iso-ir-100',
  'iso8859-1',
  'iso88591',
  'iso_8859-1',
  'iso_8859-1:1987',
  'l1',
  'latin1',
]);

export interface DecodeResult {
  text: string;
  /** The encoding the label resolved to, such as windows-1252, shift_jis or iso-8859-1 (when true Latin-1 was chosen). */
  encoding: string;
  /** How many U+FFFD characters the result holds: bytes the encoding could not read, and any U+FFFD the bytes spelled. */
  replacements: number;
}

function countReplacements(text: string): number {
  let count = 0;
  for (let at = text.indexOf('\u{fffd}'); at >= 0; at = text.indexOf('\u{fffd}', at + 1)) count++;
  return count;
}

/**
 * Decodes bytes with a WHATWG encoding label. windows-1252 (and every label of it) uses this folder's own table;
 * every other label uses the platform's decoder. With `strictLatin1`, a Latin-1 label means true ISO-8859-1, where each
 * byte is the code point with its own number. A byte order mark is kept as U+FEFF, never dropped.
 */
export function decodeBytes(bytes: Uint8Array, label: string, options: { strictLatin1: boolean }): DecodeResult {
  checkInputSize(bytes.length);
  const asked = label.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').toLowerCase();
  if (asked === '') {
    throw new TextEncodingFixerError('Encoding label: enter a label such as windows-1252, utf-8 or shift_jis.');
  }
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(asked, { fatal: false, ignoreBOM: true });
  } catch {
    throw new TextEncodingFixerError(
      `The encoding label "${label.trim()}" is not one this browser can decode. Use a label from the WHATWG Encoding Standard, such as windows-1252, utf-8, koi8-r or shift_jis.`,
    );
  }
  if (decoder.encoding === 'windows-1252') {
    if (options.strictLatin1 && LATIN1_LABELS.has(asked)) {
      return {
        text: decodeWindows1252Identity(bytes),
        encoding: 'iso-8859-1',
        replacements: 0,
      };
    }
    return { text: decodeWindows1252(bytes), encoding: 'windows-1252', replacements: 0 };
  }
  const decoded = decoder.decode(bytes);
  return { text: decoded, encoding: decoder.encoding, replacements: countReplacements(decoded) };
}

/** True ISO-8859-1: every byte is the code point with its own number. */
function decodeWindows1252Identity(bytes: Uint8Array): string {
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(start, Math.min(start + CHUNK, bytes.length))));
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------------------------------------------------
// Repairing text that UTF-8 bytes were read as another encoding

export type RepairFrom = 'windows-1252' | 'iso-8859-1';

export interface RepairProblem {
  /** `outside-table`: a character no reading of UTF-8 as that encoding can produce. `not-utf8`: the bytes are not UTF-8. */
  kind: 'outside-table' | 'not-utf8';
  /** Where it goes wrong, counted in characters (code points) from 1. */
  position: number;
  /** The character itself, for `outside-table`. */
  character?: string;
}

export interface RepairResult {
  text: string;
  changed: boolean;
  /** Per line mode: the lines (from 1) that hold more than ASCII and could not be repaired, kept as they were. */
  unrepairedLines: number[];
  /** Whole text mode: why the text could not be repaired. Absent when it was repaired or is only ASCII. */
  problem?: RepairProblem;
}

/** Writes each character as the byte the chosen encoding gives it; a character with no byte there is reported. */
function toBytes(text: string, from: RepairFrom): { bytes: Uint8Array; badPosition?: number } {
  if (from === 'windows-1252') return encodeWindows1252(text);
  const bytes = new Uint8Array(text.length);
  let written = 0;
  let position = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint > 0xff) return { bytes: bytes.slice(0, written), badPosition: position };
    bytes[written++] = codePoint;
    position++;
  }
  return { bytes: bytes.slice(0, written) };
}

/** The character at a position counted in code points from 0. */
function characterAt(text: string, position: number): string {
  let at = 0;
  for (const character of text) {
    if (at === position) return character;
    at++;
  }
  return '';
}

/**
 * Where the first ill-formed UTF-8 sequence starts, or -1 when every byte is well formed. The sequences are those of
 * RFC 3629 section 4 (the same as Table 3-7 of the Unicode Standard): a lead byte C2 to F4 and the continuation bytes
 * its range allows, with no overlong forms, no surrogates and nothing above U+10FFFF.
 */
function firstIllFormedUtf8(bytes: Uint8Array): number {
  let i = 0;
  const continuation = (at: number, low = 0x80, high = 0xbf): boolean =>
    at < bytes.length && bytes[at]! >= low && bytes[at]! <= high;
  while (i < bytes.length) {
    const lead = bytes[i]!;
    if (lead < 0x80) i += 1;
    else if (lead >= 0xc2 && lead <= 0xdf) {
      if (!continuation(i + 1)) return i;
      i += 2;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      const low = lead === 0xe0 ? 0xa0 : 0x80;
      const high = lead === 0xed ? 0x9f : 0xbf;
      if (!continuation(i + 1, low, high) || !continuation(i + 2)) return i;
      i += 3;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      const low = lead === 0xf0 ? 0x90 : 0x80;
      const high = lead === 0xf4 ? 0x8f : 0xbf;
      if (!continuation(i + 1, low, high) || !continuation(i + 2) || !continuation(i + 3)) return i;
      i += 4;
    } else return i;
  }
  return -1;
}

/** Whether a text holds nothing above U+007F. */
const isAscii = (text: string): boolean => !/[\u0080-\uffff]/.test(text);

/** Repairs one stretch of text, whole. A text that is only ASCII is left alone. */
function repairWhole(
  text: string,
  from: RepairFrom,
  decoder: () => TextDecoder,
): { text: string; changed: boolean; problem?: RepairProblem } {
  if (isAscii(text)) return { text, changed: false };
  const { bytes, badPosition } = toBytes(text, from);
  if (badPosition !== undefined) {
    return {
      text,
      changed: false,
      problem: { kind: 'outside-table', position: badPosition + 1, character: characterAt(text, badPosition) },
    };
  }
  const bad = firstIllFormedUtf8(bytes);
  if (bad >= 0) return { text, changed: false, problem: { kind: 'not-utf8', position: bad + 1 } };
  const repaired = decoder().decode(bytes);
  return { text: repaired, changed: repaired !== text };
}

/**
 * Repairs text where UTF-8 bytes were read as windows-1252 (or as ISO-8859-1): every character is written back as the
 * byte it came from, and the bytes are read as UTF-8, so cafÃ© becomes café. Text that cannot be repaired is returned
 * unchanged with the reason; with `perLine`, each line is tried on its own and the line endings stay as they were.
 */
export function repairMojibake(text: string, from: RepairFrom, options: { perLine: boolean }): RepairResult {
  checkTextSize(text);
  let cached: TextDecoder | undefined;
  // A byte order mark in the repaired text is kept as U+FEFF rather than dropped.
  const decoder = (): TextDecoder => (cached ??= new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }));
  if (!options.perLine) {
    const whole = repairWhole(text, from, decoder);
    const result: RepairResult = { text: whole.text, changed: whole.changed, unrepairedLines: [] };
    if (whole.problem) result.problem = whole.problem;
    return result;
  }
  const parts: string[] = [];
  const unrepairedLines: number[] = [];
  let changed = false;
  let line = 1;
  let start = 0;
  const flush = (end: number, ending: string): void => {
    const repaired = repairWhole(text.slice(start, end), from, decoder);
    if (repaired.problem) unrepairedLines.push(line);
    if (repaired.changed) changed = true;
    parts.push(repaired.text, ending);
    line++;
  };
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit === 0x0a) {
      flush(i, '\n');
      start = i + 1;
    } else if (unit === 0x0d) {
      if (text.charCodeAt(i + 1) === 0x0a) {
        flush(i, '\r\n');
        i++;
      } else flush(i, '\r');
      start = i + 1;
    }
  }
  if (start < text.length) {
    const repaired = repairWhole(text.slice(start), from, decoder);
    if (repaired.problem) unrepairedLines.push(line);
    if (repaired.changed) changed = true;
    parts.push(repaired.text);
  }
  return { text: changed ? parts.join('') : text, changed, unrepairedLines };
}

// ---------------------------------------------------------------------------------------------------------------------
// Line endings

export interface LineEndingCounts {
  lf: number;
  crlf: number;
  cr: number;
}

const EOL_UNITS: Record<'lf' | 'crlf' | 'cr', number[]> = {
  lf: [0x0a],
  crlf: [0x0d, 0x0a],
  cr: [0x0d],
};

/**
 * Converts every line ending to LF, CRLF or CR in one pass, counting each kind found. A carriage return followed by a
 * line feed is one ending; a lone carriage return is one ending; U+2028, U+0085 and the other Unicode separators are
 * ordinary characters here.
 */
export function convertLineEndings(
  text: string,
  eol: 'lf' | 'crlf' | 'cr',
): { text: string; counts: LineEndingCounts } {
  checkTextSize(text);
  const counts: LineEndingCounts = { lf: 0, crlf: 0, cr: 0 };
  const ending = EOL_UNITS[eol];
  // At most two units are written for each unit read, so the output never outgrows this.
  const out = new Uint16Array(text.length * 2);
  let written = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit === 0x0d) {
      if (text.charCodeAt(i + 1) === 0x0a) {
        counts.crlf++;
        i++;
      } else counts.cr++;
    } else if (unit === 0x0a) counts.lf++;
    else {
      out[written++] = unit;
      continue;
    }
    for (const unitOfEnding of ending) out[written++] = unitOfEnding;
  }
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let start = 0; start < written; start += CHUNK) {
    parts.push(String.fromCharCode(...out.subarray(start, Math.min(start + CHUNK, written))));
  }
  return { text: parts.join(''), counts };
}

/**
 * Converts the line endings of a file's bytes, byte for byte, without reading the bytes as text: a line feed is 0A, a
 * carriage return 0D, and every other byte is copied as it is. That is right for every encoding that keeps those two
 * as single bytes (UTF-8, Latin-1, the Windows code pages, Shift_JIS, GBK and the like). A file that starts with a
 * UTF-16 byte order mark is refused, because there a line ending is two bytes. The text box of a page cannot carry a
 * carriage return (a browser turns every line break typed or pasted into it into a line feed), so a file is how a
 * carriage return gets in.
 */
export function convertLineEndingBytes(
  bytes: Uint8Array,
  eol: 'lf' | 'crlf' | 'cr',
): { bytes: Uint8Array; counts: LineEndingCounts } {
  checkInputSize(bytes.length);
  const mark = detectBom(bytes);
  if (mark === 'utf16le' || mark === 'utf16be') {
    throw new TextEncodingFixerError(
      'This file starts with a UTF-16 byte order mark, where a line ending is two bytes, so its line endings cannot be changed one byte at a time. Decode it to text first.',
    );
  }
  const counts: LineEndingCounts = { lf: 0, crlf: 0, cr: 0 };
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    if (byte === 0x0d) {
      if (bytes[i + 1] === 0x0a) {
        counts.crlf++;
        i++;
      } else counts.cr++;
    } else if (byte === 0x0a) counts.lf++;
  }
  const ending = EOL_UNITS[eol];
  const endings = counts.lf + counts.crlf + counts.cr;
  const out = new Uint8Array(bytes.length - counts.lf - counts.crlf * 2 - counts.cr + endings * ending.length);
  let written = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    if (byte === 0x0d && bytes[i + 1] === 0x0a) i++;
    else if (byte !== 0x0d && byte !== 0x0a) {
      out[written++] = byte;
      continue;
    }
    for (const unitOfEnding of ending) out[written++] = unitOfEnding;
  }
  return { bytes: out, counts };
}

// ---------------------------------------------------------------------------------------------------------------------
// Byte order marks

type BomKind = 'utf8' | 'utf16le' | 'utf16be';

const BOMS: Record<BomKind, number[]> = {
  utf8: [0xef, 0xbb, 0xbf],
  utf16le: [0xff, 0xfe],
  utf16be: [0xfe, 0xff],
};

/** The byte order mark the bytes start with, if any. A start of FF FE is UTF-16LE even when 00 00 follows. */
function detectBom(bytes: Uint8Array): BomKind | undefined {
  for (const kind of ['utf8', 'utf16le', 'utf16be'] as const) {
    const mark = BOMS[kind];
    if (mark.every((byte, i) => bytes[i] === byte)) return kind;
  }
  return undefined;
}

/**
 * Adds or removes a byte order mark at the start of the bytes. Adding a mark the bytes already start with changes
 * nothing, and a different mark is replaced, so there is never more than one. Removing takes off the first mark only.
 * `before` and `after` are the first 8 bytes as hex.
 */
export function changeBom(
  bytes: Uint8Array,
  action: 'add-utf8' | 'add-utf16le' | 'add-utf16be' | 'remove',
): { bytes: Uint8Array; before: string; after: string } {
  checkInputSize(bytes.length);
  const existing = detectBom(bytes);
  let result: Uint8Array;
  if (action === 'remove') {
    result = bytes.slice(existing === undefined ? 0 : BOMS[existing].length);
  } else {
    const wanted: BomKind = action === 'add-utf8' ? 'utf8' : action === 'add-utf16le' ? 'utf16le' : 'utf16be';
    // A mark the bytes already start with is replaced by the same mark, so it is never doubled.
    const body = bytes.subarray(existing === undefined ? 0 : BOMS[existing].length);
    const mark = BOMS[wanted];
    result = new Uint8Array(mark.length + body.length);
    result.set(mark, 0);
    result.set(body, mark.length);
  }
  return { bytes: result, before: hexPreview(bytes), after: hexPreview(result) };
}
