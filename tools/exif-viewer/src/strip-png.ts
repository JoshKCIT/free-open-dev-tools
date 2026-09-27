/**
 * W3C PNG (Third Edition) section 5.2 "PNG Signature": the fixed 8-byte
 * sequence 137 80 78 71 13 10 26 10. Section 5.3 "Chunk Layout": a chunk is
 * a 4-byte big-endian length (the data length only), a 4-byte type, the
 * data itself, then a 4-byte CRC-32 (ISO 3309) computed over the type and
 * data bytes together, never the length. Section 5.4 "Chunk Naming
 * Conventions": a chunk is critical when the fifth bit of its first byte is
 * clear -- an ASCII uppercase first letter -- and ancillary when that bit is
 * set (a lowercase first letter); a decoder that does not recognise a
 * critical chunk must refuse the file, while an unrecognised ancillary
 * chunk may simply be ignored. Sections 11.2 ("Critical Chunks") and 11.3
 * ("Ancillary Chunks") name every chunk this file keeps, drops or refuses.
 */
import { readOrientation, orientationOnlyExif } from './orientation';
import { describeRemoval } from './describe';
import { hasOwn, getOwn } from './own-property';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * Every chunk type this tool keeps byte for byte, from W3C PNG (Third
 * Edition) sections 11.2 and 11.3: the four critical chunks, plus the
 * colour, transparency, physical-scale and (for an animated PNG, W3C's own
 * APNG extension) frame-control chunks that change how the picture decodes
 * or displays -- never a chunk that only carries human-facing text. `iCCP`
 * is included here unconditionally; `stripPng` still honours
 * `keepColourProfile` by dropping it explicitly when asked, the same way
 * `strip-jpeg.ts` and `strip-webp.ts` each gate their own colour-profile
 * segment.
 */
export const PNG_KEPT_CHUNKS = [
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'cHRM',
  'gAMA',
  'iCCP',
  'sBIT',
  'sRGB',
  'cICP',
  'mDCV',
  'cLLI',
  'bKGD',
  'hIST',
  'pHYs',
  'sPLT',
  'acTL',
  'fcTL',
  'fdAT',
] as const;

const CRITICAL_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

export class PngStripError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngStripError';
  }
}

interface PngChunk {
  type: string;
  data: Uint8Array;
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

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(bytes[offset + i]!);
  return s;
}

function readChunks(bytes: Uint8Array): PngChunk[] {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new PngStripError('this is not a PNG file');
  }
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (crcOffset + 4 > bytes.length) {
      throw new PngStripError(`this PNG file's ${type} chunk declares more data than the file actually has`);
    }
    const data = bytes.subarray(dataStart, dataEnd);
    const declaredCrc = readUint32BE(bytes, crcOffset);
    const actualCrc = crc32(bytes.subarray(offset + 4, dataEnd));
    if (declaredCrc !== actualCrc) {
      throw new PngStripError(`this PNG file's ${type} chunk has a checksum that does not match its own data`);
    }
    chunks.push({ type, data });
    offset = crcOffset + 4;
    if (type === 'IEND') break;
  }
  if (chunks.length === 0 || chunks[chunks.length - 1]!.type !== 'IEND') {
    throw new PngStripError('this PNG file has no end marker');
  }
  return chunks;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export interface StripPngOptions {
  keepColourProfile: boolean;
  keepOrientation: boolean;
}

export interface StripPngResult {
  bytes: Uint8Array;
  removed: { what: string; bytes: number }[];
  warnings: string[];
}

const TEXT_CHUNK_LABEL: Record<string, string> = {
  tEXt: describeRemoval('comment'),
  iTXt: describeRemoval('comment'),
  zTXt: describeRemoval('comment'),
};

/**
 * Walks a PNG's chunks, keeps `PNG_KEPT_CHUNKS` byte for byte (dropping
 * `iCCP` too when `keepColourProfile` is false), drops every other
 * ancillary chunk (`tEXt`, `iTXt`, `zTXt`, `eXIf`, `tIME` and any other
 * lowercase-led type this tool does not specifically know), and refuses a
 * file carrying an unrecognised critical chunk rather than guess what it
 * means to drop or keep it. When the original `eXIf` chunk (raw TIFF bytes,
 * no wrapper -- W3C PNG Third Edition section 11.3.4.1) carried a
 * non-default Orientation and `keepOrientation` is true, a new, minimal
 * `eXIf` chunk holding only that tag is inserted right after `IHDR`.
 */
export function stripPng(bytes: Uint8Array, options: StripPngOptions): StripPngResult {
  const chunks = readChunks(bytes);
  const removed: { what: string; bytes: number }[] = [];
  const kept: PngChunk[] = [];
  let originalOrientation: number | undefined;
  let ihdr: PngChunk | undefined;

  for (const chunk of chunks) {
    if (chunk.type === 'IHDR') {
      ihdr = chunk;
      kept.push(chunk);
      continue;
    }
    if (chunk.type === 'iCCP') {
      if (options.keepColourProfile) kept.push(chunk);
      else removed.push({ what: describeRemoval('colour-profile'), bytes: chunk.data.length + 12 });
      continue;
    }
    if ((PNG_KEPT_CHUNKS as readonly string[]).includes(chunk.type)) {
      kept.push(chunk);
      continue;
    }
    if (chunk.type === 'eXIf') {
      try {
        originalOrientation = readOrientation(chunk.data);
      } catch {
        originalOrientation = undefined;
      }
      removed.push({ what: describeRemoval('exif'), bytes: chunk.data.length + 12 });
      continue;
    }
    if (chunk.type === 'tIME') {
      removed.push({ what: describeRemoval('timestamp'), bytes: chunk.data.length + 12 });
      continue;
    }
    // chunk.type is read straight from the file's own bytes, so this is a
    // property name read from untrusted input: looked up with `getOwn`
    // (own-property.ts) rather than plain bracket access, the same
    // precaution this phase's every "keyed by a name read from a file" spot
    // takes, even though a PNG chunk type's own fixed four-ASCII-letter
    // shape can never actually spell `__proto__` or `constructor`.
    if (hasOwn(TEXT_CHUNK_LABEL, chunk.type)) {
      removed.push({ what: getOwn(TEXT_CHUNK_LABEL, chunk.type) as string, bytes: chunk.data.length + 12 });
      continue;
    }
    // Any other chunk: keep an ancillary chunk this tool does not
    // specifically recognise unrecognised-but-harmless (lowercase first
    // letter means a decoder may safely ignore it, W3C PNG Third Edition
    // section 5.4) is not the same as safe to publish -- refuse a critical
    // one outright, and drop anything else as unrecognised metadata.
    const firstLetter = chunk.type.charCodeAt(0);
    const isCritical = firstLetter >= 65 && firstLetter <= 90;
    if (isCritical && !CRITICAL_CHUNKS.has(chunk.type)) {
      throw new PngStripError(`this PNG file has an unrecognised critical chunk (${chunk.type})`);
    }
    removed.push({ what: `an unrecognised metadata chunk (${chunk.type})`, bytes: chunk.data.length + 12 });
  }

  if (!ihdr) throw new PngStripError('this PNG file has no header chunk');

  const keepingOrientation = options.keepOrientation && originalOrientation !== undefined && originalOrientation !== 1;

  const out: Uint8Array[] = [Uint8Array.from(PNG_SIGNATURE)];
  for (const chunk of kept) {
    out.push(buildChunk(chunk.type, chunk.data));
    if (chunk === ihdr && keepingOrientation) {
      out.push(buildChunk('eXIf', orientationOnlyExif(originalOrientation!)));
    }
  }

  const total = out.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of out) {
    result.set(c, offset);
    offset += c.length;
  }

  return { bytes: result, removed, warnings: [] };
}
