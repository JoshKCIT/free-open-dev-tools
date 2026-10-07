/**
 * Builders for single font tables, used to put together small hostile and hand-made fonts. They are written here, apart from
 * the package, so a test never builds its input with the code it tests.
 */
import { buildSfnt } from './helpers';

export type Bytes = number[] | Uint8Array;

export const u8 = (n: number): number[] => [n & 0xff];
export const u16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
export const i16 = (n: number): number[] => u16(n & 0xffff);
export const u24 = (n: number): number[] => [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
export const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
export const fixed = (value: number): number[] => u32(Math.round(value * 65536) >>> 0);
export const f2dot14 = (value: number): number[] => i16(Math.round(value * 16384));
export const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0) & 0xff);

export function concat(...parts: Bytes[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) for (const b of part) out.push(b);
  return Uint8Array.from(out);
}

export function utf16be(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) out.push(...u16(text.charCodeAt(i)));
  return out;
}

export interface NameRecordSpec {
  platform: number;
  encoding: number;
  language: number;
  id: number;
  raw: Bytes;
}

/** A name table, version 0, with the strings stored once in the order given. */
export function nameTable(records: NameRecordSpec[]): Uint8Array {
  const storage: number[] = [];
  const entries: number[] = [];
  for (const r of records) {
    const offset = storage.length;
    for (const b of r.raw) storage.push(b);
    entries.push(
      ...u16(r.platform),
      ...u16(r.encoding),
      ...u16(r.language),
      ...u16(r.id),
      ...u16(r.raw.length),
      ...u16(offset),
    );
  }
  return concat(u16(0), u16(records.length), u16(6 + 12 * records.length), entries, storage);
}

/** A name table whose n records all point at one string, to test that decoding the same bytes again and again is capped. */
export function sharedStringNameTable(count: number, stringBytes: Bytes): Uint8Array {
  const entries: number[] = [];
  for (let i = 0; i < count; i++) {
    entries.push(...u16(3), ...u16(1), ...u16(0x409), ...u16(i % 20), ...u16(stringBytes.length), ...u16(0));
  }
  return concat(u16(0), u16(count), u16(6 + 12 * count), entries, stringBytes);
}

export interface Head {
  unitsPerEm?: number;
  indexToLocFormat?: number;
  fontRevision?: number;
  xMin?: number;
}

export function headTable(h: Head = {}): Uint8Array {
  return concat(
    u32(0x00010000),
    fixed(h.fontRevision ?? 1),
    u32(0),
    u32(0x5f0f3cf5),
    u16(0),
    u16(h.unitsPerEm ?? 1000),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    i16(h.xMin ?? 0),
    i16(0),
    i16(1000),
    i16(1000),
    u16(0),
    u16(8),
    i16(2),
    i16(h.indexToLocFormat ?? 1),
    i16(0),
  );
}

export function maxpTable(numGlyphs: number): Uint8Array {
  return concat(u32(0x00005000), u16(numGlyphs));
}

export function hheaTable(numberOfHMetrics: number, ascent = 800, descent = -200): Uint8Array {
  return concat(
    u32(0x00010000),
    i16(ascent),
    i16(descent),
    i16(0),
    u16(1000),
    new Uint8Array(22),
    u16(numberOfHMetrics),
  );
}

/** An hmtx table: [advance, left side bearing] for each glyph (all of them are long metrics). */
export function hmtxTable(metrics: [number, number][]): Uint8Array {
  return concat(...metrics.map(([advance, lsb]) => concat(u16(advance), i16(lsb))));
}

export interface Pt {
  x: number;
  y: number;
  on: boolean;
}

/** A simple glyph: contours of points, with 16-bit coordinate deltas. */
export function simpleGlyph(contours: Pt[][]): Uint8Array {
  const all = contours.flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const header = concat(
    i16(contours.length),
    i16(Math.min(...xs)),
    i16(Math.min(...ys)),
    i16(Math.max(...xs)),
    i16(Math.max(...ys)),
  );
  const ends: number[] = [];
  let at = -1;
  for (const c of contours) {
    at += c.length;
    ends.push(...u16(at));
  }
  const flags = all.map((p) => (p.on ? 1 : 0));
  const dx: number[] = [];
  const dy: number[] = [];
  let px = 0;
  let py = 0;
  for (const p of all) {
    dx.push(...i16(p.x - px));
    dy.push(...i16(p.y - py));
    px = p.x;
    py = p.y;
  }
  return concat(header, ends, u16(0), flags, dx, dy);
}

export interface Component {
  glyph: number;
  dx?: number;
  dy?: number;
  /** One scale, or [xScale, yScale], or the four numbers of a 2x2 transform [xx, yx, xy, yy]. */
  scale?: number | [number, number] | [number, number, number, number];
  flags?: number;
}

/** A composite glyph made of components (arguments are 16-bit x and y offsets). */
export function compositeGlyph(components: Component[]): Uint8Array {
  const out: number[] = [...i16(-1), ...i16(0), ...i16(0), ...i16(1000), ...i16(1000)];
  components.forEach((c, i) => {
    let flags = 0x0001 | 0x0002 | (c.flags ?? 0);
    const transform: number[] = [];
    if (typeof c.scale === 'number') {
      flags |= 0x0008;
      transform.push(...f2dot14(c.scale));
    } else if (c.scale && c.scale.length === 2) {
      flags |= 0x0040;
      transform.push(...f2dot14(c.scale[0]), ...f2dot14(c.scale[1]));
    } else if (c.scale && c.scale.length === 4) {
      flags |= 0x0080;
      for (const s of c.scale) transform.push(...f2dot14(s));
    }
    if (i < components.length - 1) flags |= 0x0020;
    out.push(...u16(flags), ...u16(c.glyph), ...i16(c.dx ?? 0), ...i16(c.dy ?? 0), ...transform);
  });
  return Uint8Array.from(out);
}

/** glyf and loca (long offsets) for a list of glyph byte strings; each glyph is padded to four bytes. */
export function glyfAndLoca(glyphs: Bytes[]): { glyf: Uint8Array; loca: Uint8Array } {
  const body: number[] = [];
  const offsets: number[] = [0];
  for (const g of glyphs) {
    for (const b of g) body.push(b);
    while (body.length % 4 !== 0) body.push(0);
    offsets.push(body.length);
  }
  return { glyf: Uint8Array.from(body), loca: concat(...offsets.map((o) => u32(o))) };
}

/** A cmap table with one format 12 subtable (platform 3, encoding 10) of [start, end, first glyph] groups. */
export function cmap12(groups: [number, number, number][]): Uint8Array {
  const body = concat(...groups.map(([s, e, g]) => concat(u32(s), u32(e), u32(g))));
  const subtable = concat(u16(12), u16(0), u32(16 + body.length), u32(0), u32(groups.length), body);
  return concat(u16(0), u16(1), u16(3), u16(10), u32(12), subtable);
}

/** A cmap table that claims `groups` format 12 groups but holds none of them (a lying count). */
export function cmap12Lying(groups: number): Uint8Array {
  const subtable = concat(u16(12), u16(0), u32(16), u32(0), u32(groups));
  return concat(u16(0), u16(1), u16(3), u16(10), u32(12), subtable);
}

/** A cmap table with one format 4 subtable of [start, end, idDelta] segments (the last one must end at 0xFFFF). */
export function cmap4(segments: [number, number, number][]): Uint8Array {
  const n = segments.length;
  const body = concat(
    ...segments.map(([, e]) => u16(e)),
    u16(0),
    ...segments.map(([s]) => u16(s)),
    ...segments.map(([, , d]) => i16(d)),
    ...segments.map(() => u16(0)),
  );
  const length = 14 + body.length;
  const subtable = concat(u16(4), u16(length), u16(0), u16(n * 2), u16(0), u16(0), u16(0), body);
  return concat(u16(0), u16(1), u16(3), u16(1), u32(12), subtable);
}

export interface FeatureSpec {
  tag: string;
  /** The script and language each feature is listed under: [script tag, language tag or 'dflt']. */
  uses: [string, string][];
}

/**
 * A GSUB or GPOS table with a script list, a feature list and an empty lookup list. Features are listed in the order
 * given; each script gets one language system per language it is used with, listing the features that use it.
 */
export function layoutTable(features: FeatureSpec[]): Uint8Array {
  const featureTags = features.map((f) => f.tag);
  // feature list: count, records (tag, offset), then one feature table (params 0, lookups 0) each
  const featureTables = features.map(() => concat(u16(0), u16(0)));
  const featureRecordsSize = 2 + 6 * features.length;
  let featureOffset = featureRecordsSize;
  const featureList = concat(
    u16(features.length),
    ...features.map((f, i) => {
      const record = concat(ascii(f.tag), u16(featureOffset));
      featureOffset += featureTables[i]!.length;
      return record;
    }),
    ...featureTables,
  );
  // script list
  const scripts = new Map<string, Map<string, number[]>>();
  features.forEach((f, index) => {
    for (const [script, lang] of f.uses) {
      if (!scripts.has(script)) scripts.set(script, new Map());
      const langs = scripts.get(script)!;
      if (!langs.has(lang)) langs.set(lang, []);
      langs.get(lang)!.push(index);
    }
  });
  const scriptTables: Uint8Array[] = [];
  for (const [, langs] of scripts) {
    const langSys = (indexes: number[]): Uint8Array =>
      concat(u16(0), u16(0xffff), u16(indexes.length), ...indexes.map((i) => u16(i)));
    const named = [...langs].filter(([l]) => l !== 'dflt');
    const dflt = langs.get('dflt');
    const dfltBytes = dflt ? langSys(dflt) : new Uint8Array(0);
    const headerSize = 4 + 6 * named.length;
    let cursor = headerSize + dfltBytes.length;
    const records: number[] = [];
    const bodies: Uint8Array[] = [];
    for (const [l, indexes] of named) {
      const bytes = langSys(indexes);
      records.push(...ascii(l.padEnd(4, ' ')), ...u16(cursor));
      bodies.push(bytes);
      cursor += bytes.length;
    }
    scriptTables.push(concat(u16(dflt ? headerSize : 0), u16(named.length), records, dfltBytes, ...bodies));
  }
  const scriptList = (() => {
    let at = 2 + 6 * scripts.size;
    const records: number[] = [];
    [...scripts.keys()].forEach((tag, i) => {
      records.push(...ascii(tag.padEnd(4, ' ')), ...u16(at));
      at += scriptTables[i]!.length;
    });
    return concat(u16(scripts.size), records, ...scriptTables);
  })();
  const lookupList = concat(u16(0));
  const headerSize = 10;
  const scriptOffset = headerSize;
  const featureListOffset = scriptOffset + scriptList.length;
  const lookupOffset = featureListOffset + featureList.length;
  void featureTags;
  return concat(
    u32(0x00010000),
    u16(scriptOffset),
    u16(featureListOffset),
    u16(lookupOffset),
    scriptList,
    featureList,
    lookupList,
  );
}

/** A post table, format 2, with glyph names beyond the 258 standard ones. */
export function postTable2(names: string[]): Uint8Array {
  const indexes = names.map((_, i) => 258 + i);
  const strings = names.map((n) => concat(u8(n.length), ascii(n)));
  return concat(
    u32(0x00020000),
    u32(0),
    i16(0),
    i16(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u16(names.length),
    ...indexes.map((i) => u16(i)),
    ...strings,
  );
}

/** A font made of the given tables with TrueType flavor. */
export function fontOf(tables: [string, Uint8Array][]): Uint8Array {
  return buildSfnt(0x00010000, tables);
}

/** A small TrueType font of glyphs given as byte strings, with the head, maxp, hhea, hmtx, glyf and loca tables. */
export function glyphFont(glyphs: Bytes[], extra: [string, Uint8Array][] = [], lsbs?: number[]): Uint8Array {
  const { glyf, loca } = glyfAndLoca(glyphs);
  return fontOf([
    ['head', headTable({ indexToLocFormat: 1 })],
    ['maxp', maxpTable(glyphs.length)],
    ['hhea', hheaTable(glyphs.length)],
    ['hmtx', hmtxTable(glyphs.map((_, i) => [600, lsbs?.[i] ?? 0] as [number, number]))],
    ['glyf', glyf],
    ['loca', loca],
    ...extra,
  ]);
}

/** A rectangle contour. */
export const rectangle = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0, on: true },
  { x: x0, y: y1, on: true },
  { x: x1, y: y1, on: true },
  { x: x1, y: y0, on: true },
];

/**
 * A CFF table (not CFF2) of charstrings with optional global and local subroutines. Every offset is written with a fixed
 * five-byte number so the layout needs one pass.
 */
export function cffTable(
  charstrings: Bytes[],
  options: { subrs?: Bytes[]; gsubrs?: Bytes[]; glyphNames?: string[] } = {},
): Uint8Array {
  const index = (items: Bytes[]): Uint8Array => {
    if (items.length === 0) return Uint8Array.from(u16(0));
    const offsets = [1];
    for (const item of items) offsets.push(offsets[offsets.length - 1]! + item.length);
    return concat(u16(items.length), u8(4), ...offsets.map((o) => u32(o)), ...items);
  };
  const int5 = (n: number): number[] => [29, ...u32(n >>> 0)];
  const header = [1, 0, 4, 4];
  const nameIndex = index([ascii('T')]);
  const strings = (options.glyphNames ?? []).map((n) => ascii(n));
  const stringIndex = index(strings);
  const gsubrIndex = index(options.gsubrs ?? []);
  const csIndex = index(charstrings);
  const subrIndex = index(options.subrs ?? []);
  // charset: format 0 listing SIDs 391.. for glyphs 1.. when names are given
  const charset = options.glyphNames
    ? concat(u8(0), ...options.glyphNames.slice(1).map((_, i) => u16(391 + i + 1)))
    : new Uint8Array(0);
  const topDictFor = (csOffset: number, privOffset: number, charsetOffset: number): Uint8Array =>
    concat(
      int5(csOffset),
      [17],
      int5(privateSize),
      int5(privOffset),
      [18],
      options.glyphNames ? concat(int5(charsetOffset), [15]) : new Uint8Array(0),
    );
  const privateDict = (subrsOffset: number): Uint8Array => concat(int5(subrsOffset), [19]);
  const privateSize = privateDict(0).length;
  const topDictIndexLen = index([topDictFor(0, 0, 0)]).length;
  const base = header.length + nameIndex.length + topDictIndexLen + stringIndex.length + gsubrIndex.length;
  const csOffset = base;
  const charsetOffset = csOffset + csIndex.length;
  const privOffset = charsetOffset + charset.length;
  const topDictIndex = index([topDictFor(csOffset, privOffset, charsetOffset)]);
  const priv = privateDict(privateSize);
  return concat(header, nameIndex, topDictIndex, stringIndex, gsubrIndex, csIndex, charset, priv, subrIndex);
}

/** Charstring integer operands: -107..107 as one byte, otherwise the three-byte shortint. */
export const cs = (n: number): number[] => (n >= -107 && n <= 107 ? [n + 139] : [28, ...i16(n)]);
