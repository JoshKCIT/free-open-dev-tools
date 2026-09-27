/**
 * Builders for real files this project's browser suite attaches to a file
 * input, each carrying a caller-supplied marker string somewhere a real
 * viewer of that format would actually read it (a PDF's own text content
 * and document title, an image's own metadata segment, an archive entry's
 * own name or content). Every builder here is written from the same
 * specifications this repository's tool packages already cite, never
 * imported from a tool package: e2e code does not import tool test code,
 * so a PDF here is built again from ISO 32000-1's own object/xref/trailer
 * grammar rather than reusing `tools/pdf-to-image/test/minimal-pdf.ts`.
 *
 * The base JPEG and WebP pixel data here are hand-constructed minimal,
 * valid bitstreams (a flat single colour) rather than produced by a real
 * browser encoder: sufficient for every phase 9 header check and content
 * round trip this phase's own fixtures need, and simpler to keep
 * deterministic across the whole file-tools proof than embedding a
 * browser-encoded constant would be.
 */
import { deflateRawSync, deflateSync, gzipSync } from 'node:zlib';

export type FixtureFileKind =
  | 'pdf'
  | 'pdf-3'
  | 'pdf-long'
  | 'png'
  | 'png-large'
  | 'jpeg'
  | 'webp'
  | 'gif'
  | 'bmp'
  | 'zip'
  | 'tar'
  | 'tar.gz'
  | 'gz'
  | 'text';

export const FIXTURE_FILE_KINDS: FixtureFileKind[] = [
  'pdf',
  'pdf-3',
  'pdf-long',
  'png',
  'png-large',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'zip',
  'tar',
  'tar.gz',
  'gz',
  'text',
];

export interface FixtureFile {
  name: string;
  mimeType: string;
  buffer: Uint8Array;
}

/**
 * ISO 3309's cyclic redundancy check, the same CRC-32 the PNG and ZIP
 * specifications both use (reflected, IEEE 802.3 polynomial 0xEDB88320).
 * A later plan's PNG and ZIP writers both need this; it lives here rather
 * than per-writer since both consume the exact same table and algorithm.
 */
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

function escapePdfString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export interface PdfPageSpec {
  /** Text drawn in Times-Roman, near the top of a US Letter page. */
  text?: string;
}

/**
 * A small, valid, multi-page PDF built directly from ISO 32000-1:2008
 * sections 7.3 "Objects", 7.5.2 "File Header", 7.5.4 "Cross-Reference
 * Table" and 7.5.5 "File Trailer": one Catalog, one Pages tree, one Page
 * object and one content stream per entry in `pages`, one shared
 * Times-Roman font resource, and a Document Information dictionary
 * carrying `marker` as its Title. Every cross-reference entry is exactly
 * 20 bytes, offsets measured as each object is appended, matching the
 * specification's own fixed entry format.
 */
export function writePdf(pages: PdfPageSpec[], marker: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [0];

  const push = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    chunks.push(bytes);
    length += bytes.length;
  };
  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const beginObject = (num: number) => {
    offsets[num] = length;
    push(`${num} 0 obj\n`);
  };
  const endObject = () => push('endobj\n');

  push('%PDF-1.7\n');
  pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const catalogNum = 1;
  const pagesNum = 2;
  const infoNum = 3;
  const fontNum = 4;
  let nextObjNum = 5;
  const pageNums: number[] = [];
  const contentNums: number[] = [];
  for (const _p of pages) {
    pageNums.push(nextObjNum++);
    contentNums.push(nextObjNum++);
  }

  beginObject(catalogNum);
  push(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>\n`);
  endObject();

  beginObject(pagesNum);
  push(`<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>\n`);
  endObject();

  beginObject(infoNum);
  push(`<< /Title (${escapePdfString(marker)}) >>\n`);
  endObject();

  beginObject(fontNum);
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>\n');
  endObject();

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const pageNum = pageNums[i]!;
    const contentNum = contentNums[i]!;
    const lineOne = page.text ?? '';
    const content = `BT /F1 18 Tf 72 700 Td (${escapePdfString(lineOne)}) Tj ET\nBT /F1 12 Tf 72 60 Td (${escapePdfString(marker)}) Tj ET\n`;

    beginObject(pageNum);
    push(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentNum} 0 R >>\n`,
    );
    endObject();

    const contentBytes = new TextEncoder().encode(content);
    beginObject(contentNum);
    push(`<< /Length ${contentBytes.length} >>\nstream\n`);
    pushBytes(contentBytes);
    push('\nendstream\n');
    endObject();
  }

  const size = nextObjNum;
  const xrefOffset = length;
  push(`xref\n0 ${size}\n`);
  push('0000000000 65535 f\r\n');
  for (let i = 1; i < size; i++) {
    push(`${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n\r\n`);
  }
  push('trailer\n');
  push(`<< /Size ${size} /Root ${catalogNum} 0 R /Info ${infoNum} 0 R >>\n`);
  push(`startxref\n${xrefOffset}\n%%EOF`);

  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}
function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
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

/**
 * A PNG chunk: 4-byte big-endian length, the 4-byte type, the data, then a
 * CRC-32 (W3C PNG Third Edition section 5.3) over the type and data bytes
 * together (never the length).
 */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = concatBytes(ascii(type), data);
  return concatBytes(u32be(data.length), typeAndData, u32be(crc32(typeAndData)));
}

/**
 * A minimal, real, decodable PNG: an 8-bit RGBA IHDR, one IDAT built by
 * deflating one filter-type-0 scanline per row (`node:zlib`'s own deflate,
 * the same compressed-data format PNG itself uses), and IEND. `extraChunks`
 * are inserted between IHDR and IDAT (an ancillary chunk such as `tEXt` or
 * `eXIf` is valid anywhere before IDAT).
 */
export function writePng(width: number, height: number, rgba: Uint8Array, extraChunks: Uint8Array[] = []): Uint8Array {
  const ihdr = pngChunk('IHDR', concatBytes(u32be(width), u32be(height), [8, 6, 0, 0, 0]));
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter type 0 (none)
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }
  const idat = pngChunk('IDAT', deflateSync(raw));
  const iend = pngChunk('IEND', new Uint8Array(0));
  return concatBytes(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), ihdr, ...extraChunks, idat, iend);
}

/** A `tEXt` chunk (PNG Third Edition section 11.3.4.3): a Latin-1 keyword, a NUL, then the text. */
export function pngTextChunk(keyword: string, text: string): Uint8Array {
  return pngChunk('tEXt', concatBytes(ascii(keyword), [0], ascii(text)));
}

/** An `eXIf` chunk (PNG Third Edition section 11.3.4.1, added in the 2003 Third Edition): raw Exif TIFF data. */
export function pngExifChunk(exifTiffBytes: Uint8Array): Uint8Array {
  return pngChunk('eXIf', exifTiffBytes);
}

/**
 * A minimal Exif TIFF structure (CIPA DC-008, the Exif specification) with
 * one ASCII `ImageDescription` (tag 0x010E) tag -- enough for a metadata
 * reader to find `marker` in a real Exif block, little-endian byte order.
 */
export function minimalExifTiff(description: string): Uint8Array {
  const value = `${description}\0`;
  const valuePadded = value.length % 2 === 0 ? value : `${value}\0`;
  const ifdOffset = 8;
  const valueOffset = ifdOffset + 2 + 12 + 4;
  const header = concatBytes(ascii('II'), [42, 0], u32le2(ifdOffset));
  const entry = concatBytes(
    u16le2(0x010e), // ImageDescription
    u16le2(2), // type: ASCII
    u32le2(valuePadded.length),
    valuePadded.length > 4
      ? u32le2(valueOffset)
      : concatBytes(ascii(valuePadded), new Uint8Array(4 - valuePadded.length)),
  );
  const ifd = concatBytes(u16le2(1), entry, u32le2(0));
  const tail = valuePadded.length > 4 ? ascii(valuePadded) : [];
  return concatBytes(header, ifd, tail);
}
function u16le2(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32le2(n: number): number[] {
  return u32le(n);
}

/**
 * A base baseline JPEG (SOI, APPn segments, a minimal SOF0/DHT/SOS/scan,
 * EOI). `segments` are raw marker segments (already including their own
 * marker bytes and length) inserted right after SOI -- an APP1 Exif or XMP
 * block, an APP13 Photoshop IRB, an APP2 ICC profile, or a COM comment.
 */
export function writeJpeg(width: number, height: number, segments: Uint8Array[] = []): Uint8Array {
  const sof0 = concatBytes([0xff, 0xc0], u16be(11), [8], u16be(height), u16be(width), [1, 1, 0x11, 0]);
  // A minimal one-component Huffman table and scan: valid enough for a
  // header-only reader (this project's own sniffFile) and for a real
  // decoder to at least parse past SOS without erroring on structure.
  const dht = concatBytes([0xff, 0xc4], u16be(19), [0x00, ...Array(16).fill(0)]);
  const sos = concatBytes([0xff, 0xda], u16be(8), [1, 1, 0, 0, 63, 0]);
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

/** An APP1 Exif segment (CIPA DC-008): marker, length, the fixed "Exif\0\0" identifier, then TIFF data. */
export function jpegExifSegment(exifTiffBytes: Uint8Array): Uint8Array {
  const body = concatBytes(ascii('Exif'), [0, 0], exifTiffBytes);
  return concatBytes([0xff, 0xe1], u16be(body.length + 2), body);
}

/** An APP1 XMP packet (Adobe XMP Specification Part 3, JPEG embedding): the fixed namespace URI, then the packet text. */
export function jpegXmpSegment(xmpXml: string): Uint8Array {
  const body = concatBytes(ascii('http://ns.adobe.com/xap/1.0/\0'), ascii(xmpXml));
  return concatBytes([0xff, 0xe1], u16be(body.length + 2), body);
}

/** An APP13 Photoshop IRB carrying one IPTC IIM 2:120 (Caption) record. */
export function jpegIptcSegment(caption: string): Uint8Array {
  const captionBytes = ascii(caption);
  const iptcRecord = concatBytes([0x1c, 2, 120], u16be(captionBytes.length), captionBytes);
  const irb = concatBytes(
    ascii('8BIM'),
    u16be(0x0404), // IPTC-NAA resource ID
    [0, 0], // pascal name (empty, padded)
    u32be(iptcRecord.length % 2 === 0 ? iptcRecord.length : iptcRecord.length + 1),
    iptcRecord,
    iptcRecord.length % 2 === 0 ? [] : [0],
  );
  const body = concatBytes(ascii('Photoshop 3.0\0'), irb);
  return concatBytes([0xff, 0xed], u16be(body.length + 2), body);
}

/** An APP2 ICC_PROFILE segment (ICC.1): the fixed identifier, sequence markers, then profile bytes. */
export function jpegIccSegment(profileBytes: Uint8Array): Uint8Array {
  const body = concatBytes(ascii('ICC_PROFILE\0'), [1, 1], profileBytes);
  return concatBytes([0xff, 0xe2], u16be(body.length + 2), body);
}

/** A COM (comment) segment. */
export function jpegCommentSegment(comment: string): Uint8Array {
  const body = ascii(comment);
  return concatBytes([0xff, 0xfe], u16be(body.length + 2), body);
}

/**
 * A minimal, valid VP8X WebP container (RFC 9649 sections 2.4 and 2.7) with
 * a tiny VP8L bitstream as the image data, plus whichever of `iccp`, `exif`
 * and `xmp` chunk payloads are given.
 */
export function writeWebp(
  width: number,
  height: number,
  chunks: { iccp?: Uint8Array; exif?: Uint8Array; xmp?: Uint8Array },
): Uint8Array {
  // A trivial 1x1 VP8L bitstream: signature 0x2f, 14-bit width-1/height-1,
  // then enough bits to form a valid (if minimal) lossless image per
  // RFC 9649 section 3 -- sufficient for this project's own header sniffer,
  // which only reads the fixed-position width/height fields.
  const w = width - 1;
  const h = height - 1;
  const b1 = w & 0xff;
  const b2 = ((w >> 8) & 0x3f) | ((h & 0x3) << 6);
  const b3 = (h >> 2) & 0xff;
  const b4 = (h >> 10) & 0xf;
  const vp8lPayload = Uint8Array.from([0x2f, b1, b2, b3, b4, 0, 0, 0]);
  const vp8lChunk = concatBytes(
    ascii('VP8L'),
    u32le(vp8lPayload.length),
    vp8lPayload,
    vp8lPayload.length % 2 ? [0] : [],
  );

  const flags = (chunks.iccp ? 0x20 : 0) | (chunks.exif ? 0x08 : 0) | (chunks.xmp ? 0x04 : 0);
  const vp8xPayload = concatBytes([flags, 0, 0, 0], u32le(w).slice(0, 3), u32le(h).slice(0, 3));
  const vp8xChunk = concatBytes(ascii('VP8X'), u32le(vp8xPayload.length), vp8xPayload);

  const optional: Uint8Array[] = [];
  if (chunks.iccp)
    optional.push(
      concatBytes(ascii('ICCP'), u32le(chunks.iccp.length), chunks.iccp, chunks.iccp.length % 2 ? [0] : []),
    );
  if (chunks.exif)
    optional.push(
      concatBytes(ascii('EXIF'), u32le(chunks.exif.length), chunks.exif, chunks.exif.length % 2 ? [0] : []),
    );
  if (chunks.xmp)
    optional.push(concatBytes(ascii('XMP '), u32le(chunks.xmp.length), chunks.xmp, chunks.xmp.length % 2 ? [0] : []));

  const payload = concatBytes(ascii('WEBP'), vp8xChunk, ...optional, vp8lChunk);
  return concatBytes(ascii('RIFF'), u32le(payload.length), payload);
}

/** A minimal 4x4, 24-bit, bottom-up BMP (Microsoft's own BITMAPFILEHEADER/BITMAPINFOHEADER documentation). */
export function writeBmp(width: number, height: number): Uint8Array {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const pixelData = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * rowBytes + x * 3;
      pixelData[o] = 0; // B
      pixelData[o + 1] = 0; // G
      pixelData[o + 2] = 255; // R
    }
  }
  const offBits = 54;
  const fileSize = offBits + pixelData.length;
  const header = concatBytes(
    ascii('BM'),
    u32le(fileSize),
    [0, 0, 0, 0],
    u32le(offBits),
    u32le(40),
    u32le(width),
    u32le(height),
    [1, 0, 24, 0],
    u32le(0),
    u32le(pixelData.length),
    u32le(2835),
    u32le(2835),
    u32le(0),
    u32le(0),
  );
  return concatBytes(header, pixelData);
}

/** A hand-written GIF89a image (GIF89a specification): one comment extension carrying `marker`, one 2x2 image with a trivial LZW-coded data block. */
export function writeGif(marker: string): Uint8Array {
  const header = concatBytes(ascii('GIF89a'), [2, 0, 2, 0, 0xf0 | 0, 0, 0]);
  const globalPalette = Uint8Array.from([0, 0, 0, 255, 0, 0]); // 2-colour table
  const commentExt = concatBytes([0x21, 0xfe], [marker.length], ascii(marker), [0]);
  // A trivial LZW data stream: minimum code size 2, one sub-block encoding
  // four pixels all colour index 0 (clear code, four literal 0s, end code).
  const imageDescriptor = concatBytes([0x2c], u16leGif(0), u16leGif(0), u16leGif(2), u16leGif(2), [0]);
  const lzwMinCodeSize = 2;
  const subBlock = Uint8Array.from([0x04, 0x51, 0x00]);
  const imageData = concatBytes([lzwMinCodeSize], [subBlock.length], subBlock, [0]);
  const trailer = Uint8Array.from([0x3b]);
  return concatBytes(header, globalPalette, commentExt, imageDescriptor, imageData, trailer);
}
function u16leGif(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

export interface ZipEntrySpec {
  name: string;
  content: Uint8Array;
  /** 0 = stored, 8 = deflated. Default stored. */
  method?: 0 | 8;
}

/** A minimal ZIP archive (PKWARE APPNOTE.TXT): local file headers plus data, then the central directory and EOCD. */
export function writeZip(entries: ZipEntrySpec[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 0;
    const data = method === 8 ? deflateRawSync(entry.content) : entry.content;
    const crc = crc32(entry.content);
    const nameBytes = ascii(entry.name);
    const localHeader = concatBytes(
      [0x50, 0x4b, 0x03, 0x04],
      u16leGif(20), // version needed
      u16leGif(0), // flags
      u16leGif(method),
      u16leGif(0), // mod time
      u16leGif(0), // mod date
      u32le(crc),
      u32le(data.length),
      u32le(entry.content.length),
      u16leGif(nameBytes.length),
      u16leGif(0), // extra length
      nameBytes,
    );
    localParts.push(localHeader, data);

    const centralHeader = concatBytes(
      [0x50, 0x4b, 0x01, 0x02],
      u16leGif(20), // version made by
      u16leGif(20), // version needed
      u16leGif(0),
      u16leGif(method),
      u16leGif(0),
      u16leGif(0),
      u32le(crc),
      u32le(data.length),
      u32le(entry.content.length),
      u16leGif(nameBytes.length),
      u16leGif(0),
      u16leGif(0),
      u16leGif(0),
      u16leGif(0),
      u32le(0),
      u32le(offset),
      nameBytes,
    );
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectory = concatBytes(...centralParts);
  const eocd = concatBytes(
    [0x50, 0x4b, 0x05, 0x06],
    u16leGif(0),
    u16leGif(0),
    u16leGif(entries.length),
    u16leGif(entries.length),
    u32le(centralDirectory.length),
    u32le(offset),
    u16leGif(0),
  );
  return concatBytes(...localParts, centralDirectory, eocd);
}

export interface TarEntrySpec {
  name: string;
  content: Uint8Array;
  /** '0' = regular file, '5' = directory. Default '0'. */
  typeflag?: '0' | '5';
}

/**
 * A ustar-format TAR archive (The Open Group's own `pax` utility
 * description, "ustar Header Block"): one 512-byte header per entry
 * (padded content to a 512-byte boundary), a genuinely computed checksum,
 * and two all-zero 512-byte blocks marking the end of the archive.
 */
export function writeTar(entries: TarEntrySpec[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const header = new Uint8Array(512);
    const write = (offset: number, text: string) => {
      for (let i = 0; i < text.length && offset + i < 512; i++) header[offset + i] = text.charCodeAt(i);
    };
    write(0, entry.name);
    write(100, '0000644\0');
    write(108, '0000000\0');
    write(116, '0000000\0');
    write(124, `${entry.content.length.toString(8).padStart(11, '0')}\0`);
    write(136, `${'0'.repeat(11)}\0`);
    for (let i = 148; i < 156; i++) header[i] = 0x20;
    header[156] = (entry.typeflag ?? '0').charCodeAt(0);
    write(257, 'ustar\0');
    write(263, '00');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i]!;
    write(148, `${sum.toString(8).padStart(6, '0')}\0 `);
    blocks.push(header);

    if (entry.content.length > 0) {
      const padded = new Uint8Array(Math.ceil(entry.content.length / 512) * 512);
      padded.set(entry.content);
      blocks.push(padded);
    }
  }
  blocks.push(new Uint8Array(1024)); // two zero blocks mark the end
  return concatBytes(...blocks);
}

/**
 * Builds one fixture file of the given kind, carrying `marker`.
 * `index` (1-based) only affects the file's own name, for a scenario that
 * attaches more than one file of the same kind.
 */
export function buildFixtureFile(kind: FixtureFileKind, marker: string, index?: number): FixtureFile {
  const suffix = index && index > 1 ? `-${index}` : '';
  switch (kind) {
    case 'pdf':
      return {
        name: `sample${suffix}.pdf`,
        mimeType: 'application/pdf',
        buffer: writePdf([{ text: 'Page 1' }], marker),
      };
    case 'pdf-3':
      return {
        name: `sample${suffix}.pdf`,
        mimeType: 'application/pdf',
        buffer: writePdf([{ text: 'Page 1' }, { text: 'Page 2' }, { text: 'Page 3' }], marker),
      };
    case 'pdf-long':
      return {
        name: `sample${suffix}.pdf`,
        mimeType: 'application/pdf',
        buffer: writePdf(
          Array.from({ length: 150 }, (_, i) => ({ text: `Page ${i + 1}` })),
          marker,
        ),
      };
    case 'png': {
      const rgba = new Uint8Array(16 * 16 * 4);
      for (let i = 0; i < 16 * 16; i++) {
        rgba[i * 4] = 255;
        rgba[i * 4 + 3] = 255;
      }
      return {
        name: `sample${suffix}.png`,
        mimeType: 'image/png',
        buffer: writePng(16, 16, rgba, [pngTextChunk('Comment', marker), pngExifChunk(minimalExifTiff(marker))]),
      };
    }
    case 'png-large': {
      const w = 6000;
      const h = 4000;
      const rgba = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        rgba[i * 4 + 1] = 255;
        rgba[i * 4 + 3] = 255;
      }
      return { name: `sample${suffix}.png`, mimeType: 'image/png', buffer: writePng(w, h, rgba) };
    }
    case 'jpeg':
      return {
        name: `sample${suffix}.jpg`,
        mimeType: 'image/jpeg',
        buffer: writeJpeg(16, 8, [
          jpegExifSegment(minimalExifTiff(marker)),
          jpegXmpSegment(
            `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>${marker}</dc:description></rdf:Description></rdf:RDF></x:xmpmeta>`,
          ),
          jpegIptcSegment(marker),
          jpegCommentSegment(marker),
        ]),
      };
    case 'webp':
      return {
        name: `sample${suffix}.webp`,
        mimeType: 'image/webp',
        buffer: writeWebp(16, 8, {
          exif: minimalExifTiff(marker),
          xmp: ascii(marker) as unknown as Uint8Array,
        }),
      };
    case 'gif':
      return { name: `sample${suffix}.gif`, mimeType: 'image/gif', buffer: writeGif(marker) };
    case 'bmp':
      return { name: `sample${suffix}.bmp`, mimeType: 'image/bmp', buffer: writeBmp(4, 4) };
    case 'zip':
      return {
        name: `sample${suffix}.zip`,
        mimeType: 'application/zip',
        buffer: writeZip([
          { name: 'readme.txt', content: new TextEncoder().encode(marker), method: 0 },
          { name: 'folder/data.txt', content: new TextEncoder().encode(marker.repeat(20)), method: 8 },
        ]),
      };
    case 'tar':
      return {
        name: `sample${suffix}.tar`,
        mimeType: 'application/x-tar',
        buffer: writeTar([
          { name: 'notes.txt', content: new TextEncoder().encode(marker) },
          { name: 'folder/', content: new Uint8Array(0), typeflag: '5' },
        ]),
      };
    case 'tar.gz': {
      const tar = writeTar([{ name: 'notes.txt', content: new TextEncoder().encode(marker) }]);
      return { name: `sample${suffix}.tar.gz`, mimeType: 'application/gzip', buffer: gzipSync(tar) };
    }
    case 'gz': {
      const original = new TextEncoder().encode(marker);
      return { name: `sample${suffix}.gz`, mimeType: 'application/gzip', buffer: gzipSync(original) };
    }
    case 'text':
      return { name: `notes${suffix}.txt`, mimeType: 'text/plain', buffer: new TextEncoder().encode(marker) };
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown fixture file kind: ${String(exhaustive)}`);
    }
  }
}

/** Splits a comma-separated list of kinds and builds one file per kind, in order. */
export function buildFixtureFiles(commaSeparatedKinds: string, marker: string): FixtureFile[] {
  const kinds = commaSeparatedKinds
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  const counts = new Map<string, number>();
  return kinds.map((kind) => {
    if (!FIXTURE_FILE_KINDS.includes(kind as FixtureFileKind)) {
      throw new Error(`Unknown fixture file kind: "${kind}"`);
    }
    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    return buildFixtureFile(kind as FixtureFileKind, marker, n);
  });
}
