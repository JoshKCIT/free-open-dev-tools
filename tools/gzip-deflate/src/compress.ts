/**
 * Compresses bytes or UTF-8 text to gzip, zlib or raw deflate with fflate's
 * synchronous compressors, deterministically: gzip output always carries
 * MTIME 0 and no file name, so compressing the same input twice gives
 * byte-identical output.
 */
import { gzipSync, zlibSync, deflateSync } from 'fflate';
import { GzipDeflateError } from './errors';
import { decodeHex } from './input';

export type CompressFormat = 'gzip' | 'zlib' | 'raw';

function validLevel(level: number): asserts level is 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 {
  if (!Number.isInteger(level) || level < 0 || level > 9) {
    throw new GzipDeflateError('input', 'compression level must be a whole number from 0 to 9');
  }
}

export interface CompressBytesOptions {
  format: CompressFormat;
  level: number;
}

export function compressBytes(bytes: Uint8Array, options: CompressBytesOptions): Uint8Array {
  validLevel(options.level);
  const level = options.level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  if (options.format === 'gzip') return gzipSync(bytes, { level, mtime: 0 });
  if (options.format === 'zlib') return zlibSync(bytes, { level });
  return deflateSync(bytes, { level });
}

const B64_STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function encodeBase64(bytes: Uint8Array, table: string, pad: boolean): string {
  let out = '';
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += table[(n >> 18) & 63]! + table[(n >> 12) & 63]! + table[(n >> 6) & 63]! + table[n & 63]!;
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i]! << 16;
    out += table[(n >> 18) & 63]! + table[(n >> 12) & 63]!;
    if (pad) out += '==';
  } else if (remaining === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += table[(n >> 18) & 63]! + table[(n >> 12) & 63]! + table[(n >> 6) & 63]!;
    if (pad) out += '=';
  }
  return out;
}

function encodeHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).toUpperCase().padStart(2, '0');
  return out;
}

export type CompressOutputEncoding = 'base64' | 'base64url' | 'hex';

export interface CompressOptions {
  inputKind: 'text' | 'hex';
  format: CompressFormat;
  level: number;
  outputEncoding: CompressOutputEncoding;
  percentEncode: boolean;
}

export interface CompressResult {
  text: string;
  bytes: Uint8Array;
  inputBytes: Uint8Array;
}

export function compress(input: string, options: CompressOptions): CompressResult {
  const inputBytes = options.inputKind === 'hex' ? decodeHex(input) : new TextEncoder().encode(input);
  const bytes = compressBytes(inputBytes, { format: options.format, level: options.level });

  let text: string;
  if (options.outputEncoding === 'hex') {
    text = encodeHex(bytes);
  } else {
    const urlSafe = options.outputEncoding === 'base64url';
    text = encodeBase64(bytes, urlSafe ? B64_URL : B64_STD, !urlSafe);
    if (options.percentEncode) text = encodeURIComponent(text);
  }
  return { text, bytes, inputBytes };
}
