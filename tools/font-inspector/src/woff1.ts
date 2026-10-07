import { Unzlib, zlibSync } from 'fflate';
import { ByteReader } from './bytes';
import { FontInspectorError } from './errors';
import { MAX_SFNT_BYTES, MAX_TABLES } from './limits';
import { assembleSfnt, checkFileSize } from './sfnt';

/**
 * The reader for WOFF 1.0 files (W3C Recommendation, 13 December 2012): a 44-byte header, a 20-byte entry per table, and
 * each table either stored as it is (the compressed length equals the original length) or compressed with zlib.
 *
 * The tables are inflated through a streaming reader whose callback stops at the table's stated size. The one-shot
 * inflate with an output buffer is not used: it truncates instead of refusing and gives a hostile file no cap.
 */

export interface Woff1Table {
  tag: string;
  offset: number;
  compLength: number;
  origLength: number;
  checksum: number;
}

export interface Woff1Header {
  flavor: number;
  length: number;
  numTables: number;
  totalSfntSize: number;
  majorVersion: number;
  minorVersion: number;
  metaOffset: number;
  metaLength: number;
  metaOrigLength: number;
  privOffset: number;
  privLength: number;
  tables: Woff1Table[];
  /** The size the sfnt will have once unpacked, from the table lengths (never from totalSfntSize). */
  sfntSize: number;
  notes: string[];
}

const SIG_WOFF = 0x774f4646;

/** The compressed input is fed to the inflater in pieces of this size, so one piece can only expand so far. */
const FEED_BYTES = 4096;

/**
 * Reads the header and directory and checks everything that can be checked without inflating: the length field, the
 * number of tables against the cap and the bytes that remain, every table's range against the file, a compressed length
 * larger than the original length (invalid), blocks that overlap each other or the directory, and the total unpacked size
 * against the cap. The header's `totalSfntSize` is compared with the sum of the table lengths but never trusted.
 */
export function readWoff1Header(bytes: Uint8Array): Woff1Header {
  checkFileSize(bytes.length);
  if (bytes.length < 44) throw new FontInspectorError('This file is too short to hold a WOFF header.', 'File');
  const r = new ByteReader(bytes);
  if (r.u32(0) !== SIG_WOFF) throw new FontInspectorError('This file does not start as a WOFF file does.', 'File');
  const length = r.u32(8);
  if (length !== bytes.length) {
    throw new FontInspectorError('The length stated in the WOFF header is not the size of the file.', 'File', 8);
  }
  const numTables = r.u16(12);
  if (numTables === 0) throw new FontInspectorError('This WOFF file lists no tables.', 'File', 12);
  if (numTables > MAX_TABLES) {
    throw new FontInspectorError(
      `This WOFF file lists ${numTables.toLocaleString('en-US')} tables, more than the ${MAX_TABLES} this page reads.`,
      'File',
      12,
    );
  }
  if (!r.has(44, 20 * numTables)) {
    throw new FontInspectorError('The table directory of this WOFF file runs past the end of the file.', 'File', 44);
  }
  const notes: string[] = [];
  const totalSfntSize = r.u32(16);
  const tables: Woff1Table[] = [];
  const seen = new Set<string>();
  let sfntSize = 12 + 16 * numTables;
  const directoryEnd = 44 + 20 * numTables;
  let previousTag = '';
  let sorted = true;
  for (let i = 0; i < numTables; i++) {
    const e = 44 + 20 * i;
    const tag = r.tag(e);
    const offset = r.u32(e + 4);
    const compLength = r.u32(e + 8);
    const origLength = r.u32(e + 12);
    const checksum = r.u32(e + 16);
    if (seen.has(tag)) {
      throw new FontInspectorError('This WOFF file lists the same table tag twice.', 'File', e);
    }
    seen.add(tag);
    if (compLength > origLength) {
      throw new FontInspectorError(
        'A table in this WOFF file is stored longer than its original size, which the format does not allow.',
        'File',
        e + 8,
      );
    }
    if (!r.has(offset, compLength) || offset < directoryEnd) {
      throw new FontInspectorError(
        'A table in this WOFF file lies outside the file or inside its directory.',
        'File',
        e + 4,
      );
    }
    if (tag < previousTag) sorted = false;
    previousTag = tag;
    sfntSize += Math.ceil(origLength / 4) * 4;
    tables.push({ tag, offset, compLength, origLength, checksum });
  }
  // The unpacked size is a sum of values read from the file: cap it before anything is inflated.
  if (sfntSize > MAX_SFNT_BYTES) {
    throw new FontInspectorError(
      'The tables of this WOFF file add up to more than 30 MiB once unpacked, which this page does not allow.',
      'File',
    );
  }
  // Blocks must not overlap each other.
  const byOffset = [...tables].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < byOffset.length; i++) {
    const before = byOffset[i - 1]!;
    if (before.offset + before.compLength > byOffset[i]!.offset) {
      throw new FontInspectorError('Two tables in this WOFF file overlap.', 'File');
    }
  }
  if (!sorted) notes.push('The directory of this WOFF file is not in ascending tag order, which the format asks for.');
  if (totalSfntSize !== sfntSize) {
    notes.push(
      'The unpacked size stated in the WOFF header is not the size the tables add up to; the tables are trusted, not the header.',
    );
  }
  const metaOffset = r.u32(24);
  const metaLength = r.u32(28);
  const privOffset = r.u32(36);
  const privLength = r.u32(40);
  if (metaOffset !== 0 && !r.has(metaOffset, metaLength)) {
    notes.push('The metadata block of this WOFF file lies outside the file and is ignored.');
  }
  if (privOffset !== 0 && !r.has(privOffset, privLength)) {
    notes.push('The private data block of this WOFF file lies outside the file and is ignored.');
  }
  return {
    flavor: r.u32(4),
    length,
    numTables,
    totalSfntSize,
    majorVersion: r.u16(20),
    minorVersion: r.u16(22),
    metaOffset,
    metaLength,
    metaOrigLength: r.u32(32),
    privOffset,
    privLength,
    tables,
    sfntSize,
    notes,
  };
}

/**
 * Inflates one zlib table. The callback checks the running total against the stated size on every piece the inflater
 * hands over and throws as soon as it would pass it, so a hostile table is stopped long before it is fully inflated.
 * A table that inflates to fewer bytes than stated is refused too.
 */
export function inflateTable(compressed: Uint8Array, origLength: number): Uint8Array {
  const out = new Uint8Array(origLength);
  let written = 0;
  let finished = false;
  const tooLong = () =>
    new FontInspectorError(
      'A table in this WOFF file inflates to more than its stated size, so it was stopped.',
      'File',
    );
  const stream = new Unzlib((chunk, final) => {
    if (written + chunk.length > origLength) throw tooLong();
    out.set(chunk, written);
    written += chunk.length;
    if (final) finished = true;
  });
  try {
    for (let at = 0; at < compressed.length; at += FEED_BYTES) {
      const end = Math.min(compressed.length, at + FEED_BYTES);
      stream.push(compressed.subarray(at, end), end >= compressed.length);
    }
    if (compressed.length === 0) stream.push(new Uint8Array(0), true);
  } catch (err) {
    if (err instanceof FontInspectorError) throw err;
    throw new FontInspectorError('A table in this WOFF file is not valid compressed data.', 'File');
  }
  if (!finished || written !== origLength) {
    throw new FontInspectorError('A table in this WOFF file inflates to less than its stated size.', 'File');
  }
  return out;
}

/** Unpacks a WOFF 1.0 file into an sfnt. Every failure is a `FontInspectorError`; the caps apply before any inflate. */
export function unwrapWoff1(bytes: Uint8Array): Uint8Array {
  const header = readWoff1Header(bytes);
  const parts = header.tables.map((t) => {
    const stored = bytes.subarray(t.offset, t.offset + t.compLength);
    const data = t.compLength === t.origLength ? stored : inflateTable(stored, t.origLength);
    return { tag: t.tag, data, checksum: t.checksum };
  });
  return assembleSfnt(header.flavor, parts);
}

/**
 * The container checks of a WOFF 1.0 file this page has just made, before it is unpacked again: the header and directory
 * are read once more under every cap, and any note the reader makes (a directory out of tag order, a `totalSfntSize` that
 * is not the formula's value, a block outside the file) is a problem, because the writer leaves none. Anything the reader
 * refuses outright is a problem too. The list is empty when the container is as it should be.
 */
export function checkWoff1Output(bytes: Uint8Array): { header: Woff1Header | null; problems: string[] } {
  let header: Woff1Header;
  try {
    header = readWoff1Header(bytes);
  } catch (err) {
    if (err instanceof FontInspectorError) {
      return { header: null, problems: [`The converted WOFF file did not read back: ${err.message}`] };
    }
    throw err;
  }
  return {
    header,
    problems: header.notes.map((note) => `The converted WOFF file reads back with a note: ${note}`),
  };
}

const SFNT_FLAVORS = new Set([0x00010000, 0x74727565, 0x4f54544f]);

/**
 * Wraps a plain sfnt (TrueType or OpenType, not a collection) as a WOFF 1.0 file (W3C Recommendation, 13 December 2012):
 * the directory is sorted by tag, every table is compressed with zlib at level 9 and stored that way only when that makes
 * it smaller (otherwise it is stored as it is, with the compressed length equal to the original length), tables start on
 * 4-byte boundaries and are padded with zeros while the directory states the unpadded lengths, the checksum of each table
 * is the one the sfnt's directory states, and `totalSfntSize` is `12 + 16 * numTables + the sum of each table's length
 * rounded up to 4`. No metadata or private data block is written. The result is the same bytes every time for the same
 * input. Every failure is a `FontInspectorError`.
 */
export function wrapWoff1(sfnt: Uint8Array): Uint8Array {
  if (sfnt.length < 12) throw new FontInspectorError('This font is too short to hold a table directory.', 'File');
  const r = new ByteReader(sfnt);
  const flavor = r.u32(0);
  if (!SFNT_FLAVORS.has(flavor)) {
    throw new FontInspectorError(
      'This is not a TrueType or OpenType font, so it cannot be put in a WOFF file.',
      'File',
    );
  }
  const count = r.u16(4);
  if (count === 0) throw new FontInspectorError('This font lists no tables.', 'File', 4);
  if (count > MAX_TABLES) {
    throw new FontInspectorError(`This font lists more than the ${MAX_TABLES} tables this page converts.`, 'File', 4);
  }
  if (!r.has(12, 16 * count)) {
    throw new FontInspectorError('The font’s table directory runs past the end of the file.', 'File', 12);
  }
  const seen = new Set<string>();
  const tables: { tag: string; checksum: number; raw: Uint8Array; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    const e = 12 + 16 * i;
    const tag = r.tag(e);
    const offset = r.u32(e + 8);
    const length = r.u32(e + 12);
    if (seen.has(tag)) {
      throw new FontInspectorError('This font lists the same table twice, which a WOFF file cannot hold.', 'File', e);
    }
    seen.add(tag);
    if (!r.has(offset, length)) {
      throw new FontInspectorError(
        'A table of this font lies outside the file, so the font cannot be converted.',
        'File',
        e + 8,
      );
    }
    const raw = sfnt.subarray(offset, offset + length);
    const packed = zlibSync(raw, { level: 9 });
    tables.push({ tag, checksum: r.u32(e + 4), raw, data: packed.length < raw.length ? packed : raw });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const directoryEnd = 44 + 20 * count;
  let at = directoryEnd;
  let totalSfntSize = 12 + 16 * count;
  const placed = tables.map((t) => {
    const start = at;
    at += (t.data.length + 3) & ~3;
    totalSfntSize += (t.raw.length + 3) & ~3;
    return { ...t, start };
  });
  const out = new Uint8Array(at);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4646, false);
  view.setUint32(4, flavor, false);
  view.setUint32(8, at, false);
  view.setUint16(12, count, false);
  view.setUint32(16, totalSfntSize, false);
  // The version of the WOFF file follows the font's own revision (the head table's Fixed number), 1.0 when there is none.
  let major = 1;
  let minor = 0;
  const head = placed.find((t) => t.tag === 'head');
  if (head && head.raw.length >= 8) {
    major = (head.raw[4]! << 8) | head.raw[5]!;
    minor = (head.raw[6]! << 8) | head.raw[7]!;
  }
  view.setUint16(20, major, false);
  view.setUint16(22, minor, false);
  placed.forEach((t, i) => {
    const e = 44 + 20 * i;
    for (let k = 0; k < 4; k++) out[e + k] = t.tag.charCodeAt(k) & 0xff;
    view.setUint32(e + 4, t.start, false);
    view.setUint32(e + 8, t.data.length, false);
    view.setUint32(e + 12, t.raw.length, false);
    view.setUint32(e + 16, t.checksum, false);
    out.set(t.data, t.start);
  });
  return out;
}
