import { ByteReader } from './bytes';
import { FontInspectorError } from './errors';
import { MAX_COLLECTION_FONTS, MAX_FILE_BYTES, MAX_TABLES } from './limits';

/** The sum every font file reaches when its head table's checksum adjustment is right. */
export const WHOLE_FILE_CHECKSUM = 0xb1b0afba;

export type ContainerKind = 'sfnt' | 'collection' | 'woff' | 'woff2';

/** The four-byte signatures at the start of a file, as 32-bit numbers. */
const SIG_TRUETYPE = 0x00010000;
const SIG_TRUE = 0x74727565; // 'true'
const SIG_OTTO = 0x4f54544f; // 'OTTO'
const SIG_TYP1 = 0x74797031; // 'typ1'
const SIG_TTCF = 0x74746366; // 'ttcf'
const SIG_WOFF = 0x774f4646; // 'wOFF'
const SIG_WOFF2 = 0x774f4632; // 'wOF2'

/** One entry of a font's table directory. */
export interface TableEntry {
  tag: string;
  /** The checksum the directory states. */
  checksum: number;
  offset: number;
  length: number;
  /** False when the table's range leaves the file; such a table is listed and never read. */
  inFile: boolean;
  /** Whether the directory's checksum matches the table's bytes; null when the table is not inside the file. */
  checksumOk: boolean | null;
}

/** One font of a file: its table directory with every range checked. */
export interface SfntFont {
  /** Where this font's table directory starts in the file. */
  offset: number;
  /** The shape of the outlines the signature promises: 'truetype', 'cff' or 'other' (an old Type 1 wrapper). */
  flavor: 'truetype' | 'cff' | 'other';
  tables: Map<string, TableEntry>;
  /** The tags in directory order, each once. */
  order: string[];
  /** The whole-file checksum check; null for a font inside a collection. */
  wholeFileOk: boolean | null;
  notes: string[];
}

export interface Container {
  kind: ContainerKind;
  fileSize: number;
  /** How many fonts the file holds (1 unless it is a collection). */
  memberCount: number;
  /** The offsets of the fonts' table directories (at most MAX_COLLECTION_FONTS of them). */
  memberOffsets: number[];
  /** For a WOFF or WOFF2 file, the kind of font inside as its header says; otherwise the same as the signature. */
  flavor: 'truetype' | 'cff' | 'collection' | 'other';
  notes: string[];
}

/** Refuses a file larger than the reader accepts, from its size alone. Call this before reading any byte. */
export function checkFileSize(size: number): void {
  if (!Number.isFinite(size) || size > MAX_FILE_BYTES) {
    throw new FontInspectorError(
      `This file is ${Number.isFinite(size) ? size.toLocaleString('en-US') : 'too many'} bytes, larger than the 20 MiB this page reads. It was not read.`,
      'File',
    );
  }
}

function flavorOf(signature: number): 'truetype' | 'cff' | 'collection' | 'other' {
  if (signature === SIG_TRUETYPE || signature === SIG_TRUE) return 'truetype';
  if (signature === SIG_OTTO) return 'cff';
  if (signature === SIG_TTCF) return 'collection';
  return 'other';
}

/**
 * Looks at the start of a file and says what it is. A TrueType or OpenType file gives one member at offset 0; a
 * collection gives the offsets of its fonts (the first `MAX_COLLECTION_FONTS`); a WOFF or WOFF2 file is recognised and
 * left for `unwrapWoff1` or the WOFF2 engine to unpack. Every fault is a `FontInspectorError` with a fixed sentence.
 */
export function readContainer(bytes: Uint8Array): Container {
  checkFileSize(bytes.length);
  if (bytes.length === 0) throw new FontInspectorError('The file is empty.', 'File');
  if (bytes.length < 12) throw new FontInspectorError('The file is too short to hold a font table directory.', 'File');
  const r = new ByteReader(bytes);
  const signature = r.u32(0);
  const notes: string[] = [];

  if (signature === SIG_WOFF || signature === SIG_WOFF2) {
    const flavor = bytes.length >= 8 ? flavorOf(r.u32(4)) : 'other';
    return {
      kind: signature === SIG_WOFF ? 'woff' : 'woff2',
      fileSize: bytes.length,
      memberCount: 1,
      memberOffsets: [],
      flavor,
      notes,
    };
  }
  if (signature === SIG_TTCF) {
    const count = r.u32(8);
    if (count === 0) throw new FontInspectorError('This collection lists no fonts.', 'File');
    // Each member offset takes four bytes: compare the count with the bytes that remain before sizing anything.
    const room = Math.floor((bytes.length - 12) / 4);
    const listed = Math.min(count, MAX_COLLECTION_FONTS, room);
    if (listed < 1) throw new FontInspectorError('The collection ends before its list of fonts does.', 'File');
    const offsets: number[] = [];
    for (let i = 0; i < listed; i++) offsets.push(r.u32(12 + 4 * i));
    if (count > MAX_COLLECTION_FONTS) {
      notes.push(
        `The collection holds ${count.toLocaleString('en-US')} fonts; only the first ${MAX_COLLECTION_FONTS} can be opened.`,
      );
    } else if (count > room) {
      notes.push('The collection lists more fonts than the file has room for; the ones that fit are listed.');
    }
    return {
      kind: 'collection',
      fileSize: bytes.length,
      memberCount: Math.min(count, MAX_COLLECTION_FONTS),
      memberOffsets: offsets,
      flavor: 'collection',
      notes,
    };
  }
  if (signature === SIG_TRUETYPE || signature === SIG_TRUE || signature === SIG_OTTO || signature === SIG_TYP1) {
    return {
      kind: 'sfnt',
      fileSize: bytes.length,
      memberCount: 1,
      memberOffsets: [0],
      flavor: flavorOf(signature),
      notes,
    };
  }
  throw new FontInspectorError('This file is not a TrueType, OpenType, WOFF or WOFF2 font.', 'File');
}

/**
 * The sum of 32-bit big-endian words over a byte range, padded with zeros, modulo 2 to the 32. With `skipAdjustment` the
 * word at byte 8 (the head table's checksum adjustment) counts as zero.
 */
export function checksum(bytes: Uint8Array, offset: number, length: number, skipAdjustment = false): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const whole = length & ~3;
  let sum = 0;
  for (let i = 0; i < whole; i += 4) {
    if (skipAdjustment && i === 8) continue;
    sum = (sum + view.getUint32(offset + i, false)) >>> 0;
  }
  if (whole < length) {
    let word = 0;
    for (let k = 0; k < 4; k++) word = (word << 8) | (whole + k < length ? bytes[offset + whole + k]! : 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

/**
 * Reads the table directory of the font that starts at `offset`. Every table range is compared with the file: a table
 * that leaves the file is listed as such and never read, and a table whose checksum is wrong is flagged without hiding
 * the rest. The number of tables is compared with the bytes that remain before the directory is read.
 */
export function readSfntFont(bytes: Uint8Array, offset: number, inCollection: boolean): SfntFont {
  const r = new ByteReader(bytes);
  if (!r.has(offset, 12)) {
    throw new FontInspectorError('The font starts past the end of the file.', 'Font number in a collection', offset);
  }
  const signature = r.u32(offset);
  const flavor = flavorOf(signature);
  if (flavor === 'collection' || (flavor === 'other' && signature !== SIG_TYP1)) {
    throw new FontInspectorError(
      'The data at this font’s position is not a font.',
      inCollection ? 'Font number in a collection' : 'File',
      offset,
    );
  }
  const count = r.u16(offset + 4);
  if (count === 0) throw new FontInspectorError('This font lists no tables.', 'File', offset + 4);
  if (count > MAX_TABLES) {
    throw new FontInspectorError(
      `This font lists ${count.toLocaleString('en-US')} tables, more than the ${MAX_TABLES} this page reads.`,
      'File',
      offset + 4,
    );
  }
  if (!r.has(offset + 12, 16 * count)) {
    throw new FontInspectorError('The font’s table directory runs past the end of the file.', 'File', offset + 12);
  }
  const tables = new Map<string, TableEntry>();
  const order: string[] = [];
  const notes: string[] = [];
  let duplicates = 0;
  for (let i = 0; i < count; i++) {
    const e = offset + 12 + 16 * i;
    const tag = r.tag(e);
    const stated = r.u32(e + 4);
    const start = r.u32(e + 8);
    const length = r.u32(e + 12);
    const inFile = r.has(start, length);
    let ok: boolean | null = null;
    if (inFile) ok = checksum(bytes, start, length, tag === 'head') === stated;
    if (tables.has(tag)) {
      duplicates++;
      continue;
    }
    tables.set(tag, { tag, checksum: stated, offset: start, length, inFile, checksumOk: ok });
    order.push(tag);
  }
  if (duplicates > 0)
    notes.push(
      `${duplicates} repeated table tag${duplicates === 1 ? '' : 's'} in the directory; only the first of each is read.`,
    );
  let wholeFileOk: boolean | null = null;
  if (!inCollection) wholeFileOk = checksum(bytes, 0, bytes.length) === WHOLE_FILE_CHECKSUM;
  return {
    offset,
    flavor: flavor === 'cff' ? 'cff' : flavor === 'truetype' ? 'truetype' : 'other',
    tables,
    order,
    wholeFileOk,
    notes,
  };
}

/**
 * A copy of a plain sfnt whose head table has its checksum adjustment set again: 0xB1B0AFBA minus the sum of the whole file
 * with the adjustment counted as zero, modulo 2 to the 32 (OpenType, "head" table). A file without a usable head table
 * comes back unchanged. The head table's checksum in the directory counts the adjustment as zero, so it does not change.
 */
export function withChecksumAdjustment(sfnt: Uint8Array): Uint8Array {
  const out = sfnt.slice();
  if (out.length < 12) return out;
  const r = new ByteReader(out);
  const flavor = r.u32(0);
  if (flavor === SIG_TTCF) return out;
  const count = r.u16(4);
  if (!r.has(12, 16 * count)) return out;
  for (let i = 0; i < count; i++) {
    const e = 12 + 16 * i;
    if (r.tag(e) !== 'head') continue;
    const offset = r.u32(e + 8);
    const length = r.u32(e + 12);
    if (length < 12 || !r.has(offset, length)) return out;
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    view.setUint32(offset + 8, 0, false);
    const sum = checksum(out, 0, out.length);
    view.setUint32(offset + 8, (WHOLE_FILE_CHECKSUM - sum) >>> 0, false);
    return out;
  }
  return out;
}

/** The bytes of a table that lies inside the file, or undefined. */
export function tableBytes(bytes: Uint8Array, entry: TableEntry | undefined): Uint8Array | undefined {
  if (!entry || !entry.inFile) return undefined;
  return bytes.subarray(entry.offset, entry.offset + entry.length);
}

/**
 * Puts tables together as a plain sfnt with the directory sorted by tag and every table padded to four bytes. The
 * checksums in the directory are the ones given (a WOFF file states them) or computed here.
 */
export function assembleSfnt(
  flavor: number,
  tables: { tag: string; data: Uint8Array; checksum?: number }[],
): Uint8Array {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = sorted.length;
  let total = 12 + 16 * n;
  const placed = sorted.map((t) => {
    const at = total;
    total += (t.data.length + 3) & ~3;
    return { ...t, at };
  });
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, flavor, false);
  view.setUint16(4, n, false);
  let log = 0;
  while (2 ** (log + 1) <= n) log++;
  view.setUint16(6, 2 ** log * 16, false);
  view.setUint16(8, log, false);
  view.setUint16(10, n * 16 - 2 ** log * 16, false);
  placed.forEach((t, i) => {
    const e = 12 + 16 * i;
    for (let k = 0; k < 4; k++) out[e + k] = t.tag.charCodeAt(k) & 0xff;
    view.setUint32(e + 4, t.checksum ?? checksum(t.data, 0, t.data.length, t.tag === 'head'), false);
    view.setUint32(e + 8, t.at, false);
    view.setUint32(e + 12, t.data.length, false);
    out.set(t.data, t.at);
  });
  return out;
}
