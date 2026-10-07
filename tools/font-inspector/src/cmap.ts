import { ByteReader } from './bytes';
import { FontInspectorError } from './errors';
import { MAX_CMAP_GROUPS, MAX_CMAP_STEPS } from './limits';

/** The highest code point Unicode defines. */
const MAX_CODE_POINT = 0x10ffff;

/** Most code points listed from one variation selector's default or non-default list. */
const MAX_VS_LISTED = 1000;

export interface CmapSubtable {
  platform: number;
  encoding: number;
  format: number;
  language: number;
  /** How many code points the subtable maps to a glyph other than 0. */
  entries: number;
}

export interface VariationSelector {
  selector: number;
  /** Code points that use the default glyph with this selector, expanded from ranges (at most MAX_VS_LISTED listed). */
  defaults: number[];
  /** How many default code points there are in all. */
  defaultCount: number;
  /** Code points with their own glyph for this selector, as [code point, glyph] pairs (at most MAX_VS_LISTED listed). */
  nonDefaults: [number, number][];
  nonDefaultCount: number;
}

export interface CmapResult {
  /** Code point to glyph, the first subtable that maps a code point wins; glyph 0 is never kept. */
  map: Map<number, number>;
  subtables: CmapSubtable[];
  variationSelectors: VariationSelector[];
  notes: string[];
}

/** A step budget shared by all subtables of one cmap, so overlapping ranges cannot repeat work without end. */
class Budget {
  left = MAX_CMAP_STEPS;
  take(n: number): boolean {
    if (n > this.left) {
      this.left = 0;
      return false;
    }
    this.left -= n;
    return true;
  }
}

function setIfNew(map: Map<number, number>, code: number, glyph: number): boolean {
  if (glyph === 0 || map.has(code)) return false;
  map.set(code, glyph);
  return true;
}

function readFormat0(r: ByteReader, at: number, map: Map<number, number>, budget: Budget): number {
  let entries = 0;
  if (!budget.take(256)) return 0;
  for (let c = 0; c < 256; c++) if (setIfNew(map, c, r.u8(at + 6 + c))) entries++;
  return entries;
}

function readFormat4(r: ByteReader, at: number, length: number, map: Map<number, number>, budget: Budget): number {
  const segX2 = r.u16(at + 6);
  const segCount = segX2 >> 1;
  const endOf = at + 14;
  const startOf = endOf + segX2 + 2;
  const deltaOf = startOf + segX2;
  const rangeOf = deltaOf + segX2;
  // The four arrays need 8 bytes per segment plus the reserved pad: compare with the subtable before reading any.
  if (!r.has(endOf, segX2 * 4 + 2)) {
    throw new FontInspectorError(
      'A character map subtable of format 4 states more segments than it has room for.',
      'File',
      at + 6,
    );
  }
  const subtableEnd = length > 0 ? at + length : r.length;
  let entries = 0;
  for (let k = 0; k < segCount; k++) {
    const end = r.u16(endOf + 2 * k);
    const start = r.u16(startOf + 2 * k);
    if (start > end || start === 0xffff) continue;
    const delta = r.i16(deltaOf + 2 * k);
    const rangeOffset = r.u16(rangeOf + 2 * k);
    if (!budget.take(end - start + 1)) return entries;
    for (let c = start; c <= end; c++) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (c + delta) & 0xffff;
      } else {
        const where = rangeOf + 2 * k + rangeOffset + 2 * (c - start);
        if (!r.has(where, 2) || where + 2 > Math.max(subtableEnd, r.length)) continue;
        const index = r.u16(where);
        glyph = index === 0 ? 0 : (index + delta) & 0xffff;
      }
      if (c === 0xffff) continue;
      if (setIfNew(map, c, glyph)) entries++;
    }
  }
  return entries;
}

function readFormat6(r: ByteReader, at: number, map: Map<number, number>, budget: Budget): number {
  const first = r.u16(at + 6);
  const count = r.u16(at + 8);
  if (!r.has(at + 10, 2 * count)) {
    throw new FontInspectorError(
      'A character map subtable of format 6 states more glyphs than it has room for.',
      'File',
      at + 8,
    );
  }
  if (!budget.take(count)) return 0;
  let entries = 0;
  for (let k = 0; k < count; k++) if (setIfNew(map, first + k, r.u16(at + 10 + 2 * k))) entries++;
  return entries;
}

function readFormat10(r: ByteReader, at: number, map: Map<number, number>, budget: Budget): number {
  const first = r.u32(at + 12);
  const count = r.u32(at + 16);
  if (!r.has(at + 20, 2 * count)) {
    throw new FontInspectorError(
      'A character map subtable of format 10 states more glyphs than it has room for.',
      'File',
      at + 16,
    );
  }
  if (!budget.take(count)) return 0;
  let entries = 0;
  for (let k = 0; k < count; k++) {
    const code = first + k;
    if (code > MAX_CODE_POINT) break;
    if (setIfNew(map, code, r.u16(at + 20 + 2 * k))) entries++;
  }
  return entries;
}

/** Formats 12 (ranges that map to consecutive glyphs) and 13 (ranges that map to one glyph). */
function readGroups(r: ByteReader, at: number, format: number, map: Map<number, number>, budget: Budget): number {
  const groups = r.u32(at + 12);
  if (groups > MAX_CMAP_GROUPS) {
    throw new FontInspectorError(
      `A character map subtable states ${groups.toLocaleString('en-US')} groups, more than the ${MAX_CMAP_GROUPS.toLocaleString('en-US')} this page reads.`,
      'File',
      at + 12,
    );
  }
  if (!r.has(at + 16, 12 * groups)) {
    throw new FontInspectorError('A character map subtable states more groups than it has room for.', 'File', at + 12);
  }
  let entries = 0;
  for (let g = 0; g < groups; g++) {
    const start = r.u32(at + 16 + 12 * g);
    const end = Math.min(r.u32(at + 20 + 12 * g), MAX_CODE_POINT);
    const glyph = r.u32(at + 24 + 12 * g);
    if (start > end) continue;
    if (!budget.take(end - start + 1)) return entries;
    for (let c = start; c <= end; c++) {
      if (setIfNew(map, c, format === 12 ? glyph + (c - start) : glyph)) entries++;
    }
  }
  return entries;
}

function readFormat14(r: ByteReader, at: number, out: VariationSelector[]): number {
  const records = r.u32(at + 6);
  if (!r.has(at + 10, 11 * records)) {
    throw new FontInspectorError(
      'A character map subtable of format 14 states more selectors than it has room for.',
      'File',
      at + 6,
    );
  }
  for (let k = 0; k < records; k++) {
    const rec = at + 10 + 11 * k;
    const selector = r.u24(rec);
    const defaultOffset = r.u32(rec + 3);
    const nonDefaultOffset = r.u32(rec + 7);
    const entry: VariationSelector = { selector, defaults: [], defaultCount: 0, nonDefaults: [], nonDefaultCount: 0 };
    if (defaultOffset !== 0) {
      const base = at + defaultOffset;
      const ranges = r.u32(base);
      if (r.has(base + 4, 4 * ranges)) {
        for (let m = 0; m < ranges; m++) {
          const start = r.u24(base + 4 + 4 * m);
          const extra = r.u8(base + 7 + 4 * m);
          entry.defaultCount += extra + 1;
          for (let c = 0; c <= extra && entry.defaults.length < MAX_VS_LISTED; c++) entry.defaults.push(start + c);
        }
      }
    }
    if (nonDefaultOffset !== 0) {
      const base = at + nonDefaultOffset;
      const mappings = r.u32(base);
      if (r.has(base + 4, 5 * mappings)) {
        entry.nonDefaultCount = mappings;
        const listed = Math.min(mappings, MAX_VS_LISTED);
        for (let m = 0; m < listed; m++) entry.nonDefaults.push([r.u24(base + 4 + 5 * m), r.u16(base + 7 + 5 * m)]);
      }
    }
    out.push(entry);
  }
  return records;
}

/**
 * Reads a cmap table: formats 0, 4, 6, 10, 12, 13 and 14. The first subtable to map a code point decides its glyph, as
 * fontTools reads it. A subtable that cannot be read (a count larger than its bytes or past the cap) is left out with a
 * note and the others are still read; the total number of code point steps over all subtables is capped.
 */
export function readCmap(bytes: Uint8Array, offset: number, length: number): CmapResult {
  const r = new ByteReader(bytes);
  const map = new Map<number, number>();
  const subtables: CmapSubtable[] = [];
  const variationSelectors: VariationSelector[] = [];
  const notes: string[] = [];
  if (length < 4)
    return { map, subtables, variationSelectors, notes: ['The cmap table is too short to hold a header.'] };
  const count = r.u16(offset + 2);
  const room = Math.floor((length - 4) / 8);
  const listed = Math.min(count, room);
  if (count > room)
    notes.push('The cmap table states more subtables than it has room for; the ones that fit are read.');
  const budget = new Budget();
  const seenOffsets = new Set<number>();
  for (let i = 0; i < listed; i++) {
    const rec = offset + 4 + 8 * i;
    const platform = r.u16(rec);
    const encoding = r.u16(rec + 2);
    const sub = offset + r.u32(rec + 4);
    try {
      if (!r.has(sub, 6))
        throw new FontInspectorError('A character map subtable lies outside the table.', 'File', rec + 4);
      const format = r.u16(sub);
      let language = 0;
      let entries = 0;
      if (format === 14) {
        if (seenOffsets.has(sub)) continue;
        seenOffsets.add(sub);
        readFormat14(r, sub, variationSelectors);
      } else if (format === 12 || format === 13) {
        language = r.u32(sub + 8);
        entries = readGroups(r, sub, format, map, budget);
      } else if (format === 10) {
        language = r.u32(sub + 8);
        entries = readFormat10(r, sub, map, budget);
      } else if (format === 4) {
        language = r.u16(sub + 4);
        entries = readFormat4(r, sub, r.u16(sub + 2), map, budget);
      } else if (format === 6) {
        language = r.u16(sub + 4);
        entries = readFormat6(r, sub, map, budget);
      } else if (format === 0) {
        language = r.u16(sub + 4);
        entries = readFormat0(r, sub, map, budget);
      } else {
        notes.push(`A character map subtable of format ${format} is not read by this page.`);
        subtables.push({ platform, encoding, format, language: 0, entries: 0 });
        continue;
      }
      subtables.push({ platform, encoding, format, language, entries });
    } catch (err) {
      if (!(err instanceof FontInspectorError)) throw err;
      notes.push(err.message);
    }
  }
  if (budget.left === 0) {
    notes.push(
      'The character map has so many overlapping ranges that reading stopped early; the list may be incomplete.',
    );
  }
  return { map, subtables, variationSelectors, notes };
}
