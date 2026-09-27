/**
 * A hand-written PNG writer for a QR matrix -- no library, no canvas.
 *
 * Output is a colour-type-3 (palette) PNG at bit depth 1: W3C PNG (Third
 * Edition) chapters 4 (chunk layout, CRC-32), 5 (IHDR/PLTE/IDAT/IEND) and
 * 11.2.2/11.2.3 (IHDR field meanings, PLTE). IDAT is a zlib stream (RFC
 * 1950) built from "stored" (uncompressed) deflate blocks (RFC 1951 section
 * 3.2.4) -- no compression library, and the exact scanline bytes are
 * recoverable byte for byte by `node:zlib`'s inflate.
 */

import { resolveColors, type Matrix, type RenderOptions, type RenderResult } from './svg';

function crc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crc32Table();

/** PNG CRC-32 (W3C PNG Third Edition, chapter 4 "CRC algorithm"), the same
 * IEEE 802.3 polynomial ZIP uses. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** RFC 1950 Adler-32. */
function adler32(bytes: Uint8Array): number {
  const MOD = 65521;
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** RFC 1951 section 3.2.4: one or more "stored" (BTYPE=00) blocks, each
 * limited to 65535 bytes, the last one carrying BFINAL=1. Every stored
 * block is written byte-aligned: a one-byte header (BFINAL in bit 0, BTYPE
 * 00 in bits 1-2, the remaining bits of that byte unused per "any bits of
 * input up to the next byte boundary are ignored" in section 3.2.3), then
 * LEN and its one's-complement NLEN as two little-endian bytes each, then
 * the literal bytes. */
function deflateStored(data: Uint8Array): Uint8Array {
  const MAX_BLOCK = 65535;
  const blocks: Uint8Array[] = [];
  let offset = 0;
  if (data.length === 0) {
    // A single, final, empty stored block.
    blocks.push(new Uint8Array([1, 0, 0, 0xff, 0xff]));
  }
  while (offset < data.length) {
    const chunk = data.subarray(offset, Math.min(offset + MAX_BLOCK, data.length));
    const isLast = offset + chunk.length >= data.length;
    const len = chunk.length;
    const nlen = ~len & 0xffff;
    const header = new Uint8Array([isLast ? 1 : 0, len & 0xff, (len >>> 8) & 0xff, nlen & 0xff, (nlen >>> 8) & 0xff]);
    blocks.push(header, chunk);
    offset += chunk.length;
  }
  return concatBytes(blocks);
}

/** RFC 1950: a 2-byte zlib header, the deflate stream, then Adler-32 of the
 * uncompressed data, big-endian. */
function zlibStore(data: Uint8Array): Uint8Array {
  const header = new Uint8Array([0x78, 0x01]); // CM=8/CINFO=7, FCHECK makes the 16-bit value a multiple of 31
  const deflate = deflateStored(data);
  const checksum = u32be(adler32(data));
  return concatBytes([header, deflate, checksum]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = concatBytes([typeBytes, data]);
  const crc = u32be(crc32(body));
  return concatBytes([u32be(data.length), typeBytes, data, crc]);
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const DEFAULT_MARGIN = 4;

export function matrixToPng(matrix: Matrix, options: RenderOptions = {}): { output: Uint8Array; warnings: string[] } {
  const scale = Math.max(1, Math.round(options.scale ?? 8));
  const margin = Math.max(0, Math.round(options.margin ?? DEFAULT_MARGIN));
  const { dark, light, warnings } = resolveColors(options.dark, options.light);
  if (margin < DEFAULT_MARGIN) {
    warnings.push(
      `A margin of ${margin} modules is narrower than the ${DEFAULT_MARGIN}-module quiet zone ISO/IEC 18004 requires, which can make the code harder to scan.`,
    );
  }
  const { size, modules } = matrix;
  const total = size + margin * 2;
  const width = total * scale;
  const height = total * scale;

  const ihdr = concatBytes([
    u32be(width),
    u32be(height),
    new Uint8Array([1, 3, 0, 0, 0]), // bit depth 1, colour type 3 (palette), compression 0, filter 0, interlace 0
  ]);

  const plte = new Uint8Array([light.r, light.g, light.b, dark.r, dark.g, dark.b]);

  const rowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array((rowBytes + 1) * height); // one filter byte (0, "None") per row
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (rowBytes + 1);
    raw[rowOffset] = 0; // filter type None (W3C PNG Third Edition, 9.2 "Filter type 0: None")
    const srcRow = Math.floor(y / scale) - margin;
    for (let x = 0; x < width; x++) {
      const srcCol = Math.floor(x / scale) - margin;
      const dark_ =
        srcRow >= 0 && srcRow < size && srcCol >= 0 && srcCol < size && modules[srcRow * size + srcCol] === 1;
      if (dark_) {
        const byteIndex = rowOffset + 1 + (x >> 3);
        raw[byteIndex]! |= 0x80 >> (x & 7);
      }
    }
  }

  const idatData = zlibStore(raw);

  const png = concatBytes([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', idatData),
    chunk('IEND', new Uint8Array(0)),
  ]);

  return { output: png, warnings };
}

export { crc32, adler32, deflateStored, zlibStore };
