/**
 * Test-only fixture builder for this package's own tests: a real, decodable
 * PNG (W3C PNG Third Edition, `node:zlib` deflate, the same compressed-data
 * format PNG itself uses) with an alpha channel, and minimal JPEGs (ITU-T
 * T.81 Annex B: a baseline SOF0 marker segment naming height, width and
 * component count is all `@cantoo/pdf-lib`'s own embedder needs to read; it
 * never decodes the entropy-coded scan data, confirmed directly against the
 * installed 2.11.1 `JpegEmbedder` source this session) carrying a real
 * Exif Orientation tag (CIPA DC-008-2019 section 4.6.4).
 */
import { deflateSync } from 'node:zlib';

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}
function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}
function concatBytes(...parts: (number[] | Uint8Array)[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p instanceof Uint8Array ? p : Uint8Array.from(p), offset);
    offset += p.length;
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = concatBytes(ascii(type), data);
  return concatBytes(u32be(data.length), typeAndData, u32be(crc32(typeAndData)));
}

/** A real, decodable 8-bit RGBA PNG (one filter-type-0 scanline per row, real deflate). */
export function writePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = pngChunk('IHDR', concatBytes(u32be(width), u32be(height), [8, 6, 0, 0, 0]));
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }
  const idat = pngChunk('IDAT', deflateSync(raw));
  const iend = pngChunk('IEND', new Uint8Array(0));
  return concatBytes(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), ihdr, idat, iend);
}

/** A 16x16 PNG, top half opaque red, bottom half half-transparent blue. */
export function buildTransparentPng(): { bytes: Uint8Array; width: number; height: number; rgba: Uint8Array } {
  const width = 16;
  const height = 16;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (y < height / 2) {
        rgba[o] = 255;
        rgba[o + 1] = 0;
        rgba[o + 2] = 0;
        rgba[o + 3] = 255;
      } else {
        rgba[o] = 0;
        rgba[o + 1] = 0;
        rgba[o + 2] = 255;
        rgba[o + 3] = 128;
      }
    }
  }
  return { bytes: writePng(width, height, rgba), width, height, rgba };
}

function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

/** A minimal Exif TIFF structure (CIPA DC-008) with a one-tag Orientation entry, little-endian byte order. */
export function minimalExifOrientation(orientation: number): Uint8Array {
  const ifdOffset = 8;
  const header = concatBytes(ascii('II'), [42, 0], u32le(ifdOffset));
  const entry = concatBytes(u16le(0x0112), u16le(3), u32le(1), u16le(orientation), [0, 0]);
  const ifd = concatBytes(u16le(1), entry, u32le(0));
  return concatBytes(header, ifd);
}

function jpegExifSegment(exifTiffBytes: Uint8Array): Uint8Array {
  const body = concatBytes(ascii('Exif'), [0, 0], exifTiffBytes);
  return concatBytes([0xff, 0xe1], u16be(body.length + 2), body);
}

/** A minimal baseline JPEG (SOI, an optional Exif APP1, SOF0 naming width/height/3 components, DHT, SOS, one scan byte, EOI). */
export function writeJpeg(width: number, height: number, orientation?: number): Uint8Array {
  const segments: Uint8Array[] = [];
  if (orientation !== undefined) segments.push(jpegExifSegment(minimalExifOrientation(orientation)));
  const sof0 = concatBytes(
    [0xff, 0xc0],
    u16be(17),
    [8],
    u16be(height),
    u16be(width),
    [3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1],
  );
  const dht = concatBytes([0xff, 0xc4], u16be(19), [0x00, ...Array(16).fill(0)]);
  const sos = concatBytes([0xff, 0xda], u16be(12), [3, 1, 0, 2, 0, 3, 0, 0, 63, 0]);
  const scanData = Uint8Array.from([0x00]);
  return concatBytes(
    Uint8Array.from([0xff, 0xd8]),
    ...segments,
    sof0,
    dht,
    sos,
    scanData,
    Uint8Array.from([0xff, 0xd9]),
  );
}
