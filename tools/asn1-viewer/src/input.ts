import { Asn1Error } from './errors';
import { MAX_FILE_BYTES, MAX_PASTE_CHARS, MAX_PEM_BLOCKS, withCommas } from './limits';
import { PemError, base64ToBytes, hexToBytes, pemBlocks } from './pem';
import { visible } from './visible';

/** How the text is read. `auto` looks for PEM, then for hex, and otherwise reads Base64. */
export type InputFormat = 'auto' | 'pem' | 'base64' | 'hex';

export interface ReadInputResult {
  /** The bytes of the structure. */
  bytes: Uint8Array;
  /** `PEM`, `Base64`, `Base64url`, `hex` or `the bytes of the file`. */
  form: string;
  /** The label of each PEM block, in order (at most 40 characters each). */
  labels: string[];
}

const BEGIN = '-----BEGIN ';

/** Whether a byte is printable ASCII or a tab, line feed or carriage return. */
function isTextByte(octet: number): boolean {
  return (octet >= 0x20 && octet <= 0x7e) || octet === 9 || octet === 10 || octet === 13;
}

/** The text of a file's bytes, one character per byte, after an optional UTF-8 byte order mark. */
function textOfBytes(bytes: Uint8Array): string {
  let from = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) from = 3;
  const pieces: string[] = [];
  for (let i = from; i < bytes.length; i += 8192) {
    pieces.push(String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 8192))));
  }
  return pieces.join('');
}

/** True when every character is a hex digit, a space, a colon or a line break, and there are digits. */
function looksLikeHex(text: string): boolean {
  let digits = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 58) continue;
    const hex = (code >= 48 && code <= 57) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70);
    if (!hex) return false;
    digits++;
  }
  return digits > 0 && digits % 2 === 0;
}

/** Whether Base64 text uses the URL-safe alphabet: it holds a minus or an underscore and neither plus nor slash. */
function looksUrlSafe(text: string): boolean {
  const safe = text.indexOf('-') >= 0 || text.indexOf('_') >= 0;
  return safe && text.indexOf('+') < 0 && text.indexOf('/') < 0;
}

function joined(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function readPem(text: string, part: 'input' | 'file', needed: boolean): ReadInputResult | null {
  const blocks = pemBlocks(text, MAX_PEM_BLOCKS);
  if (blocks.length === 0) {
    if (needed)
      throw new Asn1Error('No PEM block was found: a block starts with a line of five dashes and BEGIN.', part);
    return null;
  }
  return {
    bytes: joined(blocks.map((block) => block.body)),
    form: 'PEM',
    labels: blocks.map((block) => visible(block.label, 40)),
  };
}

function readText(text: string, format: InputFormat, part: 'input' | 'file'): ReadInputResult {
  try {
    if (format === 'pem') return readPem(text, part, true)!;
    if (format === 'hex') return { bytes: hexToBytes(text), form: 'hex', labels: [] };
    if (format === 'base64') {
      const url = looksUrlSafe(text);
      return { bytes: base64ToBytes(text, { url }), form: url ? 'Base64url' : 'Base64', labels: [] };
    }
    if (text.indexOf(BEGIN) >= 0) {
      const pem = readPem(text, part, false);
      if (pem !== null) return pem;
    }
    if (looksLikeHex(text)) return { bytes: hexToBytes(text), form: 'hex', labels: [] };
    const url = looksUrlSafe(text);
    return { bytes: base64ToBytes(text, { url }), form: url ? 'Base64url' : 'Base64', labels: [] };
  } catch (err) {
    if (err instanceof PemError) throw new Asn1Error(err.message, part, err.position);
    throw err;
  }
}

/** Refuses a paste over 5 MiB by its length, before any of it is read. */
export function checkPasteSize(characters: number): void {
  if (characters > MAX_PASTE_CHARS) {
    throw new Asn1Error(
      `The paste is longer than 5 MiB (${withCommas(MAX_PASTE_CHARS)} characters), the most this page reads.`,
      'input',
    );
  }
}

/** Refuses a file over 10 MiB by its size, before any of it is read. */
export function checkFileSize(bytes: number): void {
  if (bytes > MAX_FILE_BYTES) {
    throw new Asn1Error(
      `The file is larger than 10 MiB (${withCommas(MAX_FILE_BYTES)} bytes), the most this page reads.`,
      'file',
    );
  }
}

/**
 * Turns pasted text or the bytes of a file into the bytes of the structure. Pasted text over 5 MiB and a file over 10 MiB
 * are refused before they are read. Text is PEM (any label, several blocks, text around them ignored), Base64 or Base64url
 * (white space anywhere, padding optional) or hex (spaces, colons and line breaks between digits). A file that holds only
 * printable text is read as text and any other file is the bytes of the structure itself.
 */
export function readInput(data: string | Uint8Array, format: InputFormat = 'auto'): ReadInputResult {
  if (typeof data === 'string') {
    checkPasteSize(data.length);
    if (data.trim() === '') throw new Asn1Error('There is nothing to read: the paste is empty.', 'input');
    const result = readText(data, format, 'input');
    if (result.bytes.length === 0) throw new Asn1Error('There is nothing to read: the paste holds no bytes.', 'input');
    return result;
  }
  checkFileSize(data.length);
  if (data.length === 0) throw new Asn1Error('This file is empty.', 'file');
  // A UTF-8 byte order mark at the start does not make a text file binary (textOfBytes drops it).
  const mark = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? 3 : 0;
  let text = true;
  for (let i = mark; i < data.length; i++) {
    if (!isTextByte(data[i]!)) {
      text = false;
      break;
    }
  }
  // The chosen form applies to a text file only: any other file is the bytes of the structure, whatever is chosen.
  if (text) {
    const result = readText(textOfBytes(data), format, 'file');
    if (result.bytes.length === 0) throw new Asn1Error('There is nothing to read: the file holds no bytes.', 'file');
    return result;
  }
  return { bytes: data, form: 'the bytes of the file', labels: [] };
}
