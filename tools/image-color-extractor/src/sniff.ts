/**
 * Header checks for five raster formats -- PNG, JPEG, GIF, WebP and BMP --
 * done entirely from the first bytes of a file, before any real decoding
 * ever runs. This is the file's whole job: refuse an SVG, a non-image, a
 * truncated header, or a header that claims more pixels than this tool
 * will ever decode, and otherwise report the format and pixel dimensions
 * so the caller knows what it is about to hand a real decoder.
 *
 * Byte arrays only, and no browser-only type anywhere, not even in a
 * comment: this folder is copied out and built and tested in plain Node by
 * a release gate with none of those browser-only types available.
 * Reading the picked file into bytes, and deciding what to do with an
 * image once it is sniffed as safe, both live entirely outside this
 * folder, in the web application's own worker.
 */
import meta from './meta.json';

export { meta };

/** Refused above this many bytes, checked from the file's own reported size before a single header byte is read. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Refused above this many pixels (width times height), checked from the header alone, before any decoding. */
export const MAX_PIXELS = 40_000_000;

/** At most this many header bytes are ever read to identify a format and its dimensions. */
export const MAX_HEADER_BYTES = 64 * 1024;

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp';

export interface SniffResult {
  type: ImageFormat;
  width: number;
  height: number;
}

export class ImageColorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageColorError';
  }
}

function need(bytes: Uint8Array, end: number): void {
  if (bytes.length < end) {
    throw new ImageColorError("This file's header is too short to read; it was not opened.");
  }
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function readInt32LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24) | 0;
}

function refuseIfTooManyPixels(width: number, height: number): void {
  if (width <= 0 || height <= 0) {
    throw new ImageColorError('This image reports zero or negative dimensions and was not opened.');
  }
  // width * height can exceed Number.MAX_SAFE_INTEGER only for values far
  // beyond any real header field width here (32 bits at most), so plain
  // multiplication is exact for every value these formats can encode.
  if (width * height > MAX_PIXELS) {
    throw new ImageColorError(
      `This image is ${width} by ${height} pixels (over ${MAX_PIXELS.toLocaleString('en-US')}); it was refused rather than risk freezing the tab.`,
    );
  }
}

/**
 * The PNG signature is the fixed byte sequence W3C's PNG (Third Edition)
 * gives in section 5.2 "PNG signature": "The first eight bytes of a PNG
 * datastream always contain the following (decimal) values: 137 80 78 71
 * 13 10 26 10." The IHDR chunk (section 11.2.2) is required to be the very
 * first chunk, laid out as a 4-byte big-endian length (always 13), the
 * 4-byte chunk type "IHDR" (ASCII 73 72 68 82), then Width and Height as
 * 4-byte big-endian unsigned integers.
 */
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

function sniffPng(bytes: Uint8Array): SniffResult {
  need(bytes, 8 + 8 + 8);
  const chunkType = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunkType !== 'IHDR') {
    throw new ImageColorError('This PNG file does not start with an IHDR chunk; it was not opened.');
  }
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  return { type: 'png', width, height };
}

/**
 * ITU-T T.81 (the JPEG specification) section B.1.1.4 "Marker segments":
 * "A marker segment consists of a marker followed by a sequence of related
 * parameters. The first parameter in a marker segment is the two-byte
 * length parameter. This length parameter encodes the number of bytes in
 * the marker segment, including the length parameter and excluding the
 * two-byte marker." A handful of markers stand alone with no length: TEM
 * (0x01) and the eight restart markers RST0-RST7 (0xD0-0xD7).
 *
 * Section B.2.2 "Frame header syntax" defines every SOFn marker segment
 * (Table B.1's non-differential and differential SOF codes: 0xC0-0xC3,
 * 0xC5-0xC7, 0xC9-0xCB, 0xCD-0xCF -- 0xC4 is DHT, 0xC8 is the reserved JPG
 * marker and 0xCC is DAC, none of which are SOF markers) as: the 2-byte
 * length Lf, then P (1 byte, sample precision), Y (2 bytes, "Number of
 * lines"), X (2 bytes, "Number of samples per line"), Nf and the
 * per-component parameters. Y is this tool's height and X its width; both
 * are big-endian, as every multi-byte JPEG field is.
 */
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const JPEG_STANDALONE_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9]);

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function sniffJpeg(bytes: Uint8Array): SniffResult {
  let i = 2; // past the SOI marker (0xFFD8)
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      throw new ImageColorError('This JPEG file has a malformed marker; it was not opened.');
    }
    // Fill bytes: any number of extra 0xFF bytes may precede a marker.
    let markerOffset = i + 1;
    while (bytes[markerOffset] === 0xff) markerOffset++;
    need(bytes, markerOffset + 1);
    const marker = bytes[markerOffset]!;
    const afterMarker = markerOffset + 1;

    if (JPEG_STANDALONE_MARKERS.has(marker)) {
      if (marker === 0xd9) break; // EOI with no SOF found
      i = afterMarker;
      continue;
    }

    need(bytes, afterMarker + 2);
    const length = readUint16BE(bytes, afterMarker);
    if (length < 2) {
      throw new ImageColorError('This JPEG file has a malformed marker segment; it was not opened.');
    }

    if (JPEG_SOF_MARKERS.has(marker)) {
      need(bytes, afterMarker + 2 + 5);
      const height = readUint16BE(bytes, afterMarker + 2 + 1);
      const width = readUint16BE(bytes, afterMarker + 2 + 3);
      return { type: 'jpeg', width, height };
    }

    if (marker === 0xda) break; // Start of Scan: no SOF marker was found before the entropy-coded data.

    i = afterMarker + length;
  }
  throw new ImageColorError(
    'This JPEG file has no frame header (SOF marker) within the header bytes read; it was not opened.',
  );
}

/**
 * GIF89a's own specification (fetched from w3.org/Graphics/GIF), section
 * 17 "Header": bytes 0-2 are the fixed Signature "GIF", bytes 3-5 the
 * Version ("87a" or "89a"). Section 18 "Logical Screen Descriptor"
 * immediately follows the header with a 2-byte Logical Screen Width and a
 * 2-byte Logical Screen Height. Appendix (Overview) states: "Unless
 * otherwise stated, multi-byte numeric fields are ordered with the Least
 * Significant Byte first" -- so both fields are little-endian.
 */
function isGif(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false;
  const sig = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!);
  if (sig !== 'GIF') return false;
  const version = String.fromCharCode(bytes[3]!, bytes[4]!, bytes[5]!);
  return version === '87a' || version === '89a';
}

function sniffGif(bytes: Uint8Array): SniffResult {
  need(bytes, 10);
  const width = readUint16LE(bytes, 6);
  const height = readUint16LE(bytes, 8);
  return { type: 'gif', width, height };
}

/**
 * RFC 9649 (the WebP container format), section 2.4 (the WebP header):
 * the file begins with the ASCII bytes "RIFF", a 4-byte little-endian
 * whole-file size, then the ASCII bytes "WEBP" -- 12 bytes in all --
 * followed immediately by the first chunk: a 4-byte FourCC and a 4-byte
 * little-endian Chunk Size (section 2.3, the RIFF chunk format).
 *
 * Section 2.5 ('VP8 ' chunk, lossy): the chunk payload is a VP8 bitstream.
 * RFC 6386 (the VP8 bitstream format), the key-frame uncompressed data
 * layout: a 3-byte frame tag, a 3-byte start code (0x9d 0x01 0x2a), then
 * two little-endian 16-bit fields -- "(2 bits Horizontal Scale << 14) |
 * Width (14 bits)" and the same shape for height -- so width and height
 * are each the low 14 bits of a little-endian uint16 at payload offsets 6
 * and 8.
 *
 * Section 2.6 ('VP8L' chunk, lossless), section 3.4 "RIFF Header": after a
 * 1-byte signature 0x2f, "The first 28 bits of the bitstream specify the
 * width and height of the image. Width and height are decoded as 14-bit
 * integers": `image_width = ReadBits(14) + 1; image_height =
 * ReadBits(14) + 1`. VP8L's ReadBits is least-significant-bit-first within
 * each byte, so with payload bytes b0 (signature) then b1..b4: width is
 * `1 + (b1 | ((b2 & 0x3f) << 8))` and height is
 * `1 + (((b2 >> 6) & 0x3) | (b3 << 2) | ((b4 & 0xf) << 10))`.
 *
 * Section 2.7 ('VP8X' chunk, extended): a 4-byte flags-and-reserved word,
 * then a 24-bit little-endian "Canvas Width Minus One" and a 24-bit
 * little-endian "Canvas Height Minus One" ("the actual canvas width is 1 +
 * Canvas Width Minus One").
 */
function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  const webp = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
  return riff === 'RIFF' && webp === 'WEBP';
}

function sniffWebp(bytes: Uint8Array): SniffResult {
  need(bytes, 20);
  const fourCc = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  const payloadStart = 20;

  if (fourCc === 'VP8 ') {
    need(bytes, payloadStart + 10);
    const c0 = bytes[payloadStart + 3]!;
    const c1 = bytes[payloadStart + 4]!;
    const c2 = bytes[payloadStart + 5]!;
    if (c0 !== 0x9d || c1 !== 0x01 || c2 !== 0x2a) {
      throw new ImageColorError('This WebP file has a malformed lossy bitstream header; it was not opened.');
    }
    const width = readUint16LE(bytes, payloadStart + 6) & 0x3fff;
    const height = readUint16LE(bytes, payloadStart + 8) & 0x3fff;
    return { type: 'webp', width, height };
  }

  if (fourCc === 'VP8L') {
    need(bytes, payloadStart + 5);
    if (bytes[payloadStart] !== 0x2f) {
      throw new ImageColorError('This WebP file has a malformed lossless bitstream header; it was not opened.');
    }
    const b1 = bytes[payloadStart + 1]!;
    const b2 = bytes[payloadStart + 2]!;
    const b3 = bytes[payloadStart + 3]!;
    const b4 = bytes[payloadStart + 4]!;
    const width = 1 + (b1 | ((b2 & 0x3f) << 8));
    const height = 1 + (((b2 >> 6) & 0x3) | (b3 << 2) | ((b4 & 0xf) << 10));
    return { type: 'webp', width, height };
  }

  if (fourCc === 'VP8X') {
    need(bytes, payloadStart + 10);
    const width = 1 + readUint24LE(bytes, payloadStart + 4);
    const height = 1 + readUint24LE(bytes, payloadStart + 7);
    return { type: 'webp', width, height };
  }

  throw new ImageColorError('This WebP file does not start with a VP8, VP8L or VP8X chunk; it was not opened.');
}

/**
 * Microsoft's own BITMAPFILEHEADER and BITMAPINFOHEADER documentation
 * (learn.microsoft.com): BITMAPFILEHEADER is 14 bytes -- a 2-byte bfType
 * ("must be 0x4d42 (the ASCII string 'BM')"), a 4-byte bfSize, two 2-byte
 * reserved fields and a 4-byte bfOffBits. It is immediately followed by an
 * info header whose own first 4-byte field, biSize, states its length: 12
 * for the older BITMAPCOREHEADER (whose Width and Height are unsigned
 * 2-byte fields, always bottom-up), or 40 or more for BITMAPINFOHEADER and
 * its later revisions (whose Width and Height are signed 4-byte fields --
 * "If biHeight is positive, the bitmap is a bottom-up DIB... If biHeight
 * is negative, the bitmap is a top-down DIB"). Every multi-byte field is
 * little-endian, Windows' native byte order.
 */
function isBmp(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d; // 'B' 'M'
}

function sniffBmp(bytes: Uint8Array): SniffResult {
  need(bytes, 14 + 4);
  const infoHeaderSize = readUint32LE(bytes, 14);
  if (infoHeaderSize === 12) {
    need(bytes, 14 + 12);
    const width = readUint16LE(bytes, 18);
    const height = readUint16LE(bytes, 20);
    return { type: 'bmp', width, height };
  }
  need(bytes, 14 + 8);
  const width = readInt32LE(bytes, 18);
  const height = readInt32LE(bytes, 22);
  return { type: 'bmp', width, height: Math.abs(height) };
}

/**
 * Reads at most the first `MAX_HEADER_BYTES` of a file and reports its
 * type and pixel dimensions, or refuses it -- always before any real
 * decoding runs. `fileSizeBytes` (the file's own reported size, not the
 * length of `headerBytes`) is checked against `MAX_FILE_BYTES` first, so a
 * huge file is refused without ever reading it into memory; a header
 * whose claimed dimensions multiply past `MAX_PIXELS` is refused next,
 * before any pixel is decoded.
 */
export function sniffImage(headerBytes: Uint8Array, fileSizeBytes: number = headerBytes.length): SniffResult {
  if (fileSizeBytes > MAX_FILE_BYTES) {
    throw new ImageColorError(
      `This file is ${fileSizeBytes.toLocaleString('en-US')} bytes (over ${MAX_FILE_BYTES.toLocaleString('en-US')}); it was refused rather than risk freezing the tab.`,
    );
  }

  let result: SniffResult;
  if (isPng(headerBytes)) result = sniffPng(headerBytes);
  else if (isJpeg(headerBytes)) result = sniffJpeg(headerBytes);
  else if (isGif(headerBytes)) result = sniffGif(headerBytes);
  else if (isWebp(headerBytes)) result = sniffWebp(headerBytes);
  else if (isBmp(headerBytes)) result = sniffBmp(headerBytes);
  else {
    throw new ImageColorError('This file is not a PNG, JPEG, GIF, WebP or BMP image, so it was not opened.');
  }

  refuseIfTooManyPixels(result.width, result.height);
  return result;
}
