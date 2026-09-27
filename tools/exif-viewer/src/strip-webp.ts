/**
 * RFC 9649 (the WebP container format) section 2: a WebP file is a RIFF
 * container ("RIFF", a 4-byte little-endian size, "WEBP") holding a
 * sequence of chunks, each a 4-byte FourCC, a 4-byte little-endian size and
 * the payload itself, padded with one zero byte when the payload's own
 * length is odd (section 2.3 "Terminology", "Chunk"). Section 2.5 "Extended
 * File Format" defines the VP8X chunk (always first when present): a
 * one-byte flags field (bit 5 = 0x20 ICC profile, bit 3 = 0x08 Exif
 * metadata, bit 2 = 0x04 XMP metadata, per the section's own flags table),
 * three reserved bytes, then the canvas width-minus-one and height-minus-one
 * as 24-bit little-endian integers -- neither of which this file ever
 * touches. Section 2.7 "Metadata" defines the optional `ICCP`, `EXIF` and
 * `XMP ` chunks a VP8X container may carry.
 *
 * A simple (non-extended) file -- its first chunk is `VP8 ` (lossy) or
 * `VP8L` (lossless) rather than `VP8X` -- has nowhere to carry any of these
 * chunks at all: RFC 9649 only defines them inside the extended format.
 * Such a file is returned unchanged, with nothing removed.
 */
import { readOrientation, orientationOnlyExif } from './orientation';
import { describeRemoval } from './describe';

const RIFF_HEADER_SIZE = 12; // "RIFF" + 4-byte size + "WEBP"

export interface WebpChunk {
  fourCc: string;
  /** Offset of this chunk's own FourCC, within the file. */
  offset: number;
  /** The payload only, excluding the FourCC, size field and any padding byte. */
  data: Uint8Array;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(bytes[offset + i]!);
  return s;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

/**
 * Walks every top-level chunk of a WebP file (the header's own "RIFF" and
 * "WEBP" fields are not chunks and are not included). Throws when a chunk's
 * declared size runs past the end of the file -- the same "refuse rather
 * than guess" rule this phase's every format walker follows.
 */
export function readWebpChunks(bytes: Uint8Array): WebpChunk[] {
  const chunks: WebpChunk[] = [];
  let offset = RIFF_HEADER_SIZE;
  while (offset + 8 <= bytes.length) {
    const fourCc = ascii(bytes, offset, 4);
    const size = readUint32LE(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) {
      throw new WebpStripError('a chunk in this WebP file declares more data than the file actually has');
    }
    chunks.push({ fourCc, offset, data: bytes.subarray(dataStart, dataEnd) });
    offset = dataEnd + (size % 2); // one pad byte when the payload length is odd
  }
  return chunks;
}

export class WebpStripError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebpStripError';
  }
}

function ascii4(s: string): number[] {
  return [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)];
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
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

function buildChunk(fourCc: string, data: Uint8Array): Uint8Array {
  const padding = data.length % 2 === 0 ? [] : [0];
  return concatBytes(ascii4(fourCc), u32le(data.length), data, padding);
}

const VP8X_ICC_FLAG = 0x20;
const VP8X_EXIF_FLAG = 0x08;
const VP8X_XMP_FLAG = 0x04;

export interface StripWebpOptions {
  keepColourProfile: boolean;
  keepOrientation: boolean;
}

export interface StripWebpResult {
  bytes: Uint8Array;
  removed: { what: string; bytes: number }[];
  warnings: string[];
}

/**
 * Removes `EXIF` and `XMP ` chunks from a VP8X WebP file, clears their VP8X
 * flag bits, and rewrites the RIFF size field to match the new file length.
 * `ICCP` is kept unless `keepColourProfile` is false. When the original
 * carried a non-default Exif Orientation and `keepOrientation` is true, a
 * new, minimal `EXIF` chunk holding only that tag is written back in (with
 * the Exif flag set again), so a rotated photo is not shown sideways.
 *
 * A simple (non-extended) file -- no `VP8X` chunk -- is returned unchanged.
 */
export function stripWebp(bytes: Uint8Array, options: StripWebpOptions): StripWebpResult {
  const chunks = readWebpChunks(bytes);
  const first = chunks[0];
  if (!first || first.fourCc !== 'VP8X') {
    return { bytes, removed: [], warnings: [] };
  }
  if (first.data.length < 10) {
    throw new WebpStripError("this WebP file's VP8X chunk is too short to be valid");
  }

  const removed: { what: string; bytes: number }[] = [];
  let originalOrientation: number | undefined;

  const kept: WebpChunk[] = [];
  for (const chunk of chunks.slice(1)) {
    if (chunk.fourCc === 'ICCP') {
      if (options.keepColourProfile) kept.push(chunk);
      else removed.push({ what: describeRemoval('colour-profile'), bytes: chunk.data.length + 8 });
    } else if (chunk.fourCc === 'EXIF') {
      try {
        originalOrientation = readOrientation(chunk.data);
      } catch {
        originalOrientation = undefined;
      }
      removed.push({ what: describeRemoval('exif'), bytes: chunk.data.length + 8 });
    } else if (chunk.fourCc === 'XMP ') {
      removed.push({ what: describeRemoval('xmp'), bytes: chunk.data.length + 8 });
    } else {
      // ANIM, ANMF, ALPH, VP8, VP8L and anything else this file does not
      // specifically recognise: image and animation data, never metadata.
      kept.push(chunk);
    }
  }

  const keepingOrientation = options.keepOrientation && originalOrientation !== undefined && originalOrientation !== 1;

  const flagsByte = first.data[0]!;
  let newFlags = flagsByte;
  newFlags = options.keepColourProfile ? newFlags | VP8X_ICC_FLAG : newFlags & ~VP8X_ICC_FLAG;
  newFlags = keepingOrientation ? newFlags | VP8X_EXIF_FLAG : newFlags & ~VP8X_EXIF_FLAG;
  newFlags = newFlags & ~VP8X_XMP_FLAG; // XMP is always dropped

  const newVp8xData = Uint8Array.from(first.data);
  newVp8xData[0] = newFlags;
  const newVp8x = buildChunk('VP8X', newVp8xData);

  const parts: Uint8Array[] = [newVp8x, ...kept.map((c) => buildChunk(c.fourCc, c.data))];
  if (keepingOrientation) {
    parts.push(buildChunk('EXIF', orientationOnlyExif(originalOrientation!)));
  }

  const payload = concatBytes(ascii4('WEBP'), ...parts);
  const out = concatBytes(ascii4('RIFF'), u32le(payload.length), payload);

  return { bytes: out, removed, warnings: [] };
}
