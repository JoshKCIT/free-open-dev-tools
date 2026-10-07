import { ByteReader } from './bytes';
import { FontInspectorError } from './errors';
import { MAX_COMPARE_POINTS } from './limits';

/**
 * Glyph data as exact values, for the re-read check of a conversion. A WOFF2 file stores the glyf table in its own layout and
 * writes it out again when it is unpacked, so the bytes of the table can differ while every glyph is the same: the flag
 * bytes are packed again, glyphs are padded, and the loca offsets follow. This reader takes one glyph apart into the values
 * that make it up (the contour end points, the instructions, the on-curve and overlap flag of every point, the point
 * coordinates as whole numbers, the components of a composite with their flags, arguments and transform numbers), so two
 * glyphs can be compared by value. There is no tolerance anywhere: coordinates and every other number are compared as exact
 * integers. Drawing is not involved, so nothing here is shifted or turned into curves.
 *
 * Reference: OpenType specification, glyf table (simple and composite glyph descriptions) and loca table.
 */

export interface GlyphComponent {
  flags: number;
  glyph: number;
  arg1: number;
  arg2: number;
  /** The scale or matrix numbers as the 16-bit integers stored (F2Dot14), 0, 1, 2 or 4 of them. */
  transform: number[];
}

export interface GlyphValue {
  kind: 'empty' | 'simple' | 'composite';
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  /** The last point number of each contour (simple glyphs). */
  ends: number[];
  /** The glyph's hinting instructions (simple glyphs, and composites that carry them). */
  instructions: Uint8Array;
  /** Per point, bit 0 (on the curve) and bit 6 (overlap) of the flag byte; the other bits only say how the coordinates were packed. */
  flags: Uint8Array;
  xs: Int32Array;
  ys: Int32Array;
  components: GlyphComponent[];
}

const EMPTY: GlyphValue = {
  kind: 'empty',
  xMin: 0,
  yMin: 0,
  xMax: 0,
  yMax: 0,
  ends: [],
  instructions: new Uint8Array(0),
  flags: new Uint8Array(0),
  xs: new Int32Array(0),
  ys: new Int32Array(0),
  components: [],
};

/** How much glyph data one check may take apart, so a hostile font cannot make the check run for long. */
export interface GlyphBudget {
  points: number;
}

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME_OR_POSITIVE = 0x10;
const Y_SAME_OR_POSITIVE = 0x20;
const OVERLAP_SIMPLE = 0x40;

const ARG_1_AND_2_ARE_WORDS = 0x0001;
const ARGS_ARE_XY_VALUES = 0x0002;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;
const WE_HAVE_INSTRUCTIONS = 0x0100;

/** The sentence for a font whose glyphs hold more points than the check will take apart. */
const BUDGET_SENTENCE = 'The glyphs of this font hold more points than the check can compare.';

function bad(text: string): FontInspectorError {
  return new FontInspectorError(text);
}

/**
 * Takes one glyph's bytes apart. A glyph with no bytes, and one that states no contours, is `empty` whatever its bounding
 * box says (there is no outline to compare). Every read is compared with the bytes of the glyph, and the points of all the
 * glyphs of one check are counted against the budget before they are decoded.
 */
export function readGlyphValue(data: Uint8Array, budget: GlyphBudget): GlyphValue {
  if (data.length === 0) return EMPTY;
  if (data.length < 10) throw bad('A glyph is shorter than its header.');
  const r = new ByteReader(data);
  const contours = r.i16(0);
  if (contours === 0) return EMPTY;
  const xMin = r.i16(2);
  const yMin = r.i16(4);
  const xMax = r.i16(6);
  const yMax = r.i16(8);
  if (contours < -1) throw bad('A glyph states a number of contours the format does not define.');
  if (contours > 0) return simple(r, data.length, contours, { xMin, yMin, xMax, yMax }, budget);
  return composite(r, data.length, { xMin, yMin, xMax, yMax });
}

type Box = { xMin: number; yMin: number; xMax: number; yMax: number };

function simple(r: ByteReader, end: number, contours: number, box: Box, budget: GlyphBudget): GlyphValue {
  let p = 10;
  if (p + 2 * contours + 2 > end) throw bad('A glyph is shorter than its contour list.');
  const ends: number[] = [];
  let previous = -1;
  for (let i = 0; i < contours; i++) {
    const e = r.u16(p);
    if (e < previous) throw bad('A glyph lists its contour ends out of order.');
    ends.push(e);
    previous = e;
    p += 2;
  }
  const total = (ends[contours - 1] ?? -1) + 1;
  budget.points += total;
  if (budget.points > MAX_COMPARE_POINTS) {
    throw bad(BUDGET_SENTENCE);
  }
  const instructionLength = r.u16(p);
  p += 2;
  if (p + instructionLength > end) throw bad('A glyph is shorter than its instructions.');
  const instructions = r.slice(p, instructionLength).slice();
  p += instructionLength;

  const packed = new Uint8Array(total);
  for (let i = 0; i < total;) {
    if (p >= end) throw bad('A glyph ends inside its flags.');
    const f = r.u8(p++);
    packed[i++] = f;
    if (f & REPEAT) {
      if (p >= end) throw bad('A glyph ends inside its flags.');
      let repeat = r.u8(p++);
      if (i + repeat > total) throw bad('A glyph repeats a flag past its last point.');
      while (repeat-- > 0) packed[i++] = f;
    }
  }
  const xs = new Int32Array(total);
  const ys = new Int32Array(total);
  let v = 0;
  for (let i = 0; i < total; i++) {
    const f = packed[i]!;
    if (f & X_SHORT) {
      if (p >= end) throw bad('A glyph ends inside its x coordinates.');
      const d = r.u8(p++);
      v += f & X_SAME_OR_POSITIVE ? d : -d;
    } else if (!(f & X_SAME_OR_POSITIVE)) {
      if (p + 2 > end) throw bad('A glyph ends inside its x coordinates.');
      v += r.i16(p);
      p += 2;
    }
    xs[i] = v;
  }
  v = 0;
  for (let i = 0; i < total; i++) {
    const f = packed[i]!;
    if (f & Y_SHORT) {
      if (p >= end) throw bad('A glyph ends inside its y coordinates.');
      const d = r.u8(p++);
      v += f & Y_SAME_OR_POSITIVE ? d : -d;
    } else if (!(f & Y_SAME_OR_POSITIVE)) {
      if (p + 2 > end) throw bad('A glyph ends inside its y coordinates.');
      v += r.i16(p);
      p += 2;
    }
    ys[i] = v;
  }
  const flags = new Uint8Array(total);
  for (let i = 0; i < total; i++) flags[i] = packed[i]! & (ON_CURVE | OVERLAP_SIMPLE);
  return { kind: 'simple', ...box, ends, instructions, flags, xs, ys, components: [] };
}

function composite(r: ByteReader, end: number, box: Box): GlyphValue {
  let p = 10;
  const components: GlyphComponent[] = [];
  let hasInstructions = false;
  for (;;) {
    if (p + 4 > end) throw bad('A composite glyph is shorter than its components say.');
    const flags = r.u16(p);
    const glyph = r.u16(p + 2);
    p += 4;
    let arg1: number;
    let arg2: number;
    if (flags & ARG_1_AND_2_ARE_WORDS) {
      if (p + 4 > end) throw bad('A composite glyph ends inside a component.');
      arg1 = flags & ARGS_ARE_XY_VALUES ? r.i16(p) : r.u16(p);
      arg2 = flags & ARGS_ARE_XY_VALUES ? r.i16(p + 2) : r.u16(p + 2);
      p += 4;
    } else {
      if (p + 2 > end) throw bad('A composite glyph ends inside a component.');
      arg1 = flags & ARGS_ARE_XY_VALUES ? (r.u8(p) << 24) >> 24 : r.u8(p);
      arg2 = flags & ARGS_ARE_XY_VALUES ? (r.u8(p + 1) << 24) >> 24 : r.u8(p + 1);
      p += 2;
    }
    const transform: number[] = [];
    const numbers =
      flags & WE_HAVE_A_SCALE ? 1 : flags & WE_HAVE_AN_X_AND_Y_SCALE ? 2 : flags & WE_HAVE_A_TWO_BY_TWO ? 4 : 0;
    if (p + 2 * numbers > end) throw bad('A composite glyph ends inside a component.');
    for (let k = 0; k < numbers; k++) transform.push(r.i16(p + 2 * k));
    p += 2 * numbers;
    components.push({ flags, glyph, arg1, arg2, transform });
    if (flags & WE_HAVE_INSTRUCTIONS) hasInstructions = true;
    if (!(flags & MORE_COMPONENTS)) break;
  }
  let instructions = new Uint8Array(0);
  if (hasInstructions) {
    if (p + 2 > end) throw bad('A composite glyph ends before its instructions.');
    const length = r.u16(p);
    p += 2;
    if (p + length > end) throw bad('A composite glyph is shorter than its instructions.');
    instructions = r.slice(p, length).slice();
  }
  return {
    kind: 'composite',
    ...box,
    ends: [],
    instructions,
    flags: new Uint8Array(0),
    xs: new Int32Array(0),
    ys: new Int32Array(0),
    components,
  };
}

const sameArray = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Whether two glyphs are the same by value: exact integers throughout, no tolerance. */
export function sameGlyphValue(a: GlyphValue, b: GlyphValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'empty') return true;
  if (a.xMin !== b.xMin || a.yMin !== b.yMin || a.xMax !== b.xMax || a.yMax !== b.yMax) return false;
  if (!sameArray(a.instructions, b.instructions)) return false;
  if (a.kind === 'simple') {
    return sameArray(a.ends, b.ends) && sameArray(a.flags, b.flags) && sameArray(a.xs, b.xs) && sameArray(a.ys, b.ys);
  }
  if (a.components.length !== b.components.length) return false;
  for (let i = 0; i < a.components.length; i++) {
    const x = a.components[i]!;
    const y = b.components[i]!;
    if (x.flags !== y.flags || x.glyph !== y.glyph || x.arg1 !== y.arg1 || x.arg2 !== y.arg2) return false;
    if (!sameArray(x.transform, y.transform)) return false;
  }
  return true;
}

export interface GlyphTable {
  glyf: Uint8Array;
  loca: Uint8Array;
  /** True when loca holds 32-bit offsets (head.indexToLocFormat is 1), false for 16-bit offsets in units of two bytes. */
  long: boolean;
}

/**
 * The byte ranges of every glyph from loca. loca must hold `numGlyphs + 1` offsets, none may be smaller than the one
 * before, and none may pass the end of glyf; with those rules the ranges can neither overlap nor add up to more than glyf,
 * so taking all of them apart costs a bounded amount of work.
 */
export function glyphRanges(table: GlyphTable, numGlyphs: number): [number, number][] {
  const size = table.long ? 4 : 2;
  if (table.loca.length < (numGlyphs + 1) * size) throw bad('The loca table is shorter than the glyph count needs.');
  const r = new ByteReader(table.loca);
  const offsets: number[] = new Array<number>(numGlyphs + 1);
  let previous = 0;
  for (let g = 0; g <= numGlyphs; g++) {
    const at = table.long ? r.u32(4 * g) : r.u16(2 * g) * 2;
    if (at < previous) throw bad('The loca table lists glyph offsets out of order.');
    if (at > table.glyf.length) throw bad('The loca table points past the end of the glyf table.');
    offsets[g] = at;
    previous = at;
  }
  const ranges: [number, number][] = [];
  for (let g = 0; g < numGlyphs; g++) ranges.push([offsets[g]!, offsets[g + 1]!]);
  return ranges;
}

export interface GlyphComparison {
  /** How many glyphs were compared (all of them when the fonts agree). */
  compared: number;
  /** The first glyph number that differs, or null. */
  firstDifference: number | null;
  /** A plain sentence when the glyphs could not be read or differ, otherwise null. */
  problem: string | null;
}

/** Compares two fonts' glyphs one by one, by value. Never throws for bad glyph data: that is the returned problem. */
export function compareGlyphs(a: GlyphTable, b: GlyphTable, numGlyphs: number): GlyphComparison {
  let compared = 0;
  try {
    const rangesA = glyphRanges(a, numGlyphs);
    const rangesB = glyphRanges(b, numGlyphs);
    const budget: GlyphBudget = { points: 0 };
    for (let g = 0; g < numGlyphs; g++) {
      const [sa, ea] = rangesA[g]!;
      const [sb, eb] = rangesB[g]!;
      let x: GlyphValue;
      let y: GlyphValue;
      try {
        x = readGlyphValue(a.glyf.subarray(sa, ea), budget);
      } catch (err) {
        if (!(err instanceof FontInspectorError) || err.message === BUDGET_SENTENCE) throw err;
        return {
          compared,
          firstDifference: g,
          problem: `Glyph ${g} of the font you opened could not be read, so it cannot be checked.`,
        };
      }
      try {
        y = readGlyphValue(b.glyf.subarray(sb, eb), budget);
      } catch (err) {
        if (!(err instanceof FontInspectorError) || err.message === BUDGET_SENTENCE) throw err;
        return { compared, firstDifference: g, problem: `Glyph ${g} of the converted font could not be read back.` };
      }
      if (!sameGlyphValue(x, y)) {
        return { compared, firstDifference: g, problem: `Glyph ${g} is not the same in the converted font.` };
      }
      compared++;
    }
    return { compared, firstDifference: null, problem: null };
  } catch (err) {
    if (!(err instanceof FontInspectorError)) throw err;
    return { compared, firstDifference: null, problem: `The glyph tables could not be compared: ${err.message}` };
  }
}
