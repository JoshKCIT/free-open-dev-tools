import { hmac } from '@noble/hashes/hmac.js';
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { sha224, sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { sha3_256, sha3_512 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes, hexToBytes } from '@noble/hashes/utils.js';
import meta from './meta.json';

export { meta };

export type HmacAlgorithm = 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512' | 'sha3-256' | 'sha3-512';
export type Encoding = 'utf8' | 'hex' | 'base64';
export type OutputFormat = 'hex' | 'HEX' | 'base64' | 'base64url';

const HASHES = {
  md5,
  sha1,
  sha224,
  sha256,
  sha384,
  sha512,
  'sha3-256': sha3_256,
  'sha3-512': sha3_512,
} as const;

export interface AlgorithmInfo {
  id: HmacAlgorithm;
  label: string;
  /** Internal block size in bytes. Keys longer than this are hashed first. */
  blockSize: number;
  outputBytes: number;
  note: string;
}

export const ALGORITHMS: AlgorithmInfo[] = [
  {
    id: 'md5',
    label: 'HMAC-MD5',
    blockSize: 64,
    outputBytes: 16,
    note: 'Still used by some legacy APIs. HMAC-MD5 is not as broken as plain MD5, but do not choose it for anything new.',
  },
  {
    id: 'sha1',
    label: 'HMAC-SHA1',
    blockSize: 64,
    outputBytes: 20,
    note: 'Used by AWS Signature v2, OAuth 1.0a and TOTP. Acceptable inside HMAC, but SHA-256 is the better default.',
  },
  { id: 'sha224', label: 'HMAC-SHA224', blockSize: 64, outputBytes: 28, note: 'SHA-2 family.' },
  {
    id: 'sha256',
    label: 'HMAC-SHA256',
    blockSize: 64,
    outputBytes: 32,
    note: 'The sensible default. Used by JWT HS256, AWS Signature v4 and most webhook signatures.',
  },
  { id: 'sha384', label: 'HMAC-SHA384', blockSize: 128, outputBytes: 48, note: 'SHA-2 family. JWT calls this HS384.' },
  { id: 'sha512', label: 'HMAC-SHA512', blockSize: 128, outputBytes: 64, note: 'SHA-2 family. JWT calls this HS512.' },
  { id: 'sha3-256', label: 'HMAC-SHA3-256', blockSize: 136, outputBytes: 32, note: 'Keccak-based. Rare in practice.' },
  { id: 'sha3-512', label: 'HMAC-SHA3-512', blockSize: 72, outputBytes: 64, note: 'Keccak-based. Rare in practice.' },
];

export function decodeBytes(input: string, encoding: Encoding): Uint8Array {
  if (encoding === 'utf8') return utf8ToBytes(input);
  if (encoding === 'hex') {
    const cleaned = input.replace(/[\s:_-]/g, '');
    if (cleaned.length % 2 !== 0) throw new Error('Hex must have an even number of digits.');
    if (!/^[0-9a-fA-F]*$/.test(cleaned)) throw new Error('Hex contains a character that is not a hex digit.');
    return hexToBytes(cleaned.toLowerCase());
  }
  const cleaned = input.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array, urlSafe: boolean): string {
  const alpha = urlSafe
    ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += alpha[b0 >> 2];
    if (b1 === undefined) {
      out += alpha[(b0 & 3) << 4]! + (urlSafe ? '' : '==');
      break;
    }
    out += alpha[((b0 & 3) << 4) | (b1 >> 4)];
    if (b2 === undefined) {
      out += alpha[(b1 & 15) << 2]! + (urlSafe ? '' : '=');
      break;
    }
    out += alpha[((b1 & 15) << 2) | (b2 >> 6)]! + alpha[b2 & 63]!;
  }
  return out;
}

export function format(digest: Uint8Array, output: OutputFormat): string {
  switch (output) {
    case 'hex':
      return bytesToHex(digest);
    case 'HEX':
      return bytesToHex(digest).toUpperCase();
    case 'base64':
      return toBase64(digest, false);
    case 'base64url':
      return toBase64(digest, true);
  }
}

/** Computes an RFC 2104 HMAC over raw bytes. */
export function hmacBytes(key: Uint8Array, message: Uint8Array, algorithm: HmacAlgorithm): Uint8Array {
  const hash = HASHES[algorithm];
  if (!hash) throw new Error(`Unknown algorithm: ${algorithm}`);
  return hmac(hash, key, message);
}

export interface HmacOptions {
  algorithm?: HmacAlgorithm;
  keyEncoding?: Encoding;
  messageEncoding?: Encoding;
  output?: OutputFormat;
}

export function computeHmac(key: string, message: string, options: HmacOptions = {}): string {
  const { algorithm = 'sha256', keyEncoding = 'utf8', messageEncoding = 'utf8', output = 'hex' } = options;
  return format(hmacBytes(decodeBytes(key, keyEncoding), decodeBytes(message, messageEncoding), algorithm), output);
}

/**
 * Compares two digests without leaking where they first differ through timing.
 *
 * Verifying a webhook signature with `===` is a real, exploitable bug, so the
 * safe comparison is exported rather than left as an exercise.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = a
    .trim()
    .toLowerCase()
    .replace(/[\s:_-]/g, '');
  const y = b
    .trim()
    .toLowerCase()
    .replace(/[\s:_-]/g, '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export interface KeyReport {
  bytes: number;
  blockSize: number;
  /** True when the key is longer than the block size and will be hashed first. */
  hashedFirst: boolean;
  /** True when the key is shorter than the digest, which weakens the MAC. */
  shorterThanDigest: boolean;
}

/** Explains what HMAC will do with a key of this length, which is rarely obvious. */
export function describeKey(key: Uint8Array, algorithm: HmacAlgorithm): KeyReport {
  const info = ALGORITHMS.find((a) => a.id === algorithm)!;
  return {
    bytes: key.length,
    blockSize: info.blockSize,
    hashedFirst: key.length > info.blockSize,
    shorterThanDigest: key.length < info.outputBytes,
  };
}
