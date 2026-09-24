/**
 * Chunk-at-a-time multi-algorithm digesting over byte arrays, plus checksum
 * comparison. Create, update, finish -- the shape D-15 specifies.
 *
 * This file takes byte arrays only and mentions no browser-only type
 * anywhere, not even in a comment: the folder is copied out and built and
 * tested in plain Node by a release gate that has no such type available.
 * The page that hands this package chunks read from whatever a visitor
 * picked lives entirely outside this folder, in the web application.
 */
import { md5, sha1, ripemd160 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512, sha224 } from '@noble/hashes/sha2.js';
import { sha3_256, sha3_512, keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
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

// Deliberate copy of tools/hash-text/src/index.ts's ALGORITHMS array. A tool
// package may not depend on another tool package (the catalog gate enforces
// this), so this table is duplicated rather than imported. Do not factor it
// out into a shared module later: that would break both folders' standalone
// build, which is exactly what this duplication exists to avoid.
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

// IEEE 802.3 polynomial, reflected. This is the CRC-32 that ZIP, PNG and
// gzip use. Deliberate copy of tools/hash-text/src/index.ts's table, for the
// same reason the ALGORITHMS array above is copied rather than imported.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

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

/** Formats a digest exactly as the text hash tool's own formatter does for the same bytes. */
export function formatDigest(digest: Uint8Array, output: OutputFormat): string {
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

/** Constant-time-ish comparison of two checksum strings, ignoring case and separators. */
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

export class HashFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HashFileError';
  }
}

/** One noble/hashes stateful digest object -- what every algorithm's own `.create()` returns. */
interface IncrementalHasher {
  update(chunk: Uint8Array): unknown;
  digest(): Uint8Array;
}

function startIncrementalHasher(id: Exclude<Algorithm, 'crc32'>): IncrementalHasher {
  switch (id) {
    case 'md5':
      return md5.create();
    case 'sha1':
      return sha1.create();
    case 'sha224':
      return sha224.create();
    case 'sha256':
      return sha256.create();
    case 'sha384':
      return sha384.create();
    case 'sha512':
      return sha512.create();
    case 'sha3-256':
      return sha3_256.create();
    case 'sha3-512':
      return sha3_512.create();
    case 'keccak-256':
      return keccak_256.create();
    case 'ripemd160':
      return ripemd160.create();
    default: {
      const exhaustive: never = id;
      throw new Error(`Unknown algorithm: ${String(exhaustive)}`);
    }
  }
}

const KNOWN_ALGORITHM_IDS = new Set(ALGORITHMS.map((a) => a.id));

interface HasherEntry {
  id: Algorithm;
  /** Present for every algorithm except the error-detecting checksum. */
  incremental?: IncrementalHasher;
  /**
   * Present only for the error-detecting checksum, which has no stateful
   * update/digest object of its own in the underlying library. Starts at
   * the all-ones value and is advanced byte by byte across every call to
   * updateHashers the same way the one-shot version does; the final
   * inversion is applied only once, in finishHashers.
   */
  crcAccumulator?: number;
  finished: boolean;
}

/** The state returned by createHashers and threaded through updateHashers and finishHashers. */
export interface HasherState {
  entries: HasherEntry[];
}

/**
 * Starts hashing for a list of algorithms. One call advances every
 * algorithm in the list over each chunk passed to updateHashers, so the
 * input is read once no matter how many algorithms are selected.
 */
export function createHashers(algorithms: Algorithm[]): HasherState {
  if (algorithms.length === 0) {
    throw new HashFileError('At least one algorithm must be selected.');
  }
  const entries: HasherEntry[] = algorithms.map((id) => {
    if (!KNOWN_ALGORITHM_IDS.has(id)) {
      throw new HashFileError(
        `Unknown algorithm "${id}". Available algorithms: ${ALGORITHMS.map((a) => a.id).join(', ')}.`,
      );
    }
    if (id === 'crc32') return { id, crcAccumulator: 0xffffffff, finished: false };
    return { id, incremental: startIncrementalHasher(id), finished: false };
  });
  return { entries };
}

/**
 * Advances every algorithm in the given state over one chunk. An empty
 * chunk changes nothing. Calling this after finishHashers has already run
 * on this state throws, because the underlying digest object is destroyed
 * by finalising and a second update would produce a meaningless result
 * rather than a clear failure.
 */
export function updateHashers(state: HasherState, chunk: Uint8Array): void {
  if (chunk.length === 0) return;
  for (const entry of state.entries) {
    if (entry.finished) {
      throw new HashFileError('Cannot advance this hashing state: it has already been finished once.');
    }
    if (entry.id === 'crc32') {
      let crc = entry.crcAccumulator!;
      for (let i = 0; i < chunk.length; i++) {
        crc = CRC_TABLE[(crc ^ chunk[i]!) & 0xff]! ^ (crc >>> 8);
      }
      entry.crcAccumulator = crc;
    } else {
      entry.incremental!.update(chunk);
    }
  }
}

export interface FileHashResult {
  algorithm: Algorithm;
  label: string;
  bits: number;
  security: AlgorithmInfo['security'];
  digest: string;
}

/**
 * Finishes every algorithm in the state and returns one result per
 * algorithm, in the order the algorithms were requested. Finishing a state
 * a second time throws naming the reason, rather than silently returning a
 * meaningless value: the underlying library digest call destroys its
 * internal state the first time it runs.
 */
export function finishHashers(state: HasherState, format: OutputFormat): FileHashResult[] {
  if (state.entries.some((e) => e.finished)) {
    throw new HashFileError(
      'This hashing state has already been finished once. The underlying digest state was destroyed by that call and cannot be finished again.',
    );
  }
  return state.entries.map((entry) => {
    entry.finished = true;
    const info = ALGORITHMS.find((a) => a.id === entry.id)!;
    let digestBytes: Uint8Array;
    if (entry.id === 'crc32') {
      const value = (entry.crcAccumulator! ^ 0xffffffff) >>> 0;
      digestBytes = new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
    } else {
      digestBytes = entry.incremental!.digest();
    }
    return {
      algorithm: entry.id,
      label: info.label,
      bits: info.bits,
      security: info.security,
      digest: formatDigest(digestBytes, format),
    };
  });
}
