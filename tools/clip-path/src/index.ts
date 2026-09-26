import meta from './meta.json';
import {
  CssSafetyError,
  clampNumber,
  formatLength,
  stylesheetText,
  assertSafeTree,
  type PreviewTreeNode,
} from './css-safe';

export { meta };
export type { PreviewTreeNode };

export class ClipPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClipPathError';
  }
}

export interface Point {
  x: number;
  y: number;
}

export type ClipShape = 'polygon' | 'circle' | 'ellipse' | 'inset';

export interface GenerateClipPathOptions {
  shape: ClipShape;
  /** Polygon only: 3 to 10 points, each a percent of the box. Default a regular pentagon. */
  points?: Point[];
  /** Polygon only: writes the evenodd fill rule. Default omitted (the nonzero default). */
  evenodd?: boolean;
  /** Circle only: radius in percent. Default 40. */
  radius?: number;
  /** Circle/ellipse: centre in percent. Default { x: 50, y: 50 }. */
  center?: Point;
  /** Ellipse only: horizontal radius in percent. Default 50. */
  radiusX?: number;
  /** Ellipse only: vertical radius in percent. Default 35. */
  radiusY?: number;
  /** Inset only, in percent. Default 10 each. */
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  /** Inset only: optional round radius in px. 0 or absent omits the round clause. */
  round?: number;
  /** Preview box width in px. Default 240, clamped to 40-480. */
  width?: number;
  /** Preview box height in px. Default 240, clamped to 40-480. */
  height?: number;
}

export interface GenerateClipPathResult {
  /** One `.box` rule declaring width, height, a fixed decorative background-image and clip-path. */
  css: string;
  /** The element tree the CSS styles: one box, no children. */
  tree: PreviewTreeNode;
  /** The clip-path value alone. */
  value: string;
  warnings: string[];
}

const MIN_POINTS = 3;
const MAX_POINTS = 10;

/**
 * CENTER and RADIUS describe the shared circle every regular-polygon preset
 * (and the five-point star) is computed from -- never a hand-typed
 * coordinate. `-90` starts the first vertex pointing straight up.
 */
const CENTER = 50;
const RADIUS = 50;

function round3(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? 0 : r;
}

function vertexAt(angleDeg: number, radius: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: round3(CENTER + radius * Math.cos(rad)), y: round3(CENTER + radius * Math.sin(rad)) };
}

function regularPolygon(sides: number): Point[] {
  return Array.from({ length: sides }, (_, i) => vertexAt(-90 + (360 / sides) * i, RADIUS));
}

/**
 * A five-point star's ten vertices, alternating outer (on the shared
 * circle) and inner. The inner radius is derived from the golden ratio (a
 * commonly used pentagram proportion, https://en.wikipedia.org/wiki/Golden_ratio) --
 * computed, never a hand-typed coordinate. No CSS specification defines a
 * star basic shape, so this is this tool's own choice (meta.json's own
 * ambiguities entry says so).
 */
function fivePointStar(): Point[] {
  const golden = (1 + Math.sqrt(5)) / 2;
  const innerRadius = RADIUS / (golden * golden);
  const points: Point[] = [];
  for (let i = 0; i < 5; i++) {
    const outerAngle = -90 + i * 72;
    points.push(vertexAt(outerAngle, RADIUS));
    points.push(vertexAt(outerAngle + 36, innerRadius));
  }
  return points;
}

export type PolygonPresetName = 'triangle' | 'rhombus' | 'pentagon' | 'hexagon' | 'octagon' | 'star';

/** Six regular-polygon presets (plus a five-point star), every vertex computed from the circle above. */
export const REGULAR_POLYGON_PRESETS: Record<PolygonPresetName, Point[]> = {
  triangle: regularPolygon(3),
  rhombus: regularPolygon(4),
  pentagon: regularPolygon(5),
  hexagon: regularPolygon(6),
  octagon: regularPolygon(8),
  star: fivePointStar(),
};

const DEFAULT_POINTS = REGULAR_POLYGON_PRESETS.pentagon;

function pct(n: number): string {
  return formatLength(n, '%');
}

function clampPercent(field: string, value: number, fallback: number, warnings: string[]): number {
  const r = clampNumber(field, value, 0, 100, fallback);
  if (r.warning) warnings.push(r.warning);
  return r.value;
}

function resolvePolygonValue(options: GenerateClipPathOptions, warnings: string[]): string {
  const raw =
    Array.isArray(options.points) && options.points.length >= MIN_POINTS
      ? options.points.slice(0, MAX_POINTS)
      : DEFAULT_POINTS;
  const points = raw.map((p, i) => ({
    x: clampPercent(`Point ${i + 1} horizontal`, p?.x ?? DEFAULT_POINTS[i % DEFAULT_POINTS.length]!.x, 50, warnings),
    y: clampPercent(`Point ${i + 1} vertical`, p?.y ?? DEFAULT_POINTS[i % DEFAULT_POINTS.length]!.y, 50, warnings),
  }));
  const prefix = options.evenodd ? 'evenodd, ' : '';
  return `polygon(${prefix}${points.map((p) => `${pct(p.x)} ${pct(p.y)}`).join(', ')})`;
}

function resolveCircleValue(options: GenerateClipPathOptions, warnings: string[]): string {
  const radius = clampPercent('Radius', options.radius ?? 40, 40, warnings);
  const center = options.center ?? { x: 50, y: 50 };
  const cx = clampPercent('Centre horizontal', center.x, 50, warnings);
  const cy = clampPercent('Centre vertical', center.y, 50, warnings);
  return `circle(${pct(radius)} at ${pct(cx)} ${pct(cy)})`;
}

function resolveEllipseValue(options: GenerateClipPathOptions, warnings: string[]): string {
  const rx = clampPercent('Horizontal radius', options.radiusX ?? 50, 50, warnings);
  const ry = clampPercent('Vertical radius', options.radiusY ?? 35, 35, warnings);
  const center = options.center ?? { x: 50, y: 50 };
  const cx = clampPercent('Centre horizontal', center.x, 50, warnings);
  const cy = clampPercent('Centre vertical', center.y, 50, warnings);
  return `ellipse(${pct(rx)} ${pct(ry)} at ${pct(cx)} ${pct(cy)})`;
}

function resolveInsetValue(options: GenerateClipPathOptions, warnings: string[]): string {
  const top = clampPercent('Top offset', options.top ?? 10, 10, warnings);
  const right = clampPercent('Right offset', options.right ?? 10, 10, warnings);
  const bottom = clampPercent('Bottom offset', options.bottom ?? 10, 10, warnings);
  const left = clampPercent('Left offset', options.left ?? 10, 10, warnings);
  const roundResult = clampNumber('Round radius', options.round ?? 0, 0, 200, 0);
  if (roundResult.warning) warnings.push(roundResult.warning);
  const round = roundResult.value;
  const base = `inset(${pct(top)} ${pct(right)} ${pct(bottom)} ${pct(left)}`;
  return round > 0 ? `${base} round ${formatLength(round, 'px')})` : `${base})`;
}

/**
 * Generates a `clip-path` value (and the whole `.box` rule around it) from
 * a polygon, circle, ellipse or inset basic shape, per CSS Shapes Module
 * Level 1 (https://www.w3.org/TR/css-shapes-1/) and CSS Masking Module
 * Level 1 (https://www.w3.org/TR/css-masking-1/) section 4.1 for the
 * clip-path property itself. Only these four closed function forms are
 * ever produced, so the reference (SVG-fragment) form CSS Masking Level 1
 * would otherwise allow is structurally impossible.
 */
export function generateClipPath(options: GenerateClipPathOptions): GenerateClipPathResult {
  const warnings: string[] = [];
  const shape: ClipShape = ['polygon', 'circle', 'ellipse', 'inset'].includes(options.shape)
    ? options.shape
    : 'polygon';

  let value: string;
  switch (shape) {
    case 'polygon':
      value = resolvePolygonValue(options, warnings);
      break;
    case 'circle':
      value = resolveCircleValue(options, warnings);
      break;
    case 'ellipse':
      value = resolveEllipseValue(options, warnings);
      break;
    case 'inset':
      value = resolveInsetValue(options, warnings);
      break;
  }

  const widthResult = clampNumber('Width', options.width ?? 240, 40, 480, 240);
  const heightResult = clampNumber('Height', options.height ?? 240, 40, 480, 240);
  if (widthResult.warning) warnings.push(widthResult.warning);
  if (heightResult.warning) warnings.push(heightResult.warning);
  const width = widthResult.value;
  const height = heightResult.value;

  const tree: PreviewTreeNode = { className: 'box' };

  try {
    assertSafeTree(tree);
    const css = stylesheetText({
      rules: [
        {
          selector: '.box',
          declarations: [
            ['width', formatLength(width, 'px')],
            ['height', formatLength(height, 'px')],
            // A fixed decorative gradient this tool chooses (never a
            // visitor-supplied image reference), so the drawn shape stays
            // visible against it regardless of which shape is selected.
            ['background-image', 'linear-gradient(135deg, rgb(99, 102, 241), rgb(236, 72, 153))'],
            ['clip-path', value],
          ],
        },
      ],
    });
    return { css, tree, value, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new ClipPathError(err.message);
    throw err;
  }
}
