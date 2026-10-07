import { ByteReader } from './bytes';
import { tableBytes, type SfntFont, type TableEntry } from './sfnt';

/** Seconds from 1904-01-01 (the font epoch) to 1970-01-01. */
const EPOCH_OFFSET_SECONDS = 2_082_844_800;

export interface HeadInfo {
  /** The font revision, a 16.16 fixed point number read exactly. */
  fontRevision: number;
  flags: number;
  unitsPerEm: number;
  created: string | null;
  modified: string | null;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  macStyle: number;
  lowestRecPPEM: number;
  /** 0 for short glyph offsets in `loca`, 1 for long ones. */
  indexToLocFormat: number;
  checkSumAdjustment: number;
}

export interface HheaInfo {
  ascent: number;
  descent: number;
  lineGap: number;
  advanceWidthMax: number;
  numberOfHMetrics: number;
}

export interface Os2Info {
  version: number;
  weightClass: number;
  widthClass: number;
  fsType: number;
  typoAscender: number;
  typoDescender: number;
  typoLineGap: number;
  winAscent: number;
  winDescent: number;
  xHeight: number | null;
  capHeight: number | null;
  vendor: string;
  fsSelection: number;
}

export interface PostInfo {
  format: number;
  italicAngle: number;
  underlinePosition: number;
  underlineThickness: number;
  isFixedPitch: boolean;
}

export interface Metrics {
  head: HeadInfo | null;
  hhea: HheaInfo | null;
  os2: Os2Info | null;
  numGlyphs: number | null;
  post: PostInfo | null;
}

/** A LONGDATETIME (seconds since 1904-01-01 UTC) as `YYYY-MM-DD HH:MM:SS UTC`; null for zero or a date out of range. */
export function longDateTime(r: ByteReader, offset: number): string | null {
  const seconds = r.u32(offset) * 4_294_967_296 + r.u32(offset + 4);
  if (seconds === 0) return null;
  const ms = (seconds - EPOCH_OFFSET_SECONDS) * 1000;
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime()) || Math.abs(ms) > 8.64e15) return null;
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

function readHead(bytes: Uint8Array, entry: TableEntry | undefined): HeadInfo | null {
  const data = tableBytes(bytes, entry);
  if (!data || data.length < 54) return null;
  const r = new ByteReader(data);
  return {
    fontRevision: r.fixed(4),
    checkSumAdjustment: r.u32(8),
    flags: r.u16(16),
    unitsPerEm: r.u16(18),
    created: longDateTime(r, 20),
    modified: longDateTime(r, 28),
    xMin: r.i16(36),
    yMin: r.i16(38),
    xMax: r.i16(40),
    yMax: r.i16(42),
    macStyle: r.u16(44),
    lowestRecPPEM: r.u16(46),
    indexToLocFormat: r.i16(50),
  };
}

function readHhea(bytes: Uint8Array, entry: TableEntry | undefined): HheaInfo | null {
  const data = tableBytes(bytes, entry);
  if (!data || data.length < 36) return null;
  const r = new ByteReader(data);
  return {
    ascent: r.i16(4),
    descent: r.i16(6),
    lineGap: r.i16(8),
    advanceWidthMax: r.u16(10),
    numberOfHMetrics: r.u16(34),
  };
}

function readOs2(bytes: Uint8Array, entry: TableEntry | undefined): Os2Info | null {
  const data = tableBytes(bytes, entry);
  if (!data || data.length < 68) return null;
  const r = new ByteReader(data);
  const version = r.u16(0);
  const vendorChars: string[] = [];
  for (let i = 0; i < 4; i++) {
    const code = r.u8(58 + i);
    vendorChars.push(code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : '�');
  }
  const hasTypo = data.length >= 78;
  const hasWin = data.length >= 78;
  return {
    version,
    weightClass: r.u16(4),
    widthClass: r.u16(6),
    fsType: r.u16(8),
    typoAscender: hasTypo ? r.i16(68) : 0,
    typoDescender: hasTypo ? r.i16(70) : 0,
    typoLineGap: hasTypo ? r.i16(72) : 0,
    winAscent: hasWin ? r.u16(74) : 0,
    winDescent: hasWin ? r.u16(76) : 0,
    xHeight: version >= 2 && data.length >= 90 ? r.i16(86) : null,
    capHeight: version >= 2 && data.length >= 90 ? r.i16(88) : null,
    vendor: vendorChars.join(''),
    fsSelection: r.u16(62),
  };
}

function readPost(bytes: Uint8Array, entry: TableEntry | undefined): PostInfo | null {
  const data = tableBytes(bytes, entry);
  if (!data || data.length < 16) return null;
  const r = new ByteReader(data);
  return {
    format: r.u32(0) / 65536,
    italicAngle: r.fixed(4),
    underlinePosition: r.i16(8),
    underlineThickness: r.i16(10),
    isFixedPitch: r.u32(12) !== 0,
  };
}

/** Reads the small tables that describe a font as a whole. A table that is absent or too short gives null. */
export function readMetrics(bytes: Uint8Array, font: SfntFont): Metrics {
  const maxp = tableBytes(bytes, font.tables.get('maxp'));
  const numGlyphs = maxp && maxp.length >= 6 ? new ByteReader(maxp).u16(4) : null;
  return {
    head: readHead(bytes, font.tables.get('head')),
    hhea: readHhea(bytes, font.tables.get('hhea')),
    os2: readOs2(bytes, font.tables.get('OS/2')),
    numGlyphs,
    post: readPost(bytes, font.tables.get('post')),
  };
}

export interface Embedding {
  fsType: number;
  /** The usage permission the lowest four bits state, in plain words. */
  permission: string;
  noSubsetting: boolean;
  bitmapOnly: boolean;
}

/**
 * What the OS/2 `fsType` flags say, in plain words and without any claim about what a licence allows: bits 0 to 3 are
 * the usage permissions (valid values 0, 2, 4 and 8), bit 8 asks for no subsetting and bit 9 for bitmap embedding only.
 */
export function describeEmbedding(fsType: number): Embedding {
  const low = fsType & 0x000f;
  let permission: string;
  if (low === 0) permission = 'Installable embedding: the flags place no limit on embedding';
  else if (low === 2) permission = 'Restricted licence embedding: the flags ask that the font is not embedded';
  else if (low === 4)
    permission = 'Preview and print embedding: the flags allow it for viewing and printing documents only';
  else if (low === 8) permission = 'Editable embedding: the flags allow it for documents that can be edited';
  else permission = 'A permission value the format does not define';
  return { fsType, permission, noSubsetting: (fsType & 0x0100) !== 0, bitmapOnly: (fsType & 0x0200) !== 0 };
}

/**
 * A note when the three places that state a font's vertical metrics (the hhea table, the OS/2 typographic values and the
 * OS/2 Windows values) do not agree, or null when they do or when a table is missing.
 */
export function verticalMetricsNote(m: Metrics): string | null {
  if (!m.hhea || !m.os2) return null;
  const { hhea, os2 } = m;
  const agree =
    hhea.ascent === os2.typoAscender &&
    hhea.descent === os2.typoDescender &&
    hhea.lineGap === os2.typoLineGap &&
    hhea.ascent === os2.winAscent &&
    -hhea.descent === os2.winDescent;
  if (agree) return null;
  return (
    `The vertical metrics are not the same in every table: hhea ascent ${hhea.ascent}, descent ${hhea.descent}, line gap ${hhea.lineGap}; ` +
    `OS/2 typographic ${os2.typoAscender}, ${os2.typoDescender}, ${os2.typoLineGap}; OS/2 Windows ${os2.winAscent} and ${os2.winDescent}. ` +
    'Different systems read different sets, so text can sit at slightly different heights.'
  );
}
