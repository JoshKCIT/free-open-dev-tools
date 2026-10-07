import { ByteReader } from './bytes';
import { FontInspectorError } from './errors';
import { MAX_COMPONENTS, MAX_COMPONENT_DEPTH, MAX_GLYPH_POINTS } from './limits';
import { emptyDrawing, quadraticContour, type GlyphDrawing, type TtPoint } from './outline';
import { tableBytes, type SfntFont } from './sfnt';

export interface GlyphSource {
  /** How many glyphs the font states (maxp). */
  count: number;
  /** Draws one glyph. It never throws: a cap or a fault is a flag on the drawing. */
  draw(glyph: number): GlyphDrawing;
}

// Composite glyph flags (OpenType glyf table).
const ARG_1_AND_2_ARE_WORDS = 0x0001;
const ARGS_ARE_XY_VALUES = 0x0002;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;
const SCALED_COMPONENT_OFFSET = 0x0800;

/** State shared by the pieces of one drawn glyph, so a composite cannot spend more than the caps allow in all. */
interface Budget {
  points: number;
  components: number;
  truncated: boolean;
}

/**
 * Opens the glyf and loca tables of a font for drawing. Outlines are shifted by the glyph's left side bearing minus its
 * xMin (the phantom point rule), so the outline sits where the font's metrics say. Composite glyphs nest to depth 8, use
 * at most 64 components and 5,000 points in all; a glyph that hits a cap is drawn as far as it got and flagged.
 */
export function openGlyf(
  bytes: Uint8Array,
  font: SfntFont,
  numGlyphs: number,
  longOffsets: boolean,
): GlyphSource | null {
  const glyf = tableBytes(bytes, font.tables.get('glyf'));
  const loca = tableBytes(bytes, font.tables.get('loca'));
  if (!glyf || !loca) return null;
  const locaReader = new ByteReader(loca);
  const glyfReader = new ByteReader(glyf);

  // Left side bearings from hmtx: long metrics first, then one bearing per remaining glyph.
  const hmtx = tableBytes(bytes, font.tables.get('hmtx'));
  const hhea = tableBytes(bytes, font.tables.get('hhea'));
  const hmtxReader = hmtx ? new ByteReader(hmtx) : null;
  const longMetrics = hhea && hhea.length >= 36 ? new ByteReader(hhea).u16(34) : 0;
  const lsbOf = (gid: number): number | null => {
    if (!hmtxReader || longMetrics === 0) return null;
    try {
      if (gid < longMetrics) return hmtxReader.i16(4 * gid + 2);
      return hmtxReader.i16(4 * longMetrics + 2 * (gid - longMetrics));
    } catch {
      return null;
    }
  };

  /** The byte range of a glyph in glyf, null when loca cannot say, or [start, start] for a glyph with no outline. */
  const rangeOf = (gid: number): [number, number] | null => {
    try {
      const at = longOffsets ? 4 * gid : 2 * gid;
      const start = longOffsets ? locaReader.u32(at) : locaReader.u16(at) * 2;
      const end = longOffsets ? locaReader.u32(at + 4) : locaReader.u16(at + 2) * 2;
      if (end < start || end > glyf.length) return null;
      return [start, end];
    } catch {
      return null;
    }
  };

  /** The points of a glyph as contours, components resolved. Throws FontInspectorError for data that cannot be read. */
  const pointsOf = (gid: number, depth: number, budget: Budget): TtPoint[][] => {
    if (depth > MAX_COMPONENT_DEPTH) {
      budget.truncated = true;
      return [];
    }
    if (gid < 0 || gid >= numGlyphs)
      throw new FontInspectorError('A composite glyph names a glyph the font does not have.');
    const range = rangeOf(gid);
    if (!range) throw new FontInspectorError('A glyph lies outside the glyf table.');
    const [start, end] = range;
    if (end - start < 10) return [];
    const contourCount = glyfReader.i16(start);
    if (contourCount >= 0) return simple(start, end, contourCount, budget);
    return composite(start, end, depth, budget);
  };

  const simple = (start: number, end: number, contours: number, budget: Budget): TtPoint[][] => {
    if (contours === 0) return [];
    const r = glyfReader;
    let p = start + 10;
    if (p + 2 * contours + 2 > end) throw new FontInspectorError('A glyph is shorter than its header says.');
    const ends: number[] = [];
    let previous = -1;
    for (let i = 0; i < contours; i++) {
      const e = r.u16(p);
      if (e < previous) throw new FontInspectorError('A glyph lists its contour ends out of order.');
      ends.push(e);
      previous = e;
      p += 2;
    }
    const total = (ends[contours - 1] ?? -1) + 1;
    if (budget.points + total > MAX_GLYPH_POINTS) {
      budget.truncated = true;
      return [];
    }
    p += 2 + r.u16(p);
    const flags: number[] = new Array<number>(total);
    for (let i = 0; i < total;) {
      const f = r.u8(p++);
      flags[i++] = f;
      if (f & 8) {
        let repeat = r.u8(p++);
        while (repeat-- > 0 && i < total) flags[i++] = f;
      }
    }
    const xs = new Array<number>(total);
    const ys = new Array<number>(total);
    let v = 0;
    for (let i = 0; i < total; i++) {
      const f = flags[i]!;
      if (f & 2) {
        const d = r.u8(p++);
        v += f & 16 ? d : -d;
      } else if (!(f & 16)) {
        v += r.i16(p);
        p += 2;
      }
      xs[i] = v;
    }
    v = 0;
    for (let i = 0; i < total; i++) {
      const f = flags[i]!;
      if (f & 4) {
        const d = r.u8(p++);
        v += f & 32 ? d : -d;
      } else if (!(f & 32)) {
        v += r.i16(p);
        p += 2;
      }
      ys[i] = v;
    }
    budget.points += total;
    const out: TtPoint[][] = [];
    let from = 0;
    for (const e of ends) {
      const contour: TtPoint[] = [];
      for (let i = from; i <= e; i++) contour.push({ x: xs[i]!, y: ys[i]!, on: (flags[i]! & 1) === 1 });
      out.push(contour);
      from = e + 1;
    }
    return out;
  };

  const composite = (start: number, end: number, depth: number, budget: Budget): TtPoint[][] => {
    const r = glyfReader;
    let p = start + 10;
    const out: TtPoint[][] = [];
    for (;;) {
      if (p + 4 > end) throw new FontInspectorError('A composite glyph is shorter than its components say.');
      const flags = r.u16(p);
      const child = r.u16(p + 2);
      p += 4;
      let arg1: number;
      let arg2: number;
      if (flags & ARG_1_AND_2_ARE_WORDS) {
        arg1 = flags & ARGS_ARE_XY_VALUES ? r.i16(p) : r.u16(p);
        arg2 = flags & ARGS_ARE_XY_VALUES ? r.i16(p + 2) : r.u16(p + 2);
        p += 4;
      } else {
        arg1 = flags & ARGS_ARE_XY_VALUES ? (r.u8(p) << 24) >> 24 : r.u8(p);
        arg2 = flags & ARGS_ARE_XY_VALUES ? (r.u8(p + 1) << 24) >> 24 : r.u8(p + 1);
        p += 2;
      }
      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      if (flags & WE_HAVE_A_SCALE) {
        a = d = r.f2dot14(p);
        p += 2;
      } else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
        a = r.f2dot14(p);
        d = r.f2dot14(p + 2);
        p += 4;
      } else if (flags & WE_HAVE_A_TWO_BY_TWO) {
        // The four numbers are xscale, scale01, scale10 and yscale: x' = a*x + c*y and y' = b*x + d*y.
        a = r.f2dot14(p);
        b = r.f2dot14(p + 2);
        c = r.f2dot14(p + 4);
        d = r.f2dot14(p + 6);
        p += 8;
      }
      budget.components++;
      if (budget.components > MAX_COMPONENTS) {
        budget.truncated = true;
        break;
      }
      const parts = pointsOf(child, depth + 1, budget).map((contour) =>
        contour.map((pt) => ({ x: a * pt.x + c * pt.y, y: b * pt.x + d * pt.y, on: pt.on })),
      );
      let dx: number;
      let dy: number;
      if (flags & ARGS_ARE_XY_VALUES) {
        dx = arg1;
        dy = arg2;
        if (flags & SCALED_COMPONENT_OFFSET) {
          dx *= Math.hypot(a, b);
          dy *= Math.hypot(c, d);
        }
      } else {
        // Point matching: a point of the glyph so far is placed on a point of the component.
        const placed = out.flat()[arg1];
        const moved = parts.flat()[arg2];
        dx = placed && moved ? placed.x - moved.x : 0;
        dy = placed && moved ? placed.y - moved.y : 0;
      }
      for (const contour of parts) out.push(contour.map((pt) => ({ x: pt.x + dx, y: pt.y + dy, on: pt.on })));
      if (!(flags & MORE_COMPONENTS)) break;
    }
    return out;
  };

  return {
    count: numGlyphs,
    draw(gid: number): GlyphDrawing {
      if (!Number.isInteger(gid) || gid < 0 || gid >= numGlyphs) return emptyDrawing();
      const budget: Budget = { points: 0, components: 0, truncated: false };
      try {
        const contours = pointsOf(gid, 0, budget);
        // The phantom point rule: the outline is placed so that its left edge sits at the left side bearing.
        const range = rangeOf(gid);
        const lsb = lsbOf(gid);
        let shift = 0;
        if (range && range[1] - range[0] >= 10 && lsb !== null) shift = lsb - glyfReader.i16(range[0] + 2);
        const drawn = contours.map((contour) =>
          quadraticContour(shift === 0 ? contour : contour.map((pt) => ({ x: pt.x + shift, y: pt.y, on: pt.on }))),
        );
        return {
          contours: drawn.filter((c) => c.length > 0),
          truncated: budget.truncated,
          unreadable: false,
          points: contours.reduce((sum, c) => sum + c.length, 0),
        };
      } catch (err) {
        if (!(err instanceof FontInspectorError)) throw err;
        return emptyDrawing(budget.truncated, true);
      }
    },
  };
}
