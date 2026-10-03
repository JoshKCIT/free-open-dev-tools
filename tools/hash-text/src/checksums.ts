import { CRC_CATALOGUE, type CrcParams } from './crc-catalogue';

/** Reverses the lowest `width` bits of `value` (bit 0 becomes bit width - 1). */
function reflect(value: number, width: number): number {
  let reversed = 0;
  for (let i = 0; i < width; i++) {
    if ((value >>> i) & 1) reversed |= 1 << (width - 1 - i);
  }
  return reversed >>> 0;
}

/**
 * Builds the CRC function of one parameter set in the Rocksoft model: a 256 entry table, then one table step per byte.
 * It handles every width up to 32 bits, with the input and the result reflected or not. The returned function reads
 * bytes only; it holds no state between calls.
 */
export function makeCrc(params: CrcParams): (bytes: Uint8Array) => number {
  const { width, poly, init, refin, refout, xorout } = params;
  const mask = width === 32 ? 0xffffffff : (1 << width) - 1;
  const top = 2 ** (width - 1);
  const table = new Uint32Array(256);
  if (refin) {
    const reversedPoly = reflect(poly, width);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ reversedPoly : c >>> 1;
      table[i] = c >>> 0;
    }
  } else {
    for (let i = 0; i < 256; i++) {
      let c = (i << (width - 8)) >>> 0;
      for (let k = 0; k < 8; k++) c = (c & top) !== 0 ? ((c << 1) ^ poly) >>> 0 : (c << 1) >>> 0;
      table[i] = (c & mask) >>> 0;
    }
  }
  return (bytes: Uint8Array): number => {
    let crc: number;
    if (refin) {
      crc = reflect(init, width);
      for (let i = 0; i < bytes.length; i++) crc = (table[(crc ^ bytes[i]!) & 255]! ^ (crc >>> 8)) >>> 0;
    } else {
      crc = init;
      for (let i = 0; i < bytes.length; i++) {
        crc = ((table[((crc >>> (width - 8)) ^ bytes[i]!) & 255]! ^ (crc << 8)) & mask) >>> 0;
      }
    }
    if (refin !== refout) crc = reflect(crc, width);
    return ((crc ^ xorout) & mask) >>> 0;
  };
}

// The tables of the 43 catalogue entries are built once, when this module loads. The key is the entry object itself,
// never a name typed by a visitor.
const CATALOGUE_CRCS = new Map<CrcParams, (bytes: Uint8Array) => number>(
  CRC_CATALOGUE.map((entry) => [entry, makeCrc(entry)]),
);

/** The CRC of `bytes` for one parameter set. A catalogue entry reuses its table; any other set builds one. */
export function crcValue(bytes: Uint8Array, params: CrcParams): number {
  const known = CATALOGUE_CRCS.get(params);
  return known ? known(bytes) : makeCrc(params)(bytes);
}

/** The largest run of bytes whose sums stay below 2^32 before the remainder is taken (zlib's NMAX). */
const ADLER_BLOCK = 5552;

/**
 * Adler-32 as RFC 1950 section 8.2 defines it: s1 starts at 1 and adds every byte, s2 starts at 0 and adds every s1, both
 * modulo 65521, and the checksum is s2 * 65536 + s1. The remainders are taken once per block of 5552 bytes, which gives
 * the same result as taking them at every byte.
 */
export function adler32(bytes: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  let i = 0;
  while (i < bytes.length) {
    const end = Math.min(i + ADLER_BLOCK, bytes.length);
    for (; i < end; i++) {
      s1 += bytes[i]!;
      s2 += s1;
    }
    s1 %= 65521;
    s2 %= 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}

/** The bytes a checksum of `width` bits is shown as: most significant byte first, 2 bytes for 16 bits, 4 for 32. */
export function checksumBytes(value: number, width: number): Uint8Array {
  const out = new Uint8Array(width / 8);
  for (let i = 0; i < out.length; i++) out[i] = (value >>> (8 * (out.length - 1 - i))) & 0xff;
  return out;
}

export interface ChecksumRow {
  /** The catalogue name, for example CRC-32/ISCSI. */
  name: string;
  /** The other names the catalogue lists for it, for example CRC-32C. */
  aliases: string[];
  /** The size of the checksum in bits. */
  width: number;
  /** The checksum as an unsigned number. */
  value: number;
}

/** Every checksum of the catalogue over the same bytes, in catalogue order, then Adler-32. */
export function checksumRows(bytes: Uint8Array): ChecksumRow[] {
  const rows: ChecksumRow[] = CRC_CATALOGUE.map((entry) => ({
    name: entry.name,
    aliases: [...entry.aliases],
    width: entry.width,
    value: crcValue(bytes, entry),
  }));
  rows.push({ name: 'Adler-32', aliases: [], width: 32, value: adler32(bytes) });
  return rows;
}
