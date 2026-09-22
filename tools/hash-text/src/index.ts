import { md5, sha1, ripemd160 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512, sha224 } from '@noble/hashes/sha2.js';
import { sha3_256, sha3_512, keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes, hexToBytes } from '@noble/hashes/utils.js';
import meta from './meta.json';

export { meta };

export type Algorithm =
  | 'md5'
  | 'sha1'
  | 'sha224'
  | 'sha256'
  | 'sha384'
  | 'sha512'
  | 'sha3-256'
  | 'sha3-512'
  | 'keccak-256'
  | 'ripemd160'
  | 'crc32';

export type OutputFormat = 'hex' | 'HEX' | 'base64' | 'base64url';

export interface AlgorithmInfo {
  id: Algorithm;
  label: string;
  bits: number;
  /** Safe for signatures, password storage or integrity against an adversary? */
  security: 'broken' | 'legacy' | 'ok' | 'checksum';
  note: string;
}

/**
 * The security column is the part people get wrong. It is stated plainly here
 * so the tool can warn rather than silently hand over MD5 for a signature.
 */
export const ALGORITHMS: AlgorithmInfo[] = [
  {
    id: 'md5',
    label: 'MD5',
    bits: 128,
    security: 'broken',
    note: 'Collisions are trivial to produce. Fine for a non-adversarial checksum such as an ETag, never for signatures, certificates or passwords.',
  },
  {
    id: 'sha1',
    label: 'SHA-1',
    bits: 160,
    security: 'broken',
    note: 'Practical collisions were demonstrated in 2017. Still seen in Git object ids and older TLS; do not use it for anything new.',
  },
  { id: 'sha224', label: 'SHA-224', bits: 224, security: 'ok', note: 'SHA-2 family, truncated SHA-256.' },
  {
    id: 'sha256',
    label: 'SHA-256',
    bits: 256,
    security: 'ok',
    note: 'The sensible default for general integrity work.',
  },
  { id: 'sha384', label: 'SHA-384', bits: 384, security: 'ok', note: 'SHA-2 family. Used by some TLS cipher suites.' },
  {
    id: 'sha512',
    label: 'SHA-512',
    bits: 512,
    security: 'ok',
    note: 'SHA-2 family. Faster than SHA-256 on 64-bit hardware.',
  },
  {
    id: 'sha3-256',
    label: 'SHA3-256',
    bits: 256,
    security: 'ok',
    note: 'Keccak-based, standardised in FIPS 202. A different construction from SHA-2.',
  },
  { id: 'sha3-512', label: 'SHA3-512', bits: 512, security: 'ok', note: 'Keccak-based, standardised in FIPS 202.' },
  {
    id: 'keccak-256',
    label: 'Keccak-256',
    bits: 256,
    security: 'ok',
    note: 'The original Keccak padding, not the FIPS 202 one. This is what Ethereum uses, and it gives different output from SHA3-256.',
  },
  {
    id: 'ripemd160',
    label: 'RIPEMD-160',
    bits: 160,
    security: 'legacy',
    note: 'Used in Bitcoin addresses. No practical collisions known, but far less studied than SHA-2.',
  },
  {
    id: 'crc32',
    label: 'CRC-32',
    bits: 32,
    security: 'checksum',
    note: 'An error-detection code, not a hash. Trivially forgeable. Used by ZIP, PNG and Ethernet.',
  },
];

// IEEE 802.3 polynomial, reflected. This is the CRC-32 that ZIP, PNG and gzip use.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
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
      out += alpha[(b0 & 3) << 4];
      out += urlSafe ? '' : '==';
      break;
    }
    out += alpha[((b0 & 3) << 4) | (b1 >> 4)];
    if (b2 === undefined) {
      out += alpha[(b1 & 15) << 2];
      out += urlSafe ? '' : '=';
      break;
    }
    out += alpha[((b1 & 15) << 2) | (b2 >> 6)];
    out += alpha[b2 & 63];
  }
  return out;
}

/** Hashes raw bytes. Every other entry point funnels through here. */
export function hashBytes(bytes: Uint8Array, algorithm: Algorithm): Uint8Array {
  switch (algorithm) {
    case 'md5':
      return md5(bytes);
    case 'sha1':
      return sha1(bytes);
    case 'sha224':
      return sha224(bytes);
    case 'sha256':
      return sha256(bytes);
    case 'sha384':
      return sha384(bytes);
    case 'sha512':
      return sha512(bytes);
    case 'sha3-256':
      return sha3_256(bytes);
    case 'sha3-512':
      return sha3_512(bytes);
    case 'keccak-256':
      return keccak_256(bytes);
    case 'ripemd160':
      return ripemd160(bytes);
    case 'crc32': {
      const value = crc32(bytes);
      return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
    }
    default: {
      const exhaustive: never = algorithm;
      throw new Error(`Unknown algorithm: ${String(exhaustive)}`);
    }
  }
}

export function format(digest: Uint8Array, output: OutputFormat): string {
  switch (output) {
    case 'hex':
      return bytesToHex(digest);
    case 'HEX':
      return bytesToHex(digest).toUpperCase();
    case 'base64':
      return bytesToBase64(digest, false);
    case 'base64url':
      return bytesToBase64(digest, true);
  }
}

export type InputEncoding = 'utf8' | 'hex' | 'base64';

export function decodeInput(input: string, encoding: InputEncoding): Uint8Array {
  if (encoding === 'utf8') return utf8ToBytes(input);
  if (encoding === 'hex') {
    const cleaned = input.replace(/[\s:_-]/g, '');
    if (cleaned.length % 2 !== 0) throw new Error('Hex input must have an even number of digits.');
    if (!/^[0-9a-fA-F]*$/.test(cleaned)) throw new Error('Hex input contains a character that is not a hex digit.');
    return hexToBytes(cleaned.toLowerCase());
  }
  const cleaned = input.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = cleaned + '='.repeat((4 - (cleaned.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface HashResult {
  algorithm: Algorithm;
  label: string;
  bits: number;
  security: AlgorithmInfo['security'];
  digest: string;
}

/** Hashes text with one algorithm. */
export function hashText(text: string, algorithm: Algorithm, output: OutputFormat = 'hex'): string {
  return format(hashBytes(utf8ToBytes(text), algorithm), output);
}

/** Hashes one input with every algorithm, which is the common case in a UI. */
export function hashAll(bytes: Uint8Array, output: OutputFormat = 'hex'): HashResult[] {
  return ALGORITHMS.map((a) => ({
    algorithm: a.id,
    label: a.label,
    bits: a.bits,
    security: a.security,
    digest: format(hashBytes(bytes, a.id), output),
  }));
}

/** Constant-time-ish comparison of two hex digests, ignoring case and separators. */
export function digestsMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[\s:_-]/g, '');
  const x = norm(a);
  const y = norm(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
