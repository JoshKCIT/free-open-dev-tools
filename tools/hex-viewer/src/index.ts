import meta from './meta.json';
import { SIGNATURES, type Signature, type SignaturePart } from './signatures';

export { meta, SIGNATURES };
export type { Signature, SignaturePart };

/** A file can be viewed up to this many bytes (2 GiB): only the rows on screen are ever read. */
export const MAX_VIEW_BYTES = 2147483648;
/** A file can be searched up to this many bytes (1 GiB). */
export const MAX_SEARCH_BYTES = 1073741824;
/** Pasted hex or text can be up to this many bytes (5 MiB). */
export const MAX_PASTED_BYTES = 5242880;
/** A search lists at most this many match offsets and counts the rest. */
export const MAX_LISTED_MATCHES = 1000;

/**
 * Raised, with a plain message, for every expected failure: hex text that is not pairs of digits (with its position), a
 * position outside the file, a file or paste over a limit. `field` names the page field the message is about.
 */
export class HexViewerError extends Error {
  readonly field?: string;
  readonly position?: number;
  constructor(message: string, detail: { field?: string; position?: number } = {}) {
    super(message);
    this.name = 'HexViewerError';
    if (detail.field !== undefined) this.field = detail.field;
    if (detail.position !== undefined) this.position = detail.position;
  }
}

export type BytesPerRow = 8 | 16 | 32;

const hexByte = (value: number): string => value.toString(16).padStart(2, '0');

/**
 * Rows in the canonical hexdump layout, `startOffset` being the offset of the first byte in the file: an 8 digit hex
 * offset, two spaces, the bytes in groups of eight with two spaces between groups, two spaces, then the bytes as
 * text between vertical bars. Text is printable ASCII (0x20 to 0x7E); every other byte is a full stop. A short last row
 * is padded so the text column lines up. Rows are joined by line breaks; there is no closing offset line.
 */
export function formatHexRows(bytes: Uint8Array, startOffset: number, bytesPerRow: BytesPerRow): string {
  if (bytesPerRow !== 8 && bytesPerRow !== 16 && bytesPerRow !== 32) {
    throw new HexViewerError('Bytes per row must be 8, 16 or 32.', { field: 'Bytes per row' });
  }
  if (!Number.isSafeInteger(startOffset) || startOffset < 0) {
    throw new HexViewerError('The first offset must be a whole number of bytes, 0 or more.', { field: 'Go to byte' });
  }
  const rows: string[] = [];
  for (let start = 0; start < bytes.length; start += bytesPerRow) {
    const count = Math.min(bytesPerRow, bytes.length - start);
    let hex = '';
    let text = '';
    for (let column = 0; column < bytesPerRow; column++) {
      if (column > 0) hex += column % 8 === 0 ? '  ' : ' ';
      if (column < count) {
        const value = bytes[start + column]!;
        hex += hexByte(value);
        text += value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.';
      } else {
        hex += '  ';
      }
    }
    rows.push(`${(startOffset + start).toString(16).padStart(8, '0')}  ${hex}  |${text}|`);
  }
  return rows.join('\n');
}

const isHexDigit = (code: number): boolean =>
  (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);

const hexValue = (code: number): number => (code <= 0x39 ? code - 0x30 : (code | 0x20) - 0x61 + 10);

const isSpace = (code: number): boolean => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;

/**
 * Reads hex text as bytes: pairs of hex digits (either case), with spaces, tabs or line breaks between bytes or none at
 * all. A character that is not a hex digit, or a byte written with one digit, is refused naming its position (the
 * character number in the text, counting from 1). More than `MAX_PASTED_BYTES` bytes is refused.
 */
export function parseHexInput(text: string): Uint8Array {
  // First pass: check every character and count the digits, keeping nothing, so a refusal costs no allocation.
  let digitCount = 0;
  let runLength = 0;
  const endRun = (lastDigitPosition: number): void => {
    if (runLength % 2 === 1) {
      throw new HexViewerError(
        `A byte is two hex digits, but the digit at character ${lastDigitPosition} has no partner. Write pairs such as 48 65 6c.`,
        { field: 'Pasted bytes', position: lastDigitPosition },
      );
    }
    runLength = 0;
  };
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (isSpace(code)) {
      endRun(index);
      continue;
    }
    if (!isHexDigit(code)) {
      throw new HexViewerError(
        `The text holds ${JSON.stringify(text[index])} at character ${index + 1}, which is not a hex digit. Use pairs of the digits 0 to 9 and a to f.`,
        { field: 'Pasted bytes', position: index + 1 },
      );
    }
    runLength++;
    digitCount++;
  }
  endRun(text.length);
  if (digitCount / 2 > MAX_PASTED_BYTES) {
    throw new HexViewerError(
      `The pasted hex is ${formatSize(digitCount / 2)}. The limit is ${formatSize(MAX_PASTED_BYTES)} because it is held in the page while it is shown.`,
      { field: 'Pasted bytes' },
    );
  }
  // Second pass: fill the bytes.
  const bytes = new Uint8Array(digitCount / 2);
  let filled = 0;
  let high = -1;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (isSpace(code)) continue;
    if (high < 0) {
      high = hexValue(code);
    } else {
      bytes[filled++] = high * 16 + hexValue(code);
      high = -1;
    }
  }
  return bytes;
}

/**
 * The bytes to search for: the text as UTF-8, or hex text read as `parseHexInput` reads it. Empty text gives no bytes.
 */
export function encodeNeedle(text: string, as: 'text' | 'hex'): Uint8Array {
  if (as === 'hex') return parseHexInput(text);
  return new TextEncoder().encode(text);
}

/** A byte count as B, KiB, MiB or GiB, for the sentences that name a limit. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${shown} ${units[unit]}`;
}

export interface FileKind {
  /** What the signature suggests the file is. */
  name: string;
  /** The bytes that were found, and where. */
  evidence: string;
  /** The address of the specification that states the signature; empty when no format matched. */
  spec: string;
}

const hexUpper = (value: number): string => value.toString(16).padStart(2, '0').toUpperCase();

function partMatches(part: SignaturePart, head: Uint8Array, tail: Uint8Array, size: number): boolean {
  const { bytes, offset } = part;
  if (part.fromEnd) {
    const begin = tail.length - offset - bytes.length;
    if (begin < 0 || size < bytes.length + offset) return false;
    return bytes.every((value, i) => tail[begin + i] === value);
  }
  if (offset + bytes.length > head.length) return false;
  return bytes.every((value, i) => head[offset + i] === value);
}

function describePart(part: SignaturePart): string {
  const bytes = part.bytes.map(hexUpper).join(' ');
  return part.fromEnd
    ? `${bytes} ${part.offset === 0 ? 'as the last bytes' : `ending ${part.offset} bytes before the end`}`
    : `${bytes} at offset ${part.offset}`;
}

/**
 * Names what a file's signature bytes suggest it is. `head` is the first 512 bytes of the file (or all of it when it is
 * shorter), `tail` its last 22 bytes (or all of it) and `size` its length in bytes. Every name the bytes fit is returned
 * with the evidence and the specification address. A signature is a hint, not a check of the whole file.
 */
export function identifyFile(head: Uint8Array, tail: Uint8Array, size: number): FileKind[] {
  if (size === 0) return [{ name: 'empty file', evidence: 'The file has 0 bytes.', spec: '' }];
  const found: FileKind[] = [];
  for (const signature of SIGNATURES) {
    if (signature.parts.every((part) => partMatches(part, head, tail, size))) {
      found.push({
        name: signature.name,
        evidence: `Found ${signature.parts.map(describePart).join(' and ')}.`,
        spec: signature.spec,
      });
    }
  }
  if (found.length === 0) {
    return [
      {
        name: 'unknown',
        evidence: 'No signature in the table matches the bytes at the start or end of the file.',
        spec: '',
      },
    ];
  }
  return found;
}
