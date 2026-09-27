/**
 * A hand-written multi-size ICO container writer and reader, laid out
 * exactly as Microsoft's own documentation defines it, with PNG-compressed
 * image entries (every current browser and Windows since Vista read this;
 * Windows XP does not, disclosed in `limits`).
 *
 * ICONDIR (learn.microsoft.com/windows/win32/api/wingdi/ns-wingdi-newheader,
 * and the community-maintained but Microsoft-sourced ICO format page at
 * docs.fileformat.com/image/ico, both describing the same fixed layout
 * Windows itself reads): a 6-byte header (`idReserved` must be 0,
 * `idType` 1 for an icon, `idCount` the number of images), followed by one
 * 16-byte ICONDIRENTRY per image: `bWidth`/`bHeight` (one byte each; 0 means
 * 256, since a byte cannot hold 256 itself), `bColorCount` (0 for a
 * true-colour image), `bReserved` (0), `wPlanes` (1), `wBitCount` (32 for a
 * PNG entry with an alpha channel), `dwBytesInRes` (the entry's own byte
 * count) and `dwImageOffset` (its absolute byte offset from the start of
 * the file). Every multi-byte field is little-endian.
 */
import { sniffFile, FileSignatureError } from './file-sniff';

export interface IcoImage {
  width: number;
  height: number;
  /** The complete, already-encoded PNG bytes for this size. */
  bytes: Uint8Array;
}

export interface IcoDirectoryEntry {
  width: number;
  height: number;
  bitCount: number;
  bytesInResource: number;
  imageOffset: number;
}

export class FaviconError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaviconError';
  }
}

function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}
function readU16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}
function readU32le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

/** A byte-sized dimension field: 0 stands for 256, the one value a single byte cannot hold directly. */
function dimensionByte(pixels: number): number {
  return pixels === 256 ? 0 : pixels & 0xff;
}
function dimensionFromByte(b: number): number {
  return b === 0 ? 256 : b;
}

/**
 * Writes a valid multi-size ICO file: the 6-byte ICONDIR, one 16-byte
 * ICONDIRENTRY per image (sorted by size, smallest first), then every
 * image's own PNG bytes in that same order. Each image's PNG signature and
 * declared IHDR size are checked against its own stated `width`/`height`
 * before anything is written, using the canonical header check every phase
 * 9 file-reading package copies.
 */
export function buildIco(images: IcoImage[]): Uint8Array {
  if (images.length === 0) {
    throw new FaviconError('No images were given to build an ICO file from.');
  }
  const sorted = [...images].sort((a, b) => a.width * a.height - b.width * b.height);

  for (const image of sorted) {
    const sniffed = sniffFile(image.bytes);
    if (!sniffed || sniffed.kind !== 'png') {
      throw new FaviconError(`An ICO entry's own bytes are not a PNG image.`);
    }
    if (sniffed.width !== image.width || sniffed.height !== image.height) {
      throw new FaviconError(
        `An ICO entry declares ${image.width} by ${image.height} but its own PNG data is ${sniffed.width} by ${sniffed.height}.`,
      );
    }
  }

  const headerBytes = 6;
  const entryBytes = 16 * sorted.length;
  let offset = headerBytes + entryBytes;
  const entries: number[] = [];
  const dataParts: Uint8Array[] = [];
  for (const image of sorted) {
    entries.push(
      dimensionByte(image.width),
      dimensionByte(image.height),
      0, // colour count: 0, a true-colour image
      0, // reserved
      ...u16le(1), // planes
      ...u16le(32), // bit count: 32 (RGBA)
      ...u32le(image.bytes.length),
      ...u32le(offset),
    );
    dataParts.push(image.bytes);
    offset += image.bytes.length;
  }

  const header = [0, 0, 1, 0, ...u16le(sorted.length)];
  const total = headerBytes + entryBytes + dataParts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  out.set(Uint8Array.from(header), 0);
  out.set(Uint8Array.from(entries), headerBytes);
  let pos = headerBytes + entryBytes;
  for (const part of dataParts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/** Parses the same ICONDIR/ICONDIRENTRY layout `buildIco` writes, for tests and for the page's own stats. Never decodes the entries' own PNG payload. */
export function readIcoDirectory(bytes: Uint8Array): IcoDirectoryEntry[] {
  if (bytes.length < 6) throw new FileSignatureError('this file is empty', 'empty');
  const reserved = readU16le(bytes, 0);
  const type = readU16le(bytes, 2);
  const count = readU16le(bytes, 4);
  if (reserved !== 0 || type !== 1) {
    throw new FaviconError('This is not an ICO file: its own reserved and type header fields are wrong.');
  }
  const entries: IcoDirectoryEntry[] = [];
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16;
    if (bytes.length < base + 16) throw new FaviconError('The ICO directory is truncated.');
    entries.push({
      width: dimensionFromByte(bytes[base]!),
      height: dimensionFromByte(bytes[base + 1]!),
      bitCount: readU16le(bytes, base + 6),
      bytesInResource: readU32le(bytes, base + 8),
      imageOffset: readU32le(bytes, base + 12),
    });
  }
  return entries;
}
