/**
 * CRC-32, the IEEE polynomial 0xEDB88320 (reflected), exactly as PKWARE's
 * APPNOTE.TXT section 4.4.7 defines it for a ZIP entry's own `crc-32` field
 * ("The CRC-32 algorithm was generously contributed by David Schwaderer
 * and can be found in his excellent book 'C Programmers Guide to NetBIOS'
 * published by Howard W. Sams & Co. Almost any technical bookstore will
 * have both an assembler language and C listing of the CRC-32 algorithm.")
 * and the same polynomial the W3C PNG specification's Annex D quotes in
 * full C source, and RFC 1952 section 8 cites by reference -- one table
 * and one accumulator function reused by every reader that needs
 * this checksum.
 */

let table: Int32Array | null = null;

function crcTable(): Int32Array {
  if (table) return table;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  table = t;
  return t;
}

/** Computes the CRC-32 of a complete byte array in one call. */
export function crc32(bytes: Uint8Array): number {
  return crc32Update(0, bytes) >>> 0;
}

/**
 * Folds `bytes` into a running CRC-32, so a value can be streamed a chunk
 * at a time as an entry is inflated. Pass `0` for the first chunk of an
 * entry and the previous return value for every following chunk; the last
 * call's own return value is the entry's finished checksum, directly
 * comparable to a plain, non-streamed `crc32` call over the same bytes
 * joined together.
 */
export function crc32Update(crc: number, bytes: Uint8Array): number {
  const t = crcTable();
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
