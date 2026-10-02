import meta from './meta.json';
import { cborToDiagnostic, decodeCborWithNotes, encodeCbor, type CborItem } from './cbor';
import { MAX_DEPTH, MAX_INPUT_BYTES, MAX_OUTPUT_CHARS, MsgpackCborError, decodeUtf8, tooLarge } from './common';
import { bytesToBase64, fromJsonValue, parseJson, stringifyJson, toJsonValue } from './json-markers';
import { decodeMsgpackWithNotes, encodeMsgpack, type MsgpackItem } from './msgpack';

export { meta, MAX_DEPTH, MAX_INPUT_BYTES, MAX_OUTPUT_CHARS, MsgpackCborError };

const isSpace = (code: number): boolean => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
const hexValue = (code: number): number =>
  code >= 0x30 && code <= 0x39
    ? code - 0x30
    : code >= 0x61 && code <= 0x66
      ? code - 0x61 + 10
      : code >= 0x41 && code <= 0x46
        ? code - 0x41 + 10
        : -1;

function readHex(text: string): Uint8Array {
  // First pass: check every character and count the digits, keeping nothing, so a refusal costs no allocation.
  let digits = 0;
  let run = 0;
  const endRun = (lastDigit: number): void => {
    if (run % 2 === 1) {
      throw new MsgpackCborError(
        `A byte is two hex digits, but the digit at character ${lastDigit} has no partner. Write pairs such as c2 49 01.`,
      );
    }
    run = 0;
  };
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (isSpace(code)) {
      endRun(index);
      continue;
    }
    if (hexValue(code) < 0) {
      throw new MsgpackCborError(
        `The text holds ${JSON.stringify(text[index])} at character ${index + 1}, which is not a hex digit. Use pairs of the digits 0 to 9 and a to f, or choose Base64.`,
      );
    }
    run++;
    digits++;
  }
  endRun(text.length);
  if (digits / 2 > MAX_INPUT_BYTES) throw tooLarge(digits / 2);
  // Second pass: fill the bytes.
  const bytes = new Uint8Array(digits / 2);
  let filled = 0;
  let high = -1;
  for (let index = 0; index < text.length; index++) {
    const value = hexValue(text.charCodeAt(index));
    if (value < 0) continue;
    if (high < 0) high = value;
    else {
      bytes[filled++] = (high << 4) | value;
      high = -1;
    }
  }
  return bytes;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function readBase64(text: string): Uint8Array {
  const values: number[] = [];
  let padding = 0;
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (isSpace(code)) continue;
    const char = text[index]!;
    if (char === '=') {
      padding++;
      continue;
    }
    if (padding > 0) {
      throw new MsgpackCborError(
        `The Base64 text holds ${JSON.stringify(char)} at character ${index + 1} after its = padding. Padding comes only at the end.`,
      );
    }
    const mapped = char === '-' ? 62 : char === '_' ? 63 : BASE64.indexOf(char);
    if (mapped < 0) {
      throw new MsgpackCborError(
        `The text holds ${JSON.stringify(char)} at character ${index + 1}, which is not a Base64 character. Use A to Z, a to z, 0 to 9, + and /, or choose hex.`,
      );
    }
    count++;
    // Refuse before the list can grow past the limit.
    if (Math.floor((count * 3) / 4) > MAX_INPUT_BYTES) throw tooLarge(Math.floor((count * 3) / 4));
    values.push(mapped);
  }
  if (count % 4 === 1) {
    throw new MsgpackCborError('The Base64 text has one character too many or too few: its length cannot be right.');
  }
  if (padding > 2 || (padding > 0 && (count + padding) % 4 !== 0)) {
    throw new MsgpackCborError('The Base64 padding (=) does not match the length of the text.');
  }
  const bytes = new Uint8Array(Math.floor((count * 3) / 4));
  let out = 0;
  for (let i = 0; i < values.length; i += 4) {
    const a = values[i]!;
    const b = values[i + 1] ?? 0;
    const c = values[i + 2] ?? 0;
    const d = values[i + 3] ?? 0;
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (out < bytes.length) bytes[out++] = (triple >> 16) & 255;
    if (out < bytes.length) bytes[out++] = (triple >> 8) & 255;
    if (out < bytes.length) bytes[out++] = triple & 255;
  }
  return bytes;
}

/** Reads pasted hex (pairs of digits, spaces and line breaks allowed) or Base64 as bytes. */
export function readInputBytes(text: string, encoding: 'hex' | 'base64'): Uint8Array {
  return encoding === 'hex' ? readHex(text) : readBase64(text);
}

export interface ConvertJob {
  format: 'msgpack' | 'cbor';
  direction: 'to-json' | 'from-json';
  input: string | Uint8Array;
  inputEncoding: 'hex' | 'base64';
  outputEncoding: 'hex' | 'base64';
  show: 'json' | 'diagnostic';
}

export interface ConvertResult {
  text: string;
  /** The bytes written, when the direction is from JSON. */
  bytes?: Uint8Array;
  warnings: string[];
  /** Bytes read: the binary input for to-json, the UTF-8 bytes of the JSON for from-json. */
  bytesIn: number;
  /** Bytes written: the UTF-8 bytes of the text for to-json, the binary output for from-json. */
  bytesOut: number;
  /** MessagePack to JSON only: the integer and float formats the input used and how many of each, in order of appearance. */
  widths?: [string, number][];
}

/** Refuses a size over 5 MiB, so a file can be refused before a byte of it is read. */
export function checkInputSize(size: number): void {
  if (size > MAX_INPUT_BYTES) throw tooLarge(size, 'This input');
}

function writeBytes(bytes: Uint8Array, encoding: 'hex' | 'base64'): string {
  if (encoding === 'base64') return bytesToBase64(bytes);
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 4096) {
    parts.push(Array.from(bytes.subarray(i, i + 4096), (b) => b.toString(16).padStart(2, '0')).join(''));
  }
  return parts.join('');
}

const utf8 = new TextEncoder();

function toJson(job: ConvertJob): ConvertResult {
  const bytes = typeof job.input === 'string' ? readInputBytes(job.input, job.inputEncoding) : job.input;
  if (bytes.length > MAX_INPUT_BYTES) throw tooLarge(bytes.length);
  const warnings: string[] = [];
  if (job.format === 'cbor') {
    const decoded = decodeCborWithNotes(bytes);
    const diagnostic = job.show === 'diagnostic';
    // Diagnostic notation shows chunks and widths as they are; the JSON form cannot, so it says what it joined.
    if (!diagnostic && decoded.joinedChunks) {
      warnings.push(
        'An indefinite-length string was joined into one value. JSON cannot show where its chunks ended, and it comes back as one definite-length string.',
      );
    }
    if (decoded.nanPayload) warnings.push(NAN_WARNING);
    const text = diagnostic ? cborToDiagnostic(decoded.item) : stringifyJson(toJsonValue(decoded.item, 'cbor'));
    return { text, warnings, bytesIn: bytes.length, bytesOut: utf8.encode(text).length };
  }
  const decoded = decodeMsgpackWithNotes(bytes);
  if (decoded.nanPayload) warnings.push(NAN_WARNING);
  const text = stringifyJson(toJsonValue(decoded.item, 'msgpack'));
  return {
    text,
    warnings,
    bytesIn: bytes.length,
    bytesOut: utf8.encode(text).length,
    ...(decoded.widths.length > 0 ? { widths: decoded.widths } : {}),
  };
}

const NAN_WARNING =
  'A NaN with payload bits was read. It is written as the $float marker NaN and comes back as the usual quiet NaN, so the payload bits are not kept.';

function fromJson(job: ConvertJob): ConvertResult {
  let text: string;
  if (typeof job.input === 'string') {
    // A character is at least one byte, so text longer than the limit is over it before any encoding.
    if (job.input.length > MAX_INPUT_BYTES) throw tooLarge(job.input.length, 'The JSON');
    text = job.input;
  } else {
    if (job.input.length > MAX_INPUT_BYTES) throw tooLarge(job.input.length, 'The JSON');
    text = decodeUtf8(job.input, 0, 'JSON text');
  }
  const bytesIn = utf8.encode(text).length;
  if (bytesIn > MAX_INPUT_BYTES) throw tooLarge(bytesIn, 'The JSON');
  const tree = parseJson(text);
  const built = job.format === 'cbor' ? fromJsonValue(tree, 'cbor') : fromJsonValue(tree, 'msgpack');
  const bytes = job.format === 'cbor' ? encodeCbor(built.item as CborItem) : encodeMsgpack(built.item as MsgpackItem);
  return {
    text: writeBytes(bytes, job.outputEncoding),
    bytes,
    warnings: built.warnings,
    bytesIn,
    bytesOut: bytes.length,
  };
}

/**
 * Converts between MessagePack or CBOR and JSON. From binary, the input is hex or Base64 text, or bytes (a file), and
 * the result is JSON text (or CBOR diagnostic notation); from JSON, the result is the binary value as hex or Base64.
 */
export function convert(job: ConvertJob): ConvertResult {
  return job.direction === 'to-json' ? toJson(job) : fromJson(job);
}
