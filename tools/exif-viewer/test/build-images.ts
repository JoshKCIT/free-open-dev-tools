/**
 * Test-only fixture builders: hand-written JPEG, PNG and WebP files carrying
 * every segment or chunk kind this package's own behaviour is defined
 * against, built directly from the specifications `src/*.ts` cite in their
 * own header comments (ITU-T T.81, CIPA DC-008, the Adobe XMP
 * Specification Part 3, IPTC IIM 4.2, ICC.1, W3C PNG Third Edition,
 * RFC 9649) -- never imported from `e2e/fixture-files.ts`, since a tool
 * folder must install, build and test entirely on its own outside this
 * workspace (`scripts/check-standalone.mjs`).
 */
import { deflateSync } from 'node:zlib';

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}
function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}
function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}
export function concatBytes(...parts: (number[] | Uint8Array)[]): Uint8Array {
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
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// --------------------------------------------------------------------------
// A minimal Exif/TIFF block: IFD0 with ImageDescription, an optional
// Orientation tag, and an optional GPS IFD (CIPA DC-008 sections 4.6.2,
// 4.6.4 and 4.6.6).
// --------------------------------------------------------------------------

export interface ExifTiffOptions {
  description?: string;
  orientation?: number;
  /** When set, IFD0 gains an ExifIFD pointer (tag 0x8769) to a one-tag Exif SubIFD holding ColorSpace (0xA001). */
  exifColorSpace?: number;
  gps?: {
    latitudeDeg: number;
    latitudeMin: number;
    latitudeSec: number;
    longitudeDeg: number;
    longitudeMin: number;
    longitudeSec: number;
  };
}

function asciiEntry(tag: number, text: string, overflow: { offset: number; parts: Uint8Array[] }): Uint8Array {
  const bytes = Uint8Array.from([...ascii(text), 0]);
  const padded = bytes.length % 2 === 0 ? bytes : concatBytes(bytes, [0]);
  if (padded.length <= 4) {
    return concatBytes(
      u16le(tag),
      u16le(2),
      u32le(padded.length),
      concatBytes(padded, new Uint8Array(4 - padded.length)),
    );
  }
  const off = overflow.offset;
  overflow.parts.push(padded);
  overflow.offset += padded.length;
  return concatBytes(u16le(tag), u16le(2), u32le(padded.length), u32le(off));
}
function shortEntry(tag: number, value: number): Uint8Array {
  return concatBytes(u16le(tag), u16le(3), u32le(1), u16le(value), [0, 0]);
}
function longEntry(tag: number, value: number): Uint8Array {
  return concatBytes(u16le(tag), u16le(4), u32le(1), u32le(value));
}
function rational(n: number, d: number): Uint8Array {
  return concatBytes(u32le(n), u32le(d));
}
function rationalEntry(tag: number, value: Uint8Array, overflow: { offset: number; parts: Uint8Array[] }): Uint8Array {
  const off = overflow.offset;
  overflow.parts.push(value);
  overflow.offset += value.length;
  return concatBytes(u16le(tag), u16le(5), u32le(value.length / 8), u32le(off));
}

/**
 * Builds a little-endian TIFF/Exif block: IFD0 (ImageDescription, optional
 * Orientation), an optional one-tag Exif SubIFD (ColorSpace) reached
 * through IFD0's own ExifIFD pointer, and an optional GPS IFD reached
 * through IFD0's own GPSInfo pointer.
 */
export function minimalExifTiff(options: ExifTiffOptions): Uint8Array {
  const entries: ((overflow: { offset: number; parts: Uint8Array[] }) => Uint8Array)[] = [];
  if (options.description !== undefined) {
    const text = options.description;
    entries.push((overflow) => asciiEntry(0x010e, text, overflow));
  }
  if (options.orientation !== undefined) {
    const o = options.orientation;
    entries.push(() => shortEntry(0x0112, o));
  }
  const hasExif = options.exifColorSpace !== undefined;
  const hasGps = options.gps !== undefined;
  const numEntries = entries.length + (hasExif ? 1 : 0) + (hasGps ? 1 : 0);
  const ifd0Start = 8;
  const ifd0EntriesStart = ifd0Start + 2;
  const ifd0OverflowStart = ifd0EntriesStart + numEntries * 12 + 4;

  const overflow = { offset: ifd0OverflowStart, parts: [] as Uint8Array[] };
  const entryBytes = entries.map((build) => build(overflow));

  const EXIF_SUB_IFD_SIZE = 2 + 12 + 4; // count + one entry + next-IFD offset
  const exifIfdOffset = overflow.offset;
  if (hasExif) {
    entryBytes.push(longEntry(0x8769, exifIfdOffset));
  }

  const gpsIfdOffset = exifIfdOffset + (hasExif ? EXIF_SUB_IFD_SIZE : 0);
  let gpsBytes: Uint8Array = new Uint8Array(0);
  if (hasGps) {
    entryBytes.push(longEntry(0x8825, gpsIfdOffset));
  }
  // Sort entries by tag, as TIFF 6.0 requires (ascending tag order within an IFD).
  const taggedEntries = entryBytes
    .map((e) => ({ tag: (e[0]! | (e[1]! << 8)) as number, bytes: e }))
    .sort((a, b) => a.tag - b.tag)
    .map((e) => e.bytes);

  const ifd0 = concatBytes(u16le(numEntries), ...taggedEntries, u32le(0));

  const exifSubIfd: Uint8Array = hasExif
    ? concatBytes(u16le(1), shortEntry(0xa001, options.exifColorSpace!), u32le(0))
    : new Uint8Array(0);

  if (hasGps) {
    const g = options.gps!;
    const gpsOverflow = { offset: gpsIfdOffset + 2 + 4 * 12 + 4, parts: [] as Uint8Array[] };
    const latRef = asciiEntry(1, g.latitudeDeg >= 0 ? 'N' : 'S', gpsOverflow);
    const latVal = concatBytes(
      rational(Math.abs(g.latitudeDeg), 1),
      rational(g.latitudeMin, 1),
      rational(g.latitudeSec * 100, 100),
    );
    const latEntry = rationalEntry(2, latVal, gpsOverflow);
    const lonRef = asciiEntry(3, g.longitudeDeg >= 0 ? 'E' : 'W', gpsOverflow);
    const lonVal = concatBytes(
      rational(Math.abs(g.longitudeDeg), 1),
      rational(g.longitudeMin, 1),
      rational(g.longitudeSec * 100, 100),
    );
    const lonEntry = rationalEntry(4, lonVal, gpsOverflow);
    const gpsEntries = [latRef, latEntry, lonRef, lonEntry];
    gpsBytes = concatBytes(u16le(gpsEntries.length), ...gpsEntries, u32le(0), ...gpsOverflow.parts);
  }

  const header = concatBytes(ascii('II'), [42, 0], u32le(ifd0Start));
  return concatBytes(header, ifd0, ...overflow.parts, exifSubIfd, gpsBytes);
}

// --------------------------------------------------------------------------
// JPEG (ITU-T T.81)
// --------------------------------------------------------------------------

export function jpegJfifSegment(): Uint8Array {
  const body = concatBytes(ascii('JFIF\0'), [1, 2, 0, 1, 1, 0, 0, 0, 0]);
  return concatBytes([0xff, 0xe0], u16be(body.length + 2), body);
}
export function jpegExifSegment(tiffBytes: Uint8Array): Uint8Array {
  const body = concatBytes(ascii('Exif'), [0, 0], tiffBytes);
  return concatBytes([0xff, 0xe1], u16be(body.length + 2), body);
}
export function jpegXmpSegment(xml: string): Uint8Array {
  const body = concatBytes(ascii('http://ns.adobe.com/xap/1.0/\0'), ascii(xml));
  return concatBytes([0xff, 0xe1], u16be(body.length + 2), body);
}
export function jpegIptcSegment(caption: string): Uint8Array {
  const captionBytes = ascii(caption);
  const iptcRecord = concatBytes([0x1c, 2, 120], u16be(captionBytes.length), captionBytes);
  const padded = iptcRecord.length % 2 === 0 ? iptcRecord : concatBytes(iptcRecord, [0]);
  const irb = concatBytes(ascii('8BIM'), u16be(0x0404), [0, 0], u32be(iptcRecord.length), padded);
  const body = concatBytes(ascii('Photoshop 3.0\0'), irb);
  return concatBytes([0xff, 0xed], u16be(body.length + 2), body);
}
export function jpegIccSegment(profileBytes: Uint8Array): Uint8Array {
  const body = concatBytes(ascii('ICC_PROFILE\0'), [1, 1], profileBytes);
  return concatBytes([0xff, 0xe2], u16be(body.length + 2), body);
}
export function jpegAdobeSegment(): Uint8Array {
  // Adobe's own DCT filters documentation: "Adobe\0" followed by a version,
  // flags0, flags1 and a transform byte (0 = unknown/RGB).
  const body = concatBytes(ascii('Adobe\0'), [0, 100], [0, 0], [0, 0], [0]);
  return concatBytes([0xff, 0xee], u16be(body.length + 2), body);
}
export function jpegCommentSegment(comment: string): Uint8Array {
  const body = ascii(comment);
  return concatBytes([0xff, 0xfe], u16be(body.length + 2), body);
}
export function jpegDqtSegment(): Uint8Array {
  // One 8-bit-precision luminance quantisation table, table id 0. Values
  // are not realistic frequencies -- this fixture is read structurally, not
  // decoded to pixels -- only that they are present and well-formed matters.
  const table = Array.from({ length: 64 }, (_, i) => (i % 63) + 1);
  const body = concatBytes([0x00], table);
  return concatBytes([0xff, 0xdb], u16be(body.length + 2), body);
}
export function jpegOtherAppSegment(n: number, text: string): Uint8Array {
  const body = ascii(text);
  return concatBytes([0xff, 0xe0 + n], u16be(body.length + 2), body);
}

/**
 * A base baseline JPEG: SOI, `segments` (already including their own marker
 * and length bytes), then DQT, a minimal one-component SOF0, DHT, SOS and
 * scan data, then EOI. `trailingBytes`, when given, are appended after EOI
 * (data a camera or editor sometimes leaves there -- a thumbnail, a
 * motion-photo video -- which this tool always removes and reports).
 */
export function writeJpeg(
  width: number,
  height: number,
  segments: Uint8Array[] = [],
  trailingBytes?: Uint8Array,
  scanData: Uint8Array = Uint8Array.from([0x00]),
): Uint8Array {
  const dqt = jpegDqtSegment();
  const sof0 = concatBytes([0xff, 0xc0], u16be(11), [8], u16be(height), u16be(width), [1, 1, 0x11, 0]);
  const dht = concatBytes([0xff, 0xc4], u16be(19), [0x00, ...Array(16).fill(0)]);
  const sos = concatBytes([0xff, 0xda], u16be(8), [1, 1, 0, 0, 63, 0]);
  return concatBytes(
    Uint8Array.from([0xff, 0xd8]),
    ...segments,
    dqt,
    sof0,
    dht,
    sos,
    scanData,
    Uint8Array.from([0xff, 0xd9]),
    trailingBytes ?? new Uint8Array(0),
  );
}

/**
 * Scan data containing a real 0xFF byte (encoded with the mandatory 0x00
 * stuffing byte immediately after it, ITU-T T.81 section B.1.1.5) and a
 * restart marker (RST0) -- both of which are scan data, not segment
 * boundaries, and must be copied through exactly once, never duplicated or
 * dropped.
 */
export const SCAN_DATA_WITH_STUFFING = Uint8Array.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);

/** A baseline JPEG whose first APP1 segment declares a length that runs past the end of the file. */
export function writeMalformedJpegTruncatedSegment(): Uint8Array {
  const soi = Uint8Array.from([0xff, 0xd8]);
  // marker + a length field claiming 500 bytes of data, but the file ends immediately.
  const badSegment = concatBytes([0xff, 0xe1], u16be(500), ascii('short'));
  return concatBytes(soi, badSegment);
}

// --------------------------------------------------------------------------
// PNG (W3C PNG Third Edition)
// --------------------------------------------------------------------------

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = concatBytes(ascii(type), data);
  return concatBytes(u32be(data.length), typeAndData, u32be(crc32(typeAndData)));
}

export function pngTextChunk(keyword: string, text: string): Uint8Array {
  return pngChunk('tEXt', concatBytes(ascii(keyword), [0], ascii(text)));
}
export function pngZtxtChunk(keyword: string, text: string): Uint8Array {
  return pngChunk('zTXt', concatBytes(ascii(keyword), [0, 0], deflateSync(Buffer.from(text, 'latin1'))));
}
export function pngItxtXmpChunk(xml: string): Uint8Array {
  // W3C PNG Third Edition section 11.3.4.4 "iTXt International textual
  // data": keyword, null, compression flag, compression method, language
  // tag, null, translated keyword, null, then the text. Adobe's own XMP
  // Specification Part 3 names the fixed keyword "XML:com.adobe.xmp" for
  // embedding an XMP packet this way.
  const body = concatBytes(ascii('XML:com.adobe.xmp'), [0, 0, 0], [0], [0], ascii(xml));
  return pngChunk('iTXt', body);
}
export function pngExifChunk(tiffBytes: Uint8Array): Uint8Array {
  return pngChunk('eXIf', tiffBytes);
}
export function pngTimeChunk(): Uint8Array {
  // W3C PNG Third Edition section 11.3.5.3 "tIME": year(2, BE), month, day, hour, minute, second.
  return pngChunk('tIME', Uint8Array.from([...u16be(2024), 6, 15, 12, 0, 0]));
}
export function pngIccpChunk(profileName: string, profileBytes: Uint8Array): Uint8Array {
  // W3C PNG Third Edition section 11.3.3.3 "iCCP": profile name, null,
  // compression method (0 = zlib/deflate), compressed profile.
  const body = concatBytes(ascii(profileName), [0, 0], deflateSync(Buffer.from(profileBytes)));
  return pngChunk('iCCP', body);
}
export function pngGamaChunk(): Uint8Array {
  return pngChunk('gAMA', Uint8Array.from(u32be(45455)));
}
export function pngPhysChunk(): Uint8Array {
  return pngChunk('pHYs', Uint8Array.from([...u32be(2835), ...u32be(2835), 1]));
}
export function pngSrgbChunk(): Uint8Array {
  return pngChunk('sRGB', Uint8Array.from([0]));
}
export function pngChrmChunk(): Uint8Array {
  return pngChunk(
    'cHRM',
    Uint8Array.from([
      ...u32be(31270),
      ...u32be(32900),
      ...u32be(64000),
      ...u32be(33000),
      ...u32be(30000),
      ...u32be(60000),
      ...u32be(15000),
      ...u32be(6000),
    ]),
  );
}
export function pngTrnsChunk(): Uint8Array {
  return pngChunk('tRNS', Uint8Array.from([255]));
}
/** A chunk type this tool does not recognise, with an uppercase first letter -- a critical chunk it must refuse. */
export function pngUnknownCriticalChunk(): Uint8Array {
  return pngChunk('XqXq', Uint8Array.from([1, 2, 3, 4]));
}

/** A minimal, real, decodable RGBA PNG. `extraChunks` are inserted between IHDR and IDAT. */
export function writePng(width: number, height: number, extraChunks: Uint8Array[] = []): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 3] = 255;
  }
  const ihdr = pngChunk('IHDR', concatBytes(u32be(width), u32be(height), [8, 6, 0, 0, 0]));
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }
  const idat = pngChunk('IDAT', deflateSync(raw));
  const iend = pngChunk('IEND', new Uint8Array(0));
  return concatBytes(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), ihdr, ...extraChunks, idat, iend);
}

/** A PNG whose second chunk (right after IHDR) has a CRC that does not match its own type+data bytes. */
export function writeMalformedPngBadCrc(): Uint8Array {
  const good = writePng(4, 4, [pngTextChunk('Comment', 'hello')]);
  const bad = Uint8Array.from(good);
  // Corrupt one byte inside the tEXt chunk's own CRC field (the four bytes
  // right after its data), leaving its length/type/data untouched.
  const ihdrChunkLength = 4 + 4 + 13 + 4; // length + type + IHDR data + crc
  const sigLength = 8;
  const textLenOffset = sigLength + ihdrChunkLength;
  const textDataLength = 4 + 8; // "Comment\0" + "hello"
  const crcOffset = textLenOffset + 4 + 4 + textDataLength;
  bad[crcOffset] = bad[crcOffset]! ^ 0xff;
  return bad;
}

// --------------------------------------------------------------------------
// WebP (RFC 9649)
// --------------------------------------------------------------------------

function webpChunk(fourCc: string, data: Uint8Array): Uint8Array {
  const padding = data.length % 2 === 0 ? [] : [0];
  return concatBytes(ascii(fourCc), u32le(data.length), data, padding);
}

/** A minimal, valid VP8L (lossless) bitstream for the given canvas size, RFC 9649 section 2.6. */
function vp8lPayload(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  const b1 = w & 0xff;
  const b2 = ((w >> 8) & 0x3f) | ((h & 0x3) << 6);
  const b3 = (h >> 2) & 0xff;
  const b4 = (h >> 10) & 0xf;
  return Uint8Array.from([0x2f, b1, b2, b3, b4, 0, 0, 0]);
}

/** A simple (non-extended) lossless WebP: no VP8X, so it has nowhere to carry any metadata. */
export function writeSimpleWebp(width: number, height: number): Uint8Array {
  const vp8l = webpChunk('VP8L', vp8lPayload(width, height));
  const payload = concatBytes(ascii('WEBP'), vp8l);
  return concatBytes(ascii('RIFF'), u32le(payload.length), payload);
}

export interface WebpMetadataChunks {
  iccp?: Uint8Array;
  exif?: Uint8Array;
  xmp?: Uint8Array;
}

/** A VP8X (extended) WebP with whichever of `chunks.iccp`, `chunks.exif` and `chunks.xmp` are given. */
export function writeVp8xWebp(width: number, height: number, chunks: WebpMetadataChunks): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  const flags = (chunks.iccp ? 0x20 : 0) | (chunks.exif ? 0x08 : 0) | (chunks.xmp ? 0x04 : 0);
  const vp8xPayload = concatBytes([flags, 0, 0, 0], u32le(w).slice(0, 3), u32le(h).slice(0, 3));
  const vp8x = webpChunk('VP8X', vp8xPayload);
  const vp8l = webpChunk('VP8L', vp8lPayload(width, height));

  // RFC 9649 section 2.5's own chunk order: VP8X, then ICCP (colour
  // profile), then the image data, then EXIF, then XMP.
  const parts: Uint8Array[] = [vp8x];
  if (chunks.iccp) parts.push(webpChunk('ICCP', chunks.iccp));
  parts.push(vp8l);
  if (chunks.exif) parts.push(webpChunk('EXIF', chunks.exif));
  if (chunks.xmp) parts.push(webpChunk('XMP ', chunks.xmp));

  const payload = concatBytes(ascii('WEBP'), ...parts);
  return concatBytes(ascii('RIFF'), u32le(payload.length), payload);
}

/** A minimal, plausible ICC v2 profile: a 128-byte header (ICC.1) plus a zero-entry tag table. */
export function minimalIccProfile(): Uint8Array {
  const buf = new Uint8Array(128 + 4);
  const view = new DataView(buf.buffer);
  view.setUint32(0, buf.length);
  buf.set(ascii('appl'), 4);
  view.setUint32(8, 0x02100000);
  buf.set(ascii('mntr'), 12);
  buf.set(ascii('RGB '), 16);
  buf.set(ascii('XYZ '), 20);
  buf.set(ascii('acsp'), 36);
  view.setUint32(128, 0);
  return buf;
}
