/**
 * CRC-32 (RFC 1952 section 8, the same reflected IEEE polynomial 0xEDB88320
 * PKWARE's APPNOTE.TXT section 4.4.7 and the W3C PNG specification's Annex D
 * define) and Adler-32 (RFC 1950 section 9). Both support a streaming
 * update so a value can be folded a chunk at a time as data is inflated.
 * The CRC-32 table and accumulator are the same algorithm as
 * tools/archive-toolkit/src/crc32.ts, written here independently rather
 * than imported, so this package stands alone.
 */

let crcTableCache: Int32Array | null = null;

function crcTable(): Int32Array {
  if (crcTableCache) return crcTableCache;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  crcTableCache = t;
  return t;
}

/** Computes the CRC-32 of a complete byte array in one call. */
export function crc32(bytes: Uint8Array): number {
  return crc32Update(0, bytes) >>> 0;
}

/**
 * Folds `bytes` into a running CRC-32. Pass 0 for the first chunk and the
 * previous return value for every following chunk; the last call's return
 * value is the finished checksum, directly comparable to a one-shot
 * `crc32` call over the same bytes concatenated.
 */
export function crc32Update(crc: number, bytes: Uint8Array): number {
  const t = crcTable();
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const ADLER_MOD = 65521;

/** Computes the Adler-32 (RFC 1950 section 9) of a complete byte array in one call. Adler-32 of an empty input is 1 (s1 starts at 1, s2 at 0). */
export function adler32(bytes: Uint8Array): number {
  return adler32Update(1, bytes) >>> 0;
}

/**
 * Folds `bytes` into a running Adler-32. Pass 1 (not 0) for the first
 * chunk, matching RFC 1950 section 9's initial s1=1, s2=0, and the previous
 * return value for every following chunk.
 */
export function adler32Update(adler: number, bytes: Uint8Array): number {
  let s1 = adler & 0xffff;
  let s2 = (adler >>> 16) & 0xffff;
  // NMAX from RFC 1950's reference implementation: the largest run of bytes
  // that can accumulate into s2 before a modulo reduction is required to
  // avoid exceeding 32-bit precision.
  const NMAX = 5552;
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const end = Math.min(i + NMAX, n);
    for (; i < end; i++) {
      s1 += bytes[i]!;
      s2 += s1;
    }
    s1 %= ADLER_MOD;
    s2 %= ADLER_MOD;
  }
  return ((s2 << 16) | s1) >>> 0;
}
