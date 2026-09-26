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

export class GradientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GradientError';
  }
}

export type GradientType = 'linear' | 'radial' | 'conic';
export type RadialShape = 'circle' | 'ellipse';
export type RadialSize = 'closest-side' | 'closest-corner' | 'farthest-side' | 'farthest-corner';

const RADIAL_SIZES: readonly RadialSize[] = ['closest-side', 'closest-corner', 'farthest-side', 'farthest-corner'];

export interface GradientStop {
  /** A 3/4/6/8-digit hex colour. */
  color: string;
  /** Position along the gradient line (linear/radial) or around the circle (conic), 0-100 percent. */
  at: number;
}

export interface GenerateGradientOptions {
  /** 'linear', 'radial' or 'conic'. Default 'linear'. */
  type?: GradientType;
  /** Whether to use the repeating form of the chosen type. Default false. */
  repeating?: boolean;
  /** Start angle in degrees. Used by linear (the gradient line's direction) and conic (the rotation). Default 90. */
  angle?: number;
  /** Ending-shape keyword. Radial only. Default 'ellipse'. */
  shape?: RadialShape;
  /** Ending-size keyword. Radial only. Default 'farthest-corner'. */
  size?: RadialSize;
  /** Centre, in percent of the box. Radial and conic only. Default { x: 50, y: 50 }. */
  position?: { x: number; y: number };
  /** Two to five colour stops, in the order they should be written. */
  stops: GradientStop[];
  /** Preview box width in px. Default 240, clamped to 40-480. */
  width?: number;
  /** Preview box height in px. Default 160, clamped to 40-480. */
  height?: number;
}

export interface GenerateGradientResult {
  /** One `.box` rule declaring width, height and background-image. */
  css: string;
  /** The element tree the CSS styles: one box, no children. */
  tree: PreviewTreeNode;
  /** The gradient function alone (the value background-image is set to). */
  value: string;
  warnings: string[];
}

const MIN_STOPS = 2;
const MAX_STOPS = 5;

/** Fallback colours used only when a stop's own colour is missing or invalid. */
const STOP_DEFAULT_COLORS = ['#f97316', '#ec4899', '#6366f1', '#22d3ee', '#a3e635'];
const STOP_DEFAULT_AT = [0, 50, 100, 75, 90];

const DEFAULT_STOPS: GradientStop[] = [
  { color: STOP_DEFAULT_COLORS[0]!, at: STOP_DEFAULT_AT[0]! },
  { color: STOP_DEFAULT_COLORS[1]!, at: STOP_DEFAULT_AT[1]! },
  { color: STOP_DEFAULT_COLORS[2]!, at: STOP_DEFAULT_AT[2]! },
];

interface ResolvedStop {
  color: RgbaColor;
  at: number;
}

function resolveStop(raw: Partial<GradientStop> | undefined, i: number, warnings: string[]): ResolvedStop {
  const fallbackColor = STOP_DEFAULT_COLORS[i % STOP_DEFAULT_COLORS.length]!;
  const fallbackAt = STOP_DEFAULT_AT[i % STOP_DEFAULT_AT.length]!;
  let color: RgbaColor;
  try {
    color = parseHexColor(raw?.color ?? fallbackColor, `Stop ${i + 1} colour`);
  } catch {
    warnings.push(`Stop ${i + 1} colour was not a valid hex colour, so the default was used instead.`);
    color = parseHexColor(fallbackColor);
  }
  const atResult = clampNumber(`Stop ${i + 1} position`, raw?.at ?? fallbackAt, 0, 100, fallbackAt);
  if (atResult.warning) warnings.push(atResult.warning);
  return { color, at: atResult.value };
}

/**
 * Detects a stop whose position is below the largest position of any stop
 * before it, per CSS Images Module Level 3
 * (https://www.w3.org/TR/css-images-3/), section 3.4.3 "Color Stop Fixup":
 * "If a color stop ... has a position that is less than the specified
 * position of any color stop ... before it in the list, set its position to
 * be equal to the largest specified position of any color stop ... before
 * it." This function only warns -- the stops below are written exactly as
 * given, so a real browser applies the rule itself and the preview shows the
 * same result the pasted CSS would produce.
 */
function warnAboutFixup(stops: ResolvedStop[], warnings: string[]): void {
  let runningMaxAt = -Infinity;
  let runningMaxIndex = -1;
  for (let i = 0; i < stops.length; i++) {
    const at = stops[i]!.at;
    if (i > 0 && at < runningMaxAt) {
      warnings.push(
        `Stop ${i + 1} at ${formatNumber(at)}% comes before stop ${runningMaxIndex + 1} at ${formatNumber(runningMaxAt)}%. A real browser's colour stop fix-up rule (CSS Images Level 3, "Color Stop Fixup") will move stop ${i + 1} forward to ${formatNumber(runningMaxAt)}% instead of leaving it where it was written.`,
      );
    } else {
      runningMaxAt = at;
      runningMaxIndex = i;
    }
  }
}

/**
 * Generates a gradient function (`linear-gradient`, `radial-gradient` or
 * `conic-gradient`, or its repeating form) and the whole `.box` rule around
 * it, per CSS Images Module Level 3
 * (https://www.w3.org/TR/css-images-3/) sections 3.1 ("Linear Gradients"),
 * 3.2 ("Radial Gradients") and 3.3 ("Repeating Gradients"), and CSS Images
 * Module Level 4 (https://www.w3.org/TR/css-images-4/) section 3.3 ("Conic
 * Gradients").
 *
 * Linear: `<linear-gradient-syntax> = [ <angle> | to <side-or-corner> ]?,
 * <color-stop-list>` -- this tool always writes the explicit `<angle>` form
 * (never the keyword form), citing the specification's own note that
 * `linear-gradient(180deg, yellow, blue)` is one of several equivalent forms
 * of `linear-gradient(yellow, blue)` ("0deg points upward, and positive
 * angles represent clockwise rotation").
 *
 * Radial: `<radial-gradient-syntax> = [ <radial-shape> || <radial-size> ]?
 * [ at <position> ]?, <color-stop-list>` -- this tool always writes both the
 * shape and the size keyword, then the position, in that order.
 *
 * Conic: `<conic-gradient-syntax> = [ [ [ from [ <angle> | <zero> ] ]? [ at
 * <position> ]? ] || <color-interpolation-method> ]?, <angular-color-stop-list>`
 * -- this tool always writes `from <angle> at <position>`. Conic stops are
 * defined by `<color-stop-angle> = [ <angle-percentage> | <zero> ]{1,2}`,
 * which accepts a plain percentage (CSS Images Level 4 section 3.3.2, "Note
 * that <color-stop-list> and <angular-color-stop-list> are exactly identical
 * in structure"), so this tool writes every stop's position as a percentage
 * regardless of gradient type, for one consistent field shape across all
 * three.
 */
export function generateGradient(options: GenerateGradientOptions): GenerateGradientResult {
  const warnings: string[] = [];
  const type: GradientType = options.type === 'radial' || options.type === 'conic' ? options.type : 'linear';
  const repeating = Boolean(options.repeating);

  const angleResult = clampNumber('Angle', options.angle ?? 90, 0, 360, 90);
  if (angleResult.warning) warnings.push(angleResult.warning);
  const angle = angleResult.value;

  const shape: RadialShape = options.shape === 'circle' ? 'circle' : 'ellipse';
  const size: RadialSize = RADIAL_SIZES.includes(options.size as RadialSize) ? (options.size as RadialSize) : 'farthest-corner';

  const posXResult = clampNumber('Centre horizontal position', options.position?.x ?? 50, 0, 100, 50);
  const posYResult = clampNumber('Centre vertical position', options.position?.y ?? 50, 0, 100, 50);
  if (posXResult.warning) warnings.push(posXResult.warning);
  if (posYResult.warning) warnings.push(posYResult.warning);

  const widthResult = clampNumber('Width', options.width ?? 240, 40, 480, 240);
  const heightResult = clampNumber('Height', options.height ?? 160, 40, 480, 160);
  if (widthResult.warning) warnings.push(widthResult.warning);
  if (heightResult.warning) warnings.push(heightResult.warning);
  const width = widthResult.value;
  const height = heightResult.value;

  const rawStops =
    Array.isArray(options.stops) && options.stops.length >= MIN_STOPS ? options.stops.slice(0, MAX_STOPS) : DEFAULT_STOPS;
  const stops = rawStops.map((s, i) => resolveStop(s, i, warnings));
  warnAboutFixup(stops, warnings);

  const stopList = stops.map((s) => `${formatHexColor(s.color)} ${formatLength(s.at, '%')}`);

  let descriptor: string;
  if (type === 'linear') {
    descriptor = formatLength(angle, 'deg');
  } else if (type === 'radial') {
    descriptor = `${shape} ${size} at ${formatLength(posXResult.value, '%')} ${formatLength(posYResult.value, '%')}`;
  } else {
    descriptor = `from ${formatLength(angle, 'deg')} at ${formatLength(posXResult.value, '%')} ${formatLength(posYResult.value, '%')}`;
  }

  const fnName = `${repeating ? 'repeating-' : ''}${type}-gradient`;
  const value = `${fnName}(${descriptor}, ${stopList.join(', ')})`;

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
            ['background-image', value],
          ],
        },
      ],
    });
    return { css, tree, value, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new GradientError(err.message);
    throw err;
  }
}
