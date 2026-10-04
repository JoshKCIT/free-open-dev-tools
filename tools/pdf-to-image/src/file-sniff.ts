/**
 * Canonical header checks for every file format a phase 9 tool reads,
 * checked from a file's own leading bytes only, before any real parsing or
 * decoding ever touches it. This header names only the specifications each
 * check implements, never a tool: every phase 9 file-reading package copies
 * this file byte for byte.
 *
 * ISO 32000-1:2008 section 7.5.2 "File Header" (fetched from Adobe's own
 * public copy, opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/
 * PDF32000_2008.pdf): "The first line of a PDF file shall be a header
 * consisting of the 5 characters %PDF- followed by a version number of the
 * form 1.N, where N is a digit between 0 and 7." This project follows
 * PDF.js's own leniency here (its `find(stream, PDF_HEADER_SIGNATURE)` call
 * in src/core/document.js at the installed 6.3.289 tag, whose `find`
 * defaults to a 1024-byte search limit) and accepts the header signature
 * starting anywhere within the first 1024 bytes, not only at byte 0, since
 * real-world PDFs sometimes carry junk (or a shebang line) before it.
 *
 * W3C PNG (Third Edition) section 5.2 "PNG signature": the first eight
 * bytes are the fixed decimal sequence 137 80 78 71 13 10 26 10; section
 * 11.2.2 "IHDR Image header" gives Width and Height as 4-byte big-endian
 * unsigned integers immediately after the fixed IHDR chunk header.
 *
 * ITU-T T.81 (the JPEG specification) section B.1.1.4 "Marker segments"
 * and Table B.1 (the SOF0-SOF15 frame markers, excluding DHT/JPG/DAC):
 * a JPEG starts with the SOI marker (0xFFD8), then a sequence of marker
 * segments each carrying a 2-byte length; the first Start-Of-Frame marker's
 * own segment carries the big-endian Y (height) then X (width) fields.
 *
 * GIF89a's own specification (w3.org/Graphics/GIF): section 17 "Header"
 * (the fixed signature "GIF" plus a 3-byte version) and section 18
 * "Logical Screen Descriptor" (a 2-byte width then a 2-byte height,
 * "Unless otherwise stated, multi-byte numeric fields are ordered with
 * the Least Significant Byte first").
 *
 * RFC 9649 (the WebP container format) section 2.4 (the WebP header:
 * "RIFF", a 4-byte size, "WEBP"), and sections 2.5-2.7 for the VP8, VP8L
 * and VP8X chunk layouts and their own width/height encodings.
 *
 * Microsoft's own BITMAPFILEHEADER and BITMAPINFOHEADER documentation
 * (learn.microsoft.com/windows/win32/api/wingdi): a 14-byte file header
 * (bfType "BM"), then an info header whose own first 4-byte field states
 * its length -- 12 for the older BITMAPCOREHEADER (unsigned 16-bit
 * width/height, always bottom-up) or 40 or more for BITMAPINFOHEADER and
 * its revisions (signed 32-bit width/height; a negative height means
 * top-down).
 *
 * PKWARE's APPNOTE.TXT (pkware.cachefly.net/webdocs/casestudies/
 * APPNOTE.TXT): the local file header signature is 4 bytes, 0x04034b50
 * (bytes "PK\x03\x04"); an archive with no entries still carries the end
 * of central directory record, signature 0x06054b50 ("PK\x05\x06").
 *
 * RFC 1952 (the gzip file format) section 2.3.1: the fixed header bytes
 * ID1=31 (0x1f), ID2=139 (0x8b), then CM (compression method), where
 * CM=8 denotes the deflate method every gzip member in practice uses.
 *
 * The Open Group Base Specifications' own `pax` utility description
 * (pubs.opengroup.org/onlinepubs/9699919799/utilities/pax.html), "ustar
 * Header Block": a 512-byte header whose own fixed `magic` field (offset
 * 257, 6 bytes) holds "ustar" followed by a NUL for the POSIX form, or
 * "ustar  " (with a trailing space and no NUL) for the older pre-POSIX GNU
 * form; the `chksum` field (offset 148, 8 bytes) is the header's own
 * unsigned byte sum, computed with the checksum field itself treated as
 * eight ASCII spaces, that both forms carry and this file verifies.
 */

export type FileKind = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'zip' | 'gzip' | 'tar';

export const FILE_KINDS: FileKind[] = ['pdf', 'png', 'jpeg', 'gif', 'webp', 'bmp', 'zip', 'gzip', 'tar'];

/** A human word for each kind, used only to build a visitor-facing message. */
const KIND_WORDS: Record<FileKind, string> = {
  pdf: 'PDF',
  png: 'PNG',
  jpeg: 'JPEG',
  gif: 'GIF',
  webp: 'WebP',
  bmp: 'BMP',
  zip: 'ZIP',
  gzip: 'gzip',
  tar: 'TAR',
};

/** At most this many leading bytes are ever read to identify a file's kind. */
export const MAX_HEADER_BYTES = 64 * 1024;

export interface SniffResult {
  kind: FileKind;
  width?: number;
  height?: number;
}

export class FileSignatureError extends Error {
  /** Why the file was refused, for tests and for callers that want to branch on it. */
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = 'FileSignatureError';
    this.reason = reason;
  }
}

function need(bytes: Uint8Array, end: number): boolean {
  return bytes.length >= end;
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

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function readInt32LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24) | 0;
}

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const PDF_HEADER_SEARCH_LIMIT = 1024;

function sniffPdf(bytes: Uint8Array): SniffResult | null {
  const limit = Math.min(bytes.length, PDF_HEADER_SEARCH_LIMIT);
  for (let i = 0; i <= limit - PDF_HEADER.length; i++) {
    let matched = true;
    for (let j = 0; j < PDF_HEADER.length; j++) {
      if (bytes[i + j] !== PDF_HEADER[j]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    const digit = bytes[i + PDF_HEADER.length];
    if (digit !== undefined && digit >= 0x30 && digit <= 0x39) {
      return { kind: 'pdf' };
    }
  }
  return null;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function sniffPng(bytes: Uint8Array): SniffResult | null {
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  if (!need(bytes, 24)) return null;
  const chunkType = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunkType !== 'IHDR') return null;
  return { kind: 'png', width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const JPEG_STANDALONE_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9]);

function sniffJpeg(bytes: Uint8Array): SniffResult | null {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let markerOffset = i + 1;
    while (bytes[markerOffset] === 0xff) markerOffset++;
    if (!need(bytes, markerOffset + 1)) return null;
    const marker = bytes[markerOffset]!;
    const afterMarker = markerOffset + 1;

    if (JPEG_STANDALONE_MARKERS.has(marker)) {
      if (marker === 0xd9) break;
      i = afterMarker;
      continue;
    }

    if (!need(bytes, afterMarker + 2)) return null;
    const length = readUint16BE(bytes, afterMarker);
    if (length < 2) return null;

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (!need(bytes, afterMarker + 2 + 5)) return null;
      const height = readUint16BE(bytes, afterMarker + 2 + 1);
      const width = readUint16BE(bytes, afterMarker + 2 + 3);
      return { kind: 'jpeg', width, height };
    }

    if (marker === 0xda) break; // Start of Scan with no SOF found first
    i = afterMarker + length;
  }
  return null;
}

function sniffGif(bytes: Uint8Array): SniffResult | null {
  if (bytes.length < 6) return null;
  if (String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!) !== 'GIF') return null;
  const version = String.fromCharCode(bytes[3]!, bytes[4]!, bytes[5]!);
  if (version !== '87a' && version !== '89a') return null;
  if (!need(bytes, 10)) return null;
  return { kind: 'gif', width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8) };
}

function sniffWebp(bytes: Uint8Array): SniffResult | null {
  if (bytes.length < 12) return null;
  if (String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) !== 'RIFF') return null;
  if (String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!) !== 'WEBP') return null;
  if (!need(bytes, 16)) return null;
  const fourCc = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  const payloadStart = 20;

  if (fourCc === 'VP8 ') {
    if (!need(bytes, payloadStart + 10)) return null;
    const c0 = bytes[payloadStart + 3]!;
    const c1 = bytes[payloadStart + 4]!;
    const c2 = bytes[payloadStart + 5]!;
    if (c0 !== 0x9d || c1 !== 0x01 || c2 !== 0x2a) return null;
    return {
      kind: 'webp',
      width: readUint16LE(bytes, payloadStart + 6) & 0x3fff,
      height: readUint16LE(bytes, payloadStart + 8) & 0x3fff,
    };
  }
  if (fourCc === 'VP8L') {
    if (!need(bytes, payloadStart + 5)) return null;
    if (bytes[payloadStart] !== 0x2f) return null;
    const b1 = bytes[payloadStart + 1]!;
    const b2 = bytes[payloadStart + 2]!;
    const b3 = bytes[payloadStart + 3]!;
    const b4 = bytes[payloadStart + 4]!;
    return {
      kind: 'webp',
      width: 1 + (b1 | ((b2 & 0x3f) << 8)),
      height: 1 + (((b2 >> 6) & 0x3) | (b3 << 2) | ((b4 & 0xf) << 10)),
    };
  }
  if (fourCc === 'VP8X') {
    if (!need(bytes, payloadStart + 10)) return null;
    return {
      kind: 'webp',
      width: 1 + readUint24LE(bytes, payloadStart + 4),
      height: 1 + readUint24LE(bytes, payloadStart + 7),
    };
  }
  return null;
}

function sniffBmp(bytes: Uint8Array): SniffResult | null {
  if (bytes.length < 2 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null; // "BM"
  if (!need(bytes, 14 + 4)) return null;
  const headerSizeLE = bytes[14]! | (bytes[15]! << 8) | (bytes[16]! << 16) | (bytes[17]! << 24);
  if (headerSizeLE === 12) {
    if (!need(bytes, 14 + 12)) return null;
    const coreWidth = readUint16LE(bytes, 18);
    const coreHeight = readUint16LE(bytes, 20);
    if (coreWidth < 1 || coreHeight < 1) return null;
    return { kind: 'bmp', width: coreWidth, height: coreHeight };
  }
  // The width is at offset 18 and the height at offset 22, so the fields end at byte 26 (14 + 12).
  if (!need(bytes, 14 + 12)) return null;
  const width = readInt32LE(bytes, 18);
  const height = readInt32LE(bytes, 22);
  // A width is never negative or zero and a height is never zero (a negative height only means top-down); anything
  // else is not a real picture, and a negative width would make width * height negative and slip past a pixel limit.
  if (width < 1 || height === 0) return null;
  return { kind: 'bmp', width, height: Math.abs(height) };
}

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY_EOCD = [0x50, 0x4b, 0x05, 0x06];

function sniffZip(bytes: Uint8Array): SniffResult | null {
  if (bytes.length < 4) return null;
  const matchesLocal = ZIP_LOCAL_HEADER.every((b, i) => bytes[i] === b);
  const matchesEmptyEocd = ZIP_EMPTY_EOCD.every((b, i) => bytes[i] === b);
  if (!matchesLocal && !matchesEmptyEocd) return null;
  return { kind: 'zip' };
}

function sniffGzip(bytes: Uint8Array): SniffResult | null {
  if (bytes.length < 3) return null;
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 0x08) return null;
  return { kind: 'gzip' };
}

function sniffTar(bytes: Uint8Array): SniffResult | null {
  if (!need(bytes, 512)) return null;
  // Checksum, per the Open Group's own ustar Header Block description: the
  // unsigned byte sum of the whole 512-byte header, with the 8-byte chksum
  // field itself treated as eight ASCII spaces during the sum. A ustar
  // header (magic "ustar\0" or the older pre-POSIX "ustar ") is accepted
  // outright; a header with no ustar magic at all is still accepted when
  // its own checksum is genuinely valid, since pre-POSIX tar predates the
  // magic field.
  let sum = 0;
  for (let i = 0; i < 512; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : bytes[i]!;
  }
  const chksumField = String.fromCharCode(...bytes.subarray(148, 156))
    .replace(/\0.*$/, '')
    .trim();
  const declaredChecksum = parseInt(chksumField, 8);
  if (!Number.isFinite(declaredChecksum) || declaredChecksum !== sum) return null;
  return { kind: 'tar' };
}

/**
 * Reads at most `MAX_HEADER_BYTES` of a file and reports its kind, or
 * `null` when nothing this project reads recognises it. Never decodes a
 * page, a pixel or an archive entry -- only ever looks at header bytes.
 */
export function sniffFile(bytes: Uint8Array): SniffResult | null {
  const header = bytes.length > MAX_HEADER_BYTES ? bytes.subarray(0, MAX_HEADER_BYTES) : bytes;
  return (
    sniffPdf(header) ??
    sniffPng(header) ??
    sniffJpeg(header) ??
    sniffGif(header) ??
    sniffWebp(header) ??
    sniffBmp(header) ??
    sniffZip(header) ??
    sniffGzip(header) ??
    sniffTar(header)
  );
}

export interface FileKindLimits {
  maxBytes: number;
  maxPixels?: number;
}

function describeAccepted(accepted: FileKind[]): string {
  const words = accepted.map((k) => KIND_WORDS[k]);
  if (words.length === 1) return `a ${words[0]}`;
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}

/**
 * Refuses an empty file, a file over `limits.maxBytes`, an unrecognised
 * header, a recognised kind outside `accepted`, a declared width or height
 * below 1, or -- once the sniffed result carries dimensions -- a declared
 * pixel count over `limits.maxPixels`. Returns the sniff result only when every check
 * passes. Never quotes any byte of the file's own content in a message.
 */
export function assertFileKind(bytes: Uint8Array, accepted: FileKind[], limits: FileKindLimits): SniffResult {
  if (bytes.length === 0) {
    throw new FileSignatureError('this file is empty', 'empty');
  }
  if (bytes.length > limits.maxBytes) {
    throw new FileSignatureError("it is larger than this tool's size limit", 'too-large');
  }
  const result = sniffFile(bytes);
  if (!result) {
    throw new FileSignatureError(`this is not ${describeAccepted(accepted)}`, 'unrecognised');
  }
  if (!accepted.includes(result.kind)) {
    throw new FileSignatureError(`this is not ${describeAccepted(accepted)}`, 'wrong-kind');
  }
  if (result.width !== undefined && result.height !== undefined && (result.width < 1 || result.height < 1)) {
    throw new FileSignatureError(
      `the size of this ${KIND_WORDS[result.kind]} could not be read from its header`,
      'no-size',
    );
  }
  if (
    limits.maxPixels !== undefined &&
    result.width !== undefined &&
    result.height !== undefined &&
    result.width * result.height > limits.maxPixels
  ) {
    throw new FileSignatureError(
      `this ${KIND_WORDS[result.kind]} declares more pixels than this tool's limit allows`,
      'too-many-pixels',
    );
  }
  return result;
}
