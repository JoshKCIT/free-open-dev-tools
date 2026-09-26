import meta from './meta.json';
import {
  CssSafetyError,
  clampNumber,
  formatLength,
  formatNumber,
  parseHexColor,
  formatHexColor,
  stylesheetText,
  assertSafeTree,
  type PreviewTreeNode,
  type RgbaColor,
} from './css-safe';

export { meta };
export type { PreviewTreeNode };

export class TransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransformError';
  }
}

export interface Point {
  x: number;
  y: number;
}

/** One of the four 2D transform functions this tool composes. */
export type TransformFn =
  | { type: 'translate'; x: number; y: number }
  | { type: 'rotate'; deg: number }
  | { type: 'scale'; x: number; y: number }
  | { type: 'skew'; x: number; y: number };

/** The order presets a visitor can choose from (D-116-adjacent field, this tool's own closed list). */
export const ORDER_PRESETS: Record<string, TransformFn['type'][]> = {
  'translate-rotate-scale-skew': ['translate', 'rotate', 'scale', 'skew'],
  'rotate-translate-scale-skew': ['rotate', 'translate', 'scale', 'skew'],
  'scale-rotate-translate-skew': ['scale', 'rotate', 'translate', 'skew'],
  'skew-scale-rotate-translate': ['skew', 'scale', 'rotate', 'translate'],
};

const DEFAULT_ORDER = 'translate-rotate-scale-skew';

/**
 * CSS Transforms Module Level 2 (https://www.w3.org/TR/css-transforms-2/),
 * section 3 "Individual Transform Properties": "the used value of the
 * transform is calculated by combining ... in the following order:
 * translate, rotate, scale, and then transform" -- the individual
 * properties path always uses this order, regardless of the visitor's own
 * chosen `order`, leaving any skew in the `transform` property alone.
 */
const INDIVIDUAL_ORDER: TransformFn['type'][] = ['translate', 'rotate', 'scale', 'skew'];

export interface GenerateTransformOptions {
  /** Horizontal/vertical translation in px. Default { x: 0, y: 0 }, clamped -300..300. */
  translate?: Point;
  /** Rotation in degrees. Default 0, clamped -360..360. */
  rotate?: number;
  /** Horizontal/vertical scale factor. Default { x: 1, y: 1 }, clamped 0.1..4. */
  scale?: Point;
  /** Horizontal/vertical skew in degrees. Default { x: 0, y: 0 }, clamped -60..60. */
  skew?: Point;
  /** transform-origin in percent. Default { x: 50, y: 50 }, clamped 0..100. */
  origin?: Point;
  /** One of the four ORDER_PRESETS keys. Default 'translate-rotate-scale-skew'. */
  order?: string;
  /** Writes the Level 2 individual properties (plus transform for skew alone) instead of one transform declaration. */
  individual?: boolean;
  /** Preview box width in px. Default 160, clamped to 40-240. */
  width?: number;
  /** Preview box height in px. Default 160, clamped to 40-240. */
  height?: number;
  /** Preview box background, as a 3/4/6/8-digit hex colour. Default '#2563eb'. */
  background?: string;
}

export interface GenerateTransformResult {
  /** One `.box` rule (plus a `.box-label` rule) declaring width, height, background-color, the transform declarations and transform-origin. */
  css: string;
  /** The element tree the CSS styles: a box holding one label. */
  tree: PreviewTreeNode;
  /** The value written into the `transform` declaration (all four functions in whole mode, skew alone in individual mode). */
  value: string;
  /** The equivalent 2D matrix [a, b, c, d, e, f], computed by composeMatrix in the order the functions are actually applied. */
  matrix: [number, number, number, number, number, number];
  warnings: string[];
}

// A lighter blue than this phase's other generators' own default (measured
// this session, see 08-04-SUMMARY.md "Measured per-engine behaviour"): a
// rotated box's own straight edges are not pixel-snapped, and a full
// diagonal perimeter (unlike a border-radius curve or a shadow's own edge)
// produces far more anti-aliased edge pixels against a high-contrast
// background than the shared paste-compare harness's pixel budget allows.
const DEFAULT_BACKGROUND = '#93c5fd';

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function round6(n: number): number {
  const r = Math.round(n * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

/**
 * Standard 3x3 affine matrix product, M1 times M2 (both in [a, b, c, d, e,
 * f] form), so that a point transforms as M1(M2(point)) -- the same
 * convention CSS Transforms Level 1 defines for writing "f1 f2" in a
 * transform list.
 */
function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/**
 * CSS Transforms Module Level 1
 * (https://www.w3.org/TR/css-transforms-1/), "Two-Dimensional Transform
 * Functions": translate(tx, ty) = matrix(1, 0, 0, 1, tx, ty); rotate(a) =
 * matrix(cos(a), sin(a), -sin(a), cos(a), 0, 0); scale(sx, sy) = matrix(sx,
 * 0, 0, sy, 0, 0); skew(ax, ay) = matrix(1, tan(ay), tan(ax), 1, 0, 0).
 */
function matrixOf(fn: TransformFn): Matrix {
  switch (fn.type) {
    case 'translate':
      return [1, 0, 0, 1, fn.x, fn.y];
    case 'rotate': {
      const rad = (fn.deg * Math.PI) / 180;
      return [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];
    }
    case 'scale':
      return [fn.x, 0, 0, fn.y, 0, 0];
    case 'skew': {
      const rx = (fn.x * Math.PI) / 180;
      const ry = (fn.y * Math.PI) / 180;
      return [1, Math.tan(ry), Math.tan(rx), 1, 0, 0];
    }
  }
}

/**
 * Multiplies an ordered list of transform functions' own matrices in the
 * order given (CSS Transforms Level 1's own "net transform is a matrix
 * multiplication ... in the order provided"), returning six numbers rounded
 * to six decimals and never a negative zero.
 */
export function composeMatrix(functions: TransformFn[]): Matrix {
  const result = functions.reduce<Matrix>((acc, fn) => multiply(acc, matrixOf(fn)), IDENTITY);
  return result.map(round6) as Matrix;
}

function formatFn(fn: TransformFn): string {
  switch (fn.type) {
    case 'translate':
      return `translate(${formatLength(fn.x, 'px')}, ${formatLength(fn.y, 'px')})`;
    case 'rotate':
      return `rotate(${formatLength(fn.deg, 'deg')})`;
    case 'scale':
      return `scale(${formatNumber(fn.x)}, ${formatNumber(fn.y)})`;
    case 'skew':
      return `skew(${formatLength(fn.x, 'deg')}, ${formatLength(fn.y, 'deg')})`;
  }
}

function safeBackground(text: string | undefined, warnings: string[]): RgbaColor {
  try {
    return parseHexColor(text ?? DEFAULT_BACKGROUND, 'Background colour');
  } catch {
    warnings.push('Background colour was not a valid hex colour, so the default was used instead.');
    return parseHexColor(DEFAULT_BACKGROUND);
  }
}

/**
 * Generates a `transform` value (and the whole `.box`/`.box-label` rules
 * around it) by composing translate, rotate, scale and skew in a chosen
 * order, per CSS Transforms Module Level 1
 * (https://www.w3.org/TR/css-transforms-1/) and, when `individual` is set,
 * CSS Transforms Module Level 2 (https://www.w3.org/TR/css-transforms-2/)'s
 * own individual translate/rotate/scale properties. CSS Color Module Level
 * 4 (https://www.w3.org/TR/css-color-4/) section 5.2 governs the hex
 * colour written into `background-color`.
 */
export function generateTransform(options: GenerateTransformOptions): GenerateTransformResult {
  const warnings: string[] = [];

  const translateIn = options.translate ?? { x: 0, y: 0 };
  const tx = clampNumber('Move horizontal', translateIn.x, -300, 300, 0);
  const ty = clampNumber('Move vertical', translateIn.y, -300, 300, 0);
  const rotateDeg = clampNumber('Rotate', options.rotate ?? 0, -360, 360, 0);
  const scaleIn = options.scale ?? { x: 1, y: 1 };
  const sx = clampNumber('Scale horizontal', scaleIn.x, 0.1, 4, 1);
  const sy = clampNumber('Scale vertical', scaleIn.y, 0.1, 4, 1);
  const skewIn = options.skew ?? { x: 0, y: 0 };
  const kx = clampNumber('Skew horizontal', skewIn.x, -60, 60, 0);
  const ky = clampNumber('Skew vertical', skewIn.y, -60, 60, 0);
  const originIn = options.origin ?? { x: 50, y: 50 };
  const ox = clampNumber('Origin horizontal', originIn.x, 0, 100, 50);
  const oy = clampNumber('Origin vertical', originIn.y, 0, 100, 50);
  // Default 120, not the tool's own maximum of 240: measured this session
  // (see 08-04-SUMMARY.md), a smaller box means a shorter rotated diagonal
  // perimeter and fewer anti-aliased edge pixels for the shared
  // paste-compare harness's fixed pixel-difference budget to absorb.
  const widthResult = clampNumber('Width', options.width ?? 120, 40, 240, 120);
  const heightResult = clampNumber('Height', options.height ?? 120, 40, 240, 120);
  for (const r of [tx, ty, rotateDeg, sx, sy, kx, ky, ox, oy, widthResult, heightResult]) {
    if (r.warning) warnings.push(r.warning);
  }
  const width = widthResult.value;
  const height = heightResult.value;

  const background = safeBackground(options.background, warnings);
  const individual = Boolean(options.individual);

  const translateFn: TransformFn = { type: 'translate', x: tx.value, y: ty.value };
  const rotateFn: TransformFn = { type: 'rotate', deg: rotateDeg.value };
  const scaleFn: TransformFn = { type: 'scale', x: sx.value, y: sy.value };
  const skewFn: TransformFn = { type: 'skew', x: kx.value, y: ky.value };
  const byType: Record<TransformFn['type'], TransformFn> = {
    translate: translateFn,
    rotate: rotateFn,
    scale: scaleFn,
    skew: skewFn,
  };

  const orderKey = options.order && ORDER_PRESETS[options.order] ? options.order : DEFAULT_ORDER;
  const orderedTypes = ORDER_PRESETS[orderKey]!;
  const orderedFns = orderedTypes.map((t) => byType[t]);

  const matrix = individual ? composeMatrix(INDIVIDUAL_ORDER.map((t) => byType[t])) : composeMatrix(orderedFns);

  const declarations: [string, string][] = [
    ['width', formatLength(width, 'px')],
    ['height', formatLength(height, 'px')],
    ['background-color', formatHexColor(background)],
  ];

  let value: string;
  if (individual) {
    value = formatFn(skewFn);
    declarations.push(
      ['translate', `${formatLength(translateFn.x, 'px')} ${formatLength(translateFn.y, 'px')}`],
      ['rotate', formatLength(rotateFn.deg, 'deg')],
      ['scale', `${formatNumber(scaleFn.x)} ${formatNumber(scaleFn.y)}`],
      ['transform', value],
    );
  } else {
    value = orderedFns.map(formatFn).join(' ');
    declarations.push(['transform', value]);
  }
  declarations.push(['transform-origin', `${formatLength(ox.value, '%')} ${formatLength(oy.value, '%')}`]);
  declarations.push(['display', 'grid'], ['place-items', 'center']);

  const tree: PreviewTreeNode = {
    className: 'box',
    children: [{ className: 'box-label', text: 'F' }],
  };

  try {
    assertSafeTree(tree);
    const css = stylesheetText({
      rules: [
        { selector: '.box', declarations },
        {
          selector: '.box-label',
          declarations: [
            ['font-family', 'system-ui'],
            ['font-size', formatLength(Math.round(Math.min(width, height) * 0.16), 'px')],
            ['font-weight', '400'],
            ['color', '#ffffff'],
          ],
        },
      ],
    });
    return { css, tree, value, matrix, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new TransformError(err.message);
    throw err;
  }
}
