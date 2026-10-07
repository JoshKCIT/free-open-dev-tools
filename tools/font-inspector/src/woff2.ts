import { ByteReader } from './bytes';
import { FontInspectorError } from './errors';
import { MAX_COLLECTION_FONTS, MAX_EXPANSION_RATIO, MAX_SFNT_BYTES, MAX_TABLES } from './limits';
import { checkFileSize } from './sfnt';

/**
 * The reader for the WOFF2 header and table directory, and the pre-checks that run before the engine is called.
 *
 * WOFF2 packs every table into one Brotli stream. The engine that unpacks it trusts the sizes the header states, so
 * nothing reaches it until the header, the table directory and the layout of the blocks have been read here with every
 * size compared against the file and capped (W3C WOFF File Format 2.0, sections 3 to 5; the limits follow the reference
 * decoder's own: an output of at most 30 MiB and an expansion of at most 100 times).
 */

/** The 63 tags a table directory entry can name with a six-bit index (WOFF2 section 5.1); index 63 means a tag follows. */
export const WOFF2_KNOWN_TAGS: readonly string[] = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
  'EBSC',
  'JSTF',
  'MATH',
  'CBDT',
  'CBLC',
  'COLR',
  'CPAL',
  'SVG ',
  'sbix',
  'acnt',
  'avar',
  'bdat',
  'bloc',
  'bsln',
  'cvar',
  'fdsc',
  'feat',
  'fmtx',
  'fvar',
  'gvar',
  'hsty',
  'just',
  'lcar',
  'mort',
  'morx',
  'opbd',
  'prop',
  'trak',
  'Zapf',
  'Silf',
  'Glat',
  'Gloc',
  'Feat',
  'Sill',
];

export interface Woff2Table {
  tag: string;
  /** The six-bit index of a known tag, or 63 when the tag was spelled out. */
  tagIndex: number;
  /** The transform version, 0 to 3. */
  transformVersion: number;
  /** Whether the table is stored transformed (a transformLength follows in the directory). */
  transformed: boolean;
  /** The table's length once unpacked. */
  origLength: number;
  /** The length of the table's block in the decompressed stream. */
  streamLength: number;
}

export interface Woff2Header {
  /** The flavor tag as a four-character name when it is one of the known ones, otherwise 'other'. */
  flavor: 'truetype' | 'cff' | 'collection' | 'other';
  length: number;
  numTables: number;
  reserved: number;
  totalSfntSize: number;
  totalCompressedSize: number;
  majorVersion: number;
  minorVersion: number;
  metaOffset: number;
  metaLength: number;
  metaOrigLength: number;
  privOffset: number;
  privLength: number;
  tables: Woff2Table[];
  /** The sum of the tables' unpacked lengths. */
  sfntSize: number;
  /** The size of the decompressed stream, which the reference decoder compares with the file size. */
  streamSize: number;
  /** For a collection, how many fonts it holds; otherwise 1. */
  fontCount: number;
  /** True when the reference decoder would refuse the file for expanding more than 100 times (see exceedsExpansionRatio). */
  expansionExceeded: boolean;
  notes: string[];
}

const SIG_WOF2 = 0x774f4632;
const FLAVOR_TTCF = 0x74746366;
const FLAVOR_OTTO = 0x4f54544f;
const FLAVOR_TRUE = 0x74727565;

const round4 = (n: number): number => Math.ceil(n / 4) * 4;

/**
 * The reference decoder's plausibility rule, at its exact boundary. google/woff2 `src/woff2_dec.cc` at commit
 * 4721483ad780ee2b63cb787bfee4aa64b61a0446 declares `const float kMaxPlausibleCompressionRatio = 100.0;` (line 67) and, in
 * `ConvertWOFF2ToTTF` (lines 1368 to 1372), computes `(float) hdr.uncompressed_size / length` and fails the decode when that
 * is GREATER than the constant. So a ratio of exactly 100 is read and anything above is refused, and the division is done
 * in 32-bit floating point: both numbers are rounded to float first and the quotient is rounded to float again, which
 * `Math.fround` reproduces exactly. `streamSize` is `uncompressed_size`, the sum of the table blocks of the decompressed
 * stream, and `fileLength` is the length of the whole WOFF2 file.
 */
export function exceedsExpansionRatio(streamSize: number, fileLength: number): boolean {
  return Math.fround(Math.fround(streamSize) / Math.fround(fileLength)) > MAX_EXPANSION_RATIO;
}

function layoutProblem(): FontInspectorError {
  return new FontInspectorError('The blocks of this WOFF2 file do not follow each other as the format says.', 'File');
}

/** A UIntBase128 number: at most five bytes, no leading zero byte, no overflow past 32 bits. */
function readBase128(r: ByteReader, at: number): { value: number; next: number } {
  let accum = 0;
  for (let i = 0; i < 5; i++) {
    const byte = r.u8(at + i);
    if (i === 0 && byte === 0x80) {
      throw new FontInspectorError('A table size in the WOFF2 directory starts with a zero byte.', 'File', at);
    }
    if (accum >= 0x02000000) {
      throw new FontInspectorError('A table size in the WOFF2 directory is too large for 32 bits.', 'File', at + i);
    }
    accum = accum * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value: accum, next: at + i + 1 };
  }
  throw new FontInspectorError('A table size in the WOFF2 directory uses more than five bytes.', 'File', at);
}

/** A 255UInt16 number (WOFF2 section 6.1.1). */
function read255UInt16(r: ByteReader, at: number): { value: number; next: number } {
  const code = r.u8(at);
  if (code === 253) return { value: r.u16(at + 1), next: at + 3 };
  if (code === 255) return { value: r.u8(at + 1) + 253, next: at + 2 };
  if (code === 254) return { value: r.u8(at + 1) + 506, next: at + 2 };
  return { value: code, next: at + 1 };
}

function flavorName(value: number): Woff2Header['flavor'] {
  if (value === FLAVOR_TTCF) return 'collection';
  if (value === FLAVOR_OTTO) return 'cff';
  if (value === 0x00010000 || value === FLAVOR_TRUE) return 'truetype';
  return 'other';
}

/**
 * Reads the header and table directory of a WOFF2 file and checks them. Throws a `FontInspectorError` with a fixed
 * sentence for anything the reference decoder would refuse, and for any size past the caps, so the engine is never
 * given a file whose header or directory lies about its size. A `totalSfntSize` that claims too much is refused, never
 * trusted; a non-zero `reserved` field is only a note, as the specification says a decoder must not reject it.
 *
 * A file that would expand more than 100 times is refused, unless `allowHighRatio` is given: the re-read check of a file
 * this page has just made reads it that way, so it can say the plain sentence of its own, and sees `expansionExceeded`.
 */
export function readWoff2Header(bytes: Uint8Array, options: { allowHighRatio?: boolean } = {}): Woff2Header {
  checkFileSize(bytes.length);
  if (bytes.length < 48) {
    throw new FontInspectorError('This file is too short to hold a WOFF2 header.', 'File');
  }
  const r = new ByteReader(bytes);
  if (r.u32(0) !== SIG_WOF2) throw new FontInspectorError('This file does not start as a WOFF2 file does.', 'File');
  const flavorValue = r.u32(4);
  const length = r.u32(8);
  if (length !== bytes.length) {
    throw new FontInspectorError('The length stated in the WOFF2 header is not the size of the file.', 'File', 8);
  }
  const numTables = r.u16(12);
  if (numTables === 0) throw new FontInspectorError('This WOFF2 file lists no tables.', 'File', 12);
  if (numTables > MAX_TABLES) {
    throw new FontInspectorError(
      `This WOFF2 file lists ${numTables.toLocaleString('en-US')} tables, more than the ${MAX_TABLES} this page reads.`,
      'File',
      12,
    );
  }
  const notes: string[] = [];
  const reserved = r.u16(14);
  if (reserved !== 0) notes.push('The reserved field of the WOFF2 header is not zero; the format says to ignore it.');
  const totalSfntSize = r.u32(16);
  if (totalSfntSize > MAX_SFNT_BYTES) {
    throw new FontInspectorError(
      'The WOFF2 header says the font unpacks to more than 30 MiB, which this page does not allow.',
      'File',
      16,
    );
  }
  const totalCompressedSize = r.u32(20);
  const majorVersion = r.u16(24);
  const minorVersion = r.u16(26);
  const metaOffset = r.u32(28);
  const metaLength = r.u32(32);
  const metaOrigLength = r.u32(36);
  const privOffset = r.u32(40);
  const privLength = r.u32(44);
  if (metaOffset !== 0 && (metaOffset >= length || length - metaOffset < metaLength)) {
    throw new FontInspectorError('The metadata block of this WOFF2 file lies outside the file.', 'File', 28);
  }
  if (privOffset !== 0 && (privOffset >= length || length - privOffset < privLength)) {
    throw new FontInspectorError('The private data block of this WOFF2 file lies outside the file.', 'File', 40);
  }

  // The table directory: a flag byte, an optional four-byte tag and one or two UIntBase128 sizes per table.
  const tables: Woff2Table[] = [];
  let at = 48;
  let sfntSize = 0;
  let streamSize = 0;
  for (let i = 0; i < numTables; i++) {
    const flag = r.u8(at);
    at += 1;
    const tagIndex = flag & 0x3f;
    let tag: string;
    if (tagIndex === 63) {
      tag = r.tag(at);
      at += 4;
    } else {
      tag = WOFF2_KNOWN_TAGS[tagIndex] ?? '';
    }
    const transformVersion = (flag >> 6) & 3;
    const transformed = tag === 'glyf' || tag === 'loca' ? transformVersion === 0 : transformVersion !== 0;
    const orig = readBase128(r, at);
    at = orig.next;
    let streamLength = orig.value;
    if (transformed) {
      const transform = readBase128(r, at);
      at = transform.next;
      streamLength = transform.value;
      if (tag === 'loca' && streamLength !== 0) {
        throw new FontInspectorError(
          'The WOFF2 directory gives the loca table a transformed length that is not zero.',
          'File',
          at,
        );
      }
    }
    sfntSize += orig.value;
    streamSize += streamLength;
    tables.push({ tag, tagIndex, transformVersion, transformed, origLength: orig.value, streamLength });
  }

  // The caps come before anything else is done with the numbers: they are sums of values read from the file.
  if (sfntSize > MAX_SFNT_BYTES || streamSize > MAX_SFNT_BYTES) {
    throw new FontInspectorError(
      'The tables of this WOFF2 file add up to more than 30 MiB once unpacked, which this page does not allow.',
      'File',
    );
  }
  const expansionExceeded = exceedsExpansionRatio(streamSize, length);
  if (expansionExceeded && options.allowHighRatio !== true) {
    throw new FontInspectorError(
      `This WOFF2 file would expand more than ${MAX_EXPANSION_RATIO} times when unpacked, which font readers refuse.`,
      'File',
    );
  }

  let fontCount = 1;
  if (flavorValue === FLAVOR_TTCF) {
    // The collection directory: a version, the number of fonts and, per font, its tables as directory indexes.
    const version = r.u32(at);
    at += 4;
    if (version !== 0x00010000 && version !== 0x00020000) {
      throw new FontInspectorError(
        'The collection directory of this WOFF2 file has a version the format does not define.',
        'File',
        at - 4,
      );
    }
    const fonts = read255UInt16(r, at);
    at = fonts.next;
    if (fonts.value === 0)
      throw new FontInspectorError('The collection directory of this WOFF2 file lists no fonts.', 'File', at);
    if (fonts.value > MAX_COLLECTION_FONTS) {
      throw new FontInspectorError(
        `This WOFF2 collection holds ${fonts.value.toLocaleString('en-US')} fonts, more than the ${MAX_COLLECTION_FONTS} this page reads.`,
        'File',
      );
    }
    fontCount = fonts.value;
    for (let f = 0; f < fonts.value; f++) {
      const count = read255UInt16(r, at);
      at = count.next;
      if (count.value === 0)
        throw new FontInspectorError('A font in the collection directory lists no tables.', 'File', at);
      r.u32(at); // the font's flavor
      at += 4;
      for (let t = 0; t < count.value; t++) {
        const index = read255UInt16(r, at);
        at = index.next;
        if (index.value >= numTables) {
          throw new FontInspectorError(
            'A font in the collection directory names a table that is not in the table directory.',
            'File',
            at,
          );
        }
      }
    }
  }

  // The layout: the compressed block, then the metadata block, then the private block, ending at the file's end.
  let next = round4(at + totalCompressedSize);
  if (next > length) throw layoutProblem();
  if (metaOffset !== 0) {
    if (next !== metaOffset) throw layoutProblem();
    next = round4(metaOffset + metaLength);
  }
  if (privOffset !== 0) {
    if (next !== privOffset) throw layoutProblem();
    next = round4(privOffset + privLength);
  }
  if (next !== round4(length)) throw layoutProblem();
  if (totalCompressedSize === 0) {
    throw new FontInspectorError('This WOFF2 file holds no compressed data.', 'File');
  }

  return {
    flavor: flavorName(flavorValue),
    length,
    numTables,
    reserved,
    totalSfntSize,
    totalCompressedSize,
    majorVersion,
    minorVersion,
    metaOffset,
    metaLength,
    metaOrigLength,
    privOffset,
    privLength,
    tables,
    sfntSize,
    streamSize,
    fontCount,
    expansionExceeded,
    notes,
  };
}

/** The pre-checks that run before the engine: the header and directory read, every cap applied. */
export function planWoff2(bytes: Uint8Array): Woff2Header {
  return readWoff2Header(bytes);
}

/**
 * The container checks of a WOFF2 file this page has just made, before it is decoded again: the header and directory are
 * read once more under every cap, and the problems that would make the file wrong as an output are listed in plain words.
 * An output is never a collection, never expands more than 100 times when read, and carries no note of any kind (a note
 * means the header or directory is not the way the writer should have left it). Anything the reader refuses outright is a
 * problem too. The list is empty when the container is as it should be.
 */
export function checkWoff2Output(bytes: Uint8Array): { header: Woff2Header | null; problems: string[] } {
  let header: Woff2Header;
  try {
    header = readWoff2Header(bytes, { allowHighRatio: true });
  } catch (err) {
    if (err instanceof FontInspectorError) {
      return { header: null, problems: [`The converted WOFF2 file did not read back: ${err.message}`] };
    }
    throw err;
  }
  const problems: string[] = [];
  if (header.flavor === 'collection')
    problems.push('The converted WOFF2 file is a collection, which this page does not convert.');
  if (header.expansionExceeded) problems.push(EXPANSION_REFUSAL);
  for (const note of header.notes) problems.push(`The converted WOFF2 file reads back with a note: ${note}`);
  return { header, problems };
}

/** The sentence for a WOFF2 file that would expand more than 100 times when read: no reader would accept it. */
export const EXPANSION_REFUSAL = `A WOFF2 file made from this font would expand more than ${MAX_EXPANSION_RATIO} times when it is read, which font readers refuse, so it was not offered. Try WOFF instead.`;

/** The engine's unpack call, given by the caller so this package never imports the engine itself. */
export type Woff2Decompress = (input: Uint8Array) => Promise<Uint8Array>;

const SIGNATURES = new Set([0x00010000, 0x74727565, 0x4f54544f, 0x74746366, 0x74797031]);

/** Whether what the engine threw is the browser refusing to generate code at run time (never repeated, only recognised). */
export function isCodeGenerationRefusal(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  const text = err instanceof Error ? err.message : '';
  return name === 'EvalError' || /unsafe-eval|content security policy|code generation|blocked by csp/i.test(text);
}

/** Turns whatever the engine threw into one fixed sentence; nothing the engine says is repeated. */
function engineFailure(err: unknown): FontInspectorError {
  if (err instanceof FontInspectorError) return err;
  if (isCodeGenerationRefusal(err)) {
    return new FontInspectorError(
      'The browser did not allow this page to generate code at run time, which the WOFF2 engine needs, so the file could not be unpacked.',
      'File',
    );
  }
  return new FontInspectorError(
    'This WOFF2 file could not be unpacked. It is damaged, or it is not a WOFF2 file.',
    'File',
  );
}

/**
 * Unpacks a WOFF2 file into an sfnt with the engine the caller gives. The header and directory are checked first, so a
 * file that lies about its size never reaches the engine; whatever the engine returns is checked again (a size within the
 * cap and a font signature) before it is handed back. Every failure is a `FontInspectorError`.
 */
export async function unpackWoff2(
  bytes: Uint8Array,
  engine: Woff2Decompress,
): Promise<{ sfnt: Uint8Array; header: Woff2Header }> {
  const header = planWoff2(bytes);
  let out: Uint8Array;
  try {
    out = await engine(bytes);
  } catch (err) {
    throw engineFailure(err);
  }
  if (!(out instanceof Uint8Array) || out.length < 12 || out.length > MAX_SFNT_BYTES) {
    throw new FontInspectorError('This WOFF2 file did not unpack into a font.', 'File');
  }
  const signature = new ByteReader(out).u32(0);
  if (!SIGNATURES.has(signature)) {
    throw new FontInspectorError('This WOFF2 file did not unpack into a font.', 'File');
  }
  return { sfnt: out, header };
}
