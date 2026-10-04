import { formatNumber } from './css-safe';

export class CubicBezierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CubicBezierError';
  }
}

/** The four numbers of cubic-bezier(x1, y1, x2, y2). */
export type CurvePoints = readonly [number, number, number, number];

/**
 * The keyword curves, quoted from CSS Easing Functions Level 1 (https://www.w3.org/TR/css-easing-1/): linear is written
 * here as cubic-bezier(0, 0, 1, 1), ease is cubic-bezier(0.25, 0.1, 0.25, 1), ease-in is cubic-bezier(0.42, 0, 1, 1),
 * ease-out is cubic-bezier(0, 0, 0.58, 1) and ease-in-out is cubic-bezier(0.42, 0, 0.58, 1).
 */
export const KEYWORD_CURVES: ReadonlyMap<string, CurvePoints> = new Map<string, CurvePoints>([
  ['linear', [0, 0, 1, 1]],
  ['ease', [0.25, 0.1, 0.25, 1]],
  ['ease-in', [0.42, 0, 1, 1]],
  ['ease-out', [0, 0, 0.58, 1]],
  ['ease-in-out', [0.42, 0, 0.58, 1]],
]);

/** Curves of this page's own. They are not CSS keywords; each label carries its four numbers. */
export const NAMED_CURVES: ReadonlyMap<string, { label: string; points: CurvePoints }> = new Map<
  string,
  { label: string; points: CurvePoints }
>([
  ['back-out', { label: 'Back out, overshoots then settles (0.34, 1.56, 0.64, 1)', points: [0.34, 1.56, 0.64, 1] }],
  ['back-in', { label: 'Back in, pulls back first (0.36, 0, 0.66, -0.56)', points: [0.36, 0, 0.66, -0.56] }],
  ['smooth', { label: 'Smooth in and out, gentler than ease-in-out (0.65, 0, 0.35, 1)', points: [0.65, 0, 0.35, 1] }],
]);

/** A control point of the curve; `clamped` says an earlier step already held its x inside 0 to 1. */
export interface ControlPoint {
  x: number;
  y: number;
  clamped?: boolean;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Maps a handle pad's value to a control point. The pad's y runs downward like a screen, so the curve's y is 1 minus it
 * (a handle at the top of the pad is a high curve value). cubic-bezier() requires both x values in 0 to 1
 * (https://www.w3.org/TR/css-easing-1/#cubic-bezier-easing-functions), so x is held there and `clamped` says it was.
 */
export function pointFieldToControl(p: { x: number; y: number }): { x: number; y: number; clamped: boolean } {
  if (!Number.isFinite(p.x)) return { x: 0, y: round3(1 - p.y), clamped: true };
  const x = Math.min(1, Math.max(0, p.x));
  return { x: round3(x), y: round3(1 - p.y), clamped: x !== p.x };
}

/** The pad value of a control point: the same x and 1 minus y. */
export function controlToPointField(c: { x: number; y: number }): { x: number; y: number } {
  return { x: round3(c.x), y: round3(1 - c.y) };
}

/**
 * The progress of an easing at an input time between 0 and 1, for the curve through (0, 0), (x1, y1), (x2, y2) and
 * (1, 1): x(t) = input is solved for t, then y(t) is returned. Newton steps from t = input, then plain bisection (x(t) does
 * not decrease while both x values are in 0 to 1) to far below 1e-9 if a step fails to converge.
 */
export function solveProgress(x1: number, y1: number, x2: number, y2: number, input: number): number {
  if (!Number.isFinite(input)) throw new CubicBezierError('The input time is not a number.');
  if (input <= 0) return 0;
  if (input >= 1) return 1;
  const along = (t: number, a: number, b: number): number => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  const slope = (t: number): number => {
    const u = 1 - t;
    return 3 * u * u * x1 + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2);
  };
  let t = input;
  for (let i = 0; i < 8; i++) {
    const error = along(t, x1, x2) - input;
    if (Math.abs(error) < 1e-13) return along(t, y1, y2);
    const d = slope(t);
    if (Math.abs(d) < 1e-6) break;
    t -= error / d;
    if (!(t >= 0 && t <= 1)) break;
  }
  let low = 0;
  let high = 1;
  for (let i = 0; i < 64; i++) {
    t = (low + high) / 2;
    if (along(t, x1, x2) < input) low = t;
    else high = t;
  }
  return along((low + high) / 2, y1, y2);
}

/** A number written to six decimals, never as a negative zero. */
function fixed6(n: number): string {
  const text = n.toFixed(6);
  if (!text.startsWith('-')) return text;
  for (let i = 1; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch !== '0' && ch !== '.') return text;
  }
  return text.slice(1);
}

/** The eleven rows of the table: the input time 0, 0.1 ... 1 and the progress at it, to six decimals. */
export function sampleCurve(x1: number, y1: number, x2: number, y2: number): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i <= 10; i++) {
    rows.push([(i / 10).toFixed(1), fixed6(solveProgress(x1, y1, x2, y2, i / 10))]);
  }
  return rows;
}

const SIZE = 160;
const MARGIN = 40;
const EDGE = 0.1;

/**
 * The curve as an SVG picture: the unit square, the straight line for linear motion, both handle lines and handles, and
 * the curve itself as the SVG cubic Bezier command from (0, 0) to (1, 1). Time runs left to right and progress upward.
 * Built only from numbers and fixed text, with a title and a description that give the four numbers.
 */
export function curveSvg(x1: number, y1: number, x2: number, y2: number): string {
  const top = Math.max(1, y1, y2);
  const bottom = Math.min(0, y1, y2);
  const width = 2 * MARGIN + SIZE;
  const height = 2 * MARGIN + (top - bottom + 2 * EDGE) * SIZE;
  const px = (x: number) => formatNumber(MARGIN + x * SIZE, 2);
  const py = (y: number) => formatNumber(MARGIN + (top + EDGE - y) * SIZE, 2);
  const n = (v: number) => formatNumber(v, 3);
  const line = (ax: number, ay: number, bx: number, by: number, extra: string) =>
    `<line x1="${px(ax)}" y1="${py(ay)}" x2="${px(bx)}" y2="${py(by)}" ${extra}/>`;
  const description =
    `Easing curve from (0, 0) to (1, 1) with control points (${n(x1)}, ${n(y1)}) and (${n(x2)}, ${n(y2)}). ` +
    'Time runs left to right and progress runs upward.';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="easing-title easing-desc" viewBox="0 0 ${formatNumber(width, 2)} ${formatNumber(height, 2)}" width="${formatNumber(width, 2)}" height="${formatNumber(height, 2)}">`,
    '<title id="easing-title">Cubic Bezier easing curve</title>',
    `<desc id="easing-desc">${description}</desc>`,
    `<rect x="0" y="0" width="${formatNumber(width, 2)}" height="${formatNumber(height, 2)}" fill="#ffffff"/>`,
    `<rect x="${px(0)}" y="${py(1)}" width="${SIZE}" height="${SIZE}" fill="none" stroke="#cbd5e1" stroke-width="1"/>`,
    line(0, 0, 1, 1, 'stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4 4"'),
    line(0, 0, x1, y1, 'stroke="#94a3b8" stroke-width="2"'),
    line(1, 1, x2, y2, 'stroke="#94a3b8" stroke-width="2"'),
    `<path fill="none" stroke="#1d4ed8" stroke-width="3" d="M ${px(0)} ${py(0)} C ${px(x1)} ${py(y1)}, ${px(x2)} ${py(y2)}, ${px(1)} ${py(1)}"/>`,
    `<circle cx="${px(x1)}" cy="${py(y1)}" r="6" fill="#be123c"/>`,
    `<circle cx="${px(x2)}" cy="${py(y2)}" r="6" fill="#be123c"/>`,
    '</svg>',
  ].join('');
}
