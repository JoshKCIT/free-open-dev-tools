import { MAX_GLYPH_PATH_CHARS } from './limits';

/** A point as [x, y] in font units, y pointing up. */
export type Pt = [number, number];

/**
 * One drawn segment: a straight line (start, end), a quadratic curve (start, control, end) or a cubic curve (start, two
 * controls, end). A contour is a list of segments that follow each other and close on their first point.
 */
export type Segment = ['L', Pt, Pt] | ['Q', Pt, Pt, Pt] | ['C', Pt, Pt, Pt, Pt];
export type Contour = Segment[];

export interface GlyphDrawing {
  contours: Contour[];
  /** True when a cap stopped the drawing (too many points, components, depth, steps); what was drawn is kept. */
  truncated: boolean;
  /** True when the glyph's data could not be read; the drawing is empty. */
  unreadable: boolean;
  /** How many outline points the glyph had (TrueType) or segments it drew (CFF). */
  points: number;
}

/** A TrueType outline point: on or off the curve. */
export interface TtPoint {
  x: number;
  y: number;
  on: boolean;
}

/** A drawing that is empty, with the given flags. */
export function emptyDrawing(truncated = false, unreadable = false): GlyphDrawing {
  return { contours: [], truncated, unreadable, points: 0 };
}

const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const same = (a: Pt, b: Pt): boolean => a[0] === b[0] && a[1] === b[1];

/**
 * Turns a TrueType contour (quadratic splines, where two off-curve points in a row imply an on-curve point halfway between
 * them) into segments. A contour with no on-curve point starts halfway between its first and last point. The contour is closed
 * by a line (or a curve) back to its start.
 */
export function quadraticContour(points: readonly TtPoint[]): Contour {
  const n = points.length;
  if (n === 0) return [];
  const asPt = (p: TtPoint): Pt => [p.x, p.y];
  const first = points.findIndex((p) => p.on);
  let start: Pt;
  const sequence: TtPoint[] = [];
  if (first === -1) {
    start = mid(asPt(points[0]!), asPt(points[n - 1]!));
    for (const p of points) sequence.push(p);
  } else {
    start = asPt(points[first]!);
    for (let k = 1; k < n; k++) sequence.push(points[(first + k) % n]!);
  }
  const out: Contour = [];
  let current: Pt = start;
  let control: Pt | null = null;
  for (const p of sequence) {
    const here = asPt(p);
    if (p.on) {
      out.push(control ? ['Q', current, control, here] : ['L', current, here]);
      current = here;
      control = null;
    } else if (control) {
      const half = mid(control, here);
      out.push(['Q', current, control, half]);
      current = half;
      control = here;
    } else {
      control = here;
    }
  }
  if (control) out.push(['Q', current, control, start]);
  else if (!same(current, start)) out.push(['L', current, start]);
  return out;
}

const number = (n: number): string => {
  const rounded = Math.round(n * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

/**
 * The SVG path text of contours: one `M` per contour, one command per segment and `Z` to close. Writing stops once the
 * text passes `maxChars`, and `cut` says so.
 */
export function contoursToPath(
  contours: readonly Contour[],
  maxChars = MAX_GLYPH_PATH_CHARS,
): { path: string; cut: boolean } {
  const parts: string[] = [];
  let length = 0;
  let cut = false;
  const push = (text: string): boolean => {
    if (length + text.length > maxChars) {
      cut = true;
      return false;
    }
    parts.push(text);
    length += text.length;
    return true;
  };
  outer: for (const contour of contours) {
    const startSegment = contour[0];
    if (!startSegment) continue;
    if (!push(`M${number(startSegment[1][0])} ${number(startSegment[1][1])}`)) break;
    for (const segment of contour) {
      let text: string;
      if (segment[0] === 'L') text = `L${number(segment[2][0])} ${number(segment[2][1])}`;
      else if (segment[0] === 'Q') {
        text = `Q${number(segment[2][0])} ${number(segment[2][1])} ${number(segment[3][0])} ${number(segment[3][1])}`;
      } else {
        text = `C${number(segment[2][0])} ${number(segment[2][1])} ${number(segment[3][0])} ${number(segment[3][1])} ${number(segment[4][0])} ${number(segment[4][1])}`;
      }
      if (!push(text)) break outer;
    }
    if (!push('Z')) break;
  }
  return { path: parts.join(''), cut };
}
