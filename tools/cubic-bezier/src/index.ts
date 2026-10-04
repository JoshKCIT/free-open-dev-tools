import meta from './meta.json';
import { CssSafetyError, assertSafeTree, clampNumber, formatLength, formatNumber, stylesheetText } from './css-safe';
import type { PreviewTreeNode } from './css-safe';
import {
  CubicBezierError,
  KEYWORD_CURVES,
  NAMED_CURVES,
  controlToPointField,
  curveSvg,
  pointFieldToControl,
  sampleCurve,
  solveProgress,
  type ControlPoint,
  type CurvePoints,
} from './bezier';

export {
  meta,
  CubicBezierError,
  KEYWORD_CURVES,
  NAMED_CURVES,
  controlToPointField,
  curveSvg,
  pointFieldToControl,
  sampleCurve,
  solveProgress,
};
export type { ControlPoint, CurvePoints, PreviewTreeNode };

/** Every preset, by id with the label shown on the page: custom first, the five keywords, then the named curves. */
export const EASING_PRESETS: ReadonlyMap<string, string> = new Map<string, string>([
  ['custom', 'Custom (drag the handles)'],
  ...[...KEYWORD_CURVES].map(([name, points]) => [name, `${name} (${points.join(', ')})`] as [string, string]),
  ...[...NAMED_CURVES].map(([name, curve]) => [name, curve.label] as [string, string]),
]);

export interface GenerateEasingOptions {
  /** 'custom', a keyword or a named curve. Default 'custom'. */
  preset?: string;
  /** The first control point, read only for 'custom'. Default (0.25, 0.1). */
  p1?: ControlPoint;
  /** The second control point, read only for 'custom'. Default (0.25, 1). */
  p2?: ControlPoint;
  /** The length of the motion preview in seconds, clamped to 0.2 to 5. Default 1. */
  duration?: number;
}

export interface GenerateEasingResult {
  /** cubic-bezier(x1, y1, x2, y2). */
  value: string;
  /** transition-timing-function: followed by the value. */
  declaration: string;
  /** The preview stylesheet: a track, a dot, the keyframes, the timing function and the reduced-motion rule. */
  css: string;
  tree: PreviewTreeNode;
  /** The curve picture. */
  svg: string;
  /** The sampled progress: rows of the input time and the progress, as text. */
  table: string[][];
  points: { x1: number; y1: number; x2: number; y2: number };
  warnings: string[];
}

const DEFAULT_P1 = { x: 0.25, y: 0.1 };
const DEFAULT_P2 = { x: 0.25, y: 1 };
const TRACK_WIDTH = 240;
const DOT_SIZE = 24;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

function choose(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !EASING_PRESETS.has(value)) {
    throw new CubicBezierError('Preset is not one of the choices on offer.');
  }
  return value;
}

/**
 * Shapes a cubic-bezier() easing function (CSS Easing Functions Level 1, https://www.w3.org/TR/css-easing-1/): a keyword
 * curve, a named curve of this page's own, or two control points of the visitor's. Both x values are held to 0 to 1 and
 * both y values to -1 to 2, with a warning. Returns the value and declaration to copy, a preview stylesheet written by the
 * canonical writer (the dot moves along its track with exactly this timing function and stops under reduced motion), the
 * curve picture and the progress sampled at eleven times.
 */
export function generateEasing(options: GenerateEasingOptions): GenerateEasingResult {
  const warnings: string[] = [];
  const preset = choose(options.preset, 'custom');

  let points: [number, number, number, number];
  const fixed = KEYWORD_CURVES.get(preset) ?? NAMED_CURVES.get(preset)?.points;
  if (fixed !== undefined) {
    points = [fixed[0], fixed[1], fixed[2], fixed[3]];
  } else {
    const handle = (n: number, p: ControlPoint | undefined, fallback: { x: number; y: number }): [number, number] => {
      if (p === undefined) return [fallback.x, fallback.y];
      const label = `Handle ${n}`;
      const x = clampNumber(`${label} time (x)`, p.x, 0, 1, fallback.x);
      if (x.warning) warnings.push(x.warning);
      else if (p.clamped === true) {
        warnings.push(`${label} time (x) must stay between 0 and 1, so ${formatNumber(x.value)} was used.`);
      }
      const y = clampNumber(`${label} progress (y)`, p.y, -1, 2, fallback.y);
      if (y.warning) warnings.push(y.warning);
      return [round3(x.value), round3(y.value)];
    };
    const [x1, y1] = handle(1, options.p1, DEFAULT_P1);
    const [x2, y2] = handle(2, options.p2, DEFAULT_P2);
    points = [x1, y1, x2, y2];
  }
  const [x1, y1, x2, y2] = points;

  const durationResult = clampNumber('Duration', options.duration as number, 0.2, 5, 1);
  if (options.duration === undefined) durationResult.warning = null;
  if (durationResult.warning) warnings.push(durationResult.warning);

  const value = `cubic-bezier(${points.map((n) => formatNumber(n)).join(', ')})`;
  const tree: PreviewTreeNode = { className: 'track', children: [{ className: 'dot' }] };
  try {
    assertSafeTree(tree);
    const css = stylesheetText({
      rules: [
        {
          selector: '.track',
          declarations: [
            ['width', formatLength(TRACK_WIDTH, 'px')],
            ['height', formatLength(DOT_SIZE, 'px')],
            ['background-color', '#e2e8f0'],
            ['border-radius', formatLength(DOT_SIZE / 2, 'px')],
          ],
        },
        {
          selector: '.dot',
          declarations: [
            ['width', formatLength(DOT_SIZE, 'px')],
            ['height', formatLength(DOT_SIZE, 'px')],
            ['border-radius', '50%'],
            ['background-color', '#1d4ed8'],
            ['animation-name', 'move'],
            ['animation-duration', formatLength(durationResult.value, 's')],
            ['animation-timing-function', value],
            ['animation-iteration-count', 'infinite'],
            ['animation-direction', 'alternate'],
          ],
        },
      ],
      keyframes: [
        {
          name: 'move',
          frames: [
            { selector: 'from', declarations: [['transform', `translateX(${formatLength(0, 'px')})`]] },
            {
              selector: 'to',
              declarations: [['transform', `translateX(${formatLength(TRACK_WIDTH - DOT_SIZE, 'px')})`]],
            },
          ],
        },
      ],
      reducedMotion: [{ selector: '.dot', declarations: [['animation', 'none']] }],
    });
    return {
      value,
      declaration: `transition-timing-function: ${value};`,
      css,
      tree,
      svg: curveSvg(x1, y1, x2, y2),
      table: sampleCurve(x1, y1, x2, y2),
      points: { x1, y1, x2, y2 },
      warnings,
    };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new CubicBezierError(err.message);
    throw err;
  }
}
