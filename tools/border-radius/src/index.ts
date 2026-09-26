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
  type LengthUnit,
  type PreviewTreeNode,
  type RgbaColor,
} from './css-safe';

export { meta };
export type { PreviewTreeNode };

export class BorderRadiusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BorderRadiusError';
  }
}

export interface CornerRadius {
  /** Horizontal radius. */
  x: number;
  /** Vertical radius. */
  y: number;
}

export interface BorderRadiusCorners {
  topLeft: CornerRadius;
  topRight: CornerRadius;
  bottomRight: CornerRadius;
  bottomLeft: CornerRadius;
}

export interface GenerateBorderRadiusOptions {
  corners: BorderRadiusCorners;
  /** 'px' or '%'. Default 'px'. */
  unit?: LengthUnit;
  /** Preview box width in px. Default 240, clamped to 40-480. */
  width?: number;
  /** Preview box height in px. Default 160, clamped to 40-480. */
  height?: number;
  /** Preview box background, as a 3/4/6/8-digit hex colour. Default '#2563eb'. */
  background?: string;
}

export interface BorderRadiusLonghands {
  topLeft: string;
  topRight: string;
  bottomRight: string;
  bottomLeft: string;
}

export interface GenerateBorderRadiusResult {
  /** One `.box` rule declaring width, height, background-color and border-radius. */
  css: string;
  /** The element tree the CSS styles: one box, no children. */
  tree: PreviewTreeNode;
  /** The shortest `border-radius` shorthand the CSS Backgrounds and Borders Level 3 value order and one-to-four expansion rules give back exactly. */
  shorthand: string;
  /** The four `border-*-radius` longhand values, each `<horizontal> <vertical>`. */
  longhands: BorderRadiusLonghands;
  /**
   * The scale factor the CSS Backgrounds and Borders Level 3 "Overlapping
   * Curves" rule would apply in a real browser, or null when the radii do
   * not overlap. This tool reports the factor; the pasted CSS itself is
   * left unscaled, since browsers already apply this algorithm themselves.
   */
  overlapScale: number | null;
  warnings: string[];
}

const DEFAULT_BACKGROUND = '#2563eb';

/**
 * Collapses a four-value CSS list (top-left, top-right, bottom-right,
 * bottom-left order) to its shortest equivalent form, following the same
 * one-to-four value expansion rule CSS Backgrounds and Borders Level 3
 * defines for the `border-radius` shorthand (and the same shape every
 * other CSS four-value shorthand, such as `margin`, uses): drop the fourth
 * value when it equals the second, then drop the third when it equals the
 * first, then drop the second when it equals the first.
 */
function shortenList([a, b, c, d]: [string, string, string, string]): string {
  if (d === b) {
    if (c === a) {
      if (b === a) return a;
      return `${a} ${b}`;
    }
    return `${a} ${b} ${c}`;
  }
  return `${a} ${b} ${c} ${d}`;
}

function clampCorner(corner: CornerRadius | undefined, name: string, max: number, warnings: string[]): CornerRadius {
  const c = corner ?? { x: 0, y: 0 };
  const x = clampNumber(`${name} horizontal radius`, c.x, 0, max, 0);
  const y = clampNumber(`${name} vertical radius`, c.y, 0, max, 0);
  if (x.warning) warnings.push(x.warning);
  if (y.warning) warnings.push(y.warning);
  return { x: x.value, y: y.value };
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
 * Generates a `border-radius` value (and the whole `.box` rule around it)
 * from four independent corner radii, per CSS Backgrounds and Borders
 * Module Level 3 (https://www.w3.org/TR/css-backgrounds-3/) sections 4.1
 * ("the border-radius properties") and 4.5 ("Overlapping Curves"), and CSS
 * Color Module Level 4 (https://www.w3.org/TR/css-color-4/) section 5.2 for
 * the hex colour written into `background-color`.
 */
export function generateBorderRadius(options: GenerateBorderRadiusOptions): GenerateBorderRadiusResult {
  const warnings: string[] = [];
  const unit: LengthUnit = options.unit === '%' ? '%' : 'px';
  const maxRadius = unit === '%' ? 100 : 400;

  const corners = options.corners ?? ({} as BorderRadiusCorners);
  const topLeft = clampCorner(corners.topLeft, 'Top-left corner', maxRadius, warnings);
  const topRight = clampCorner(corners.topRight, 'Top-right corner', maxRadius, warnings);
  const bottomRight = clampCorner(corners.bottomRight, 'Bottom-right corner', maxRadius, warnings);
  const bottomLeft = clampCorner(corners.bottomLeft, 'Bottom-left corner', maxRadius, warnings);

  const widthResult = clampNumber('Width', options.width ?? 240, 40, 480, 240);
  const heightResult = clampNumber('Height', options.height ?? 160, 40, 480, 160);
  if (widthResult.warning) warnings.push(widthResult.warning);
  if (heightResult.warning) warnings.push(heightResult.warning);
  const width = widthResult.value;
  const height = heightResult.value;

  const background = safeBackground(options.background, warnings);

  // CSS Backgrounds and Borders Level 3, section 4.5 "Overlapping Curves":
  // "Let f = min(Li/Si), where i in {top, right, bottom, left}, Si is the
  // sum of the two corresponding radii of the corners on side i, and
  // Ltop = Lbottom = the width of the box, and Lleft = Lright = the height
  // of the box. If f < 1, then all corner radii are reduced by multiplying
  // them by f." Percentages are resolved against the box size first.
  const resolveX = (v: number) => (unit === '%' ? (v / 100) * width : v);
  const resolveY = (v: number) => (unit === '%' ? (v / 100) * height : v);
  const sTop = resolveX(topLeft.x) + resolveX(topRight.x);
  const sBottom = resolveX(bottomLeft.x) + resolveX(bottomRight.x);
  const sLeft = resolveY(topLeft.y) + resolveY(bottomLeft.y);
  const sRight = resolveY(topRight.y) + resolveY(bottomRight.y);
  const ratios = [
    sTop > 0 ? width / sTop : Infinity,
    sBottom > 0 ? width / sBottom : Infinity,
    sLeft > 0 ? height / sLeft : Infinity,
    sRight > 0 ? height / sRight : Infinity,
  ];
  const f = Math.min(...ratios);
  const overlapScale = f < 1 ? f : null;
  if (overlapScale !== null) {
    warnings.push(
      `The corner radii overlap. A real browser would scale them all down by a factor of about ${formatNumber(overlapScale, 3)} (CSS Backgrounds and Borders Level 3, Overlapping Curves).`,
    );
  }

  const fmt = (v: number) => formatLength(v, unit);
  const hList: [string, string, string, string] = [
    fmt(topLeft.x),
    fmt(topRight.x),
    fmt(bottomRight.x),
    fmt(bottomLeft.x),
  ];
  const vList: [string, string, string, string] = [
    fmt(topLeft.y),
    fmt(topRight.y),
    fmt(bottomRight.y),
    fmt(bottomLeft.y),
  ];
  const sameAxes = hList.every((h, i) => h === vList[i]);
  const shorthand = sameAxes ? shortenList(hList) : `${shortenList(hList)} / ${shortenList(vList)}`;

  const longhands: BorderRadiusLonghands = {
    topLeft: `${fmt(topLeft.x)} ${fmt(topLeft.y)}`,
    topRight: `${fmt(topRight.x)} ${fmt(topRight.y)}`,
    bottomRight: `${fmt(bottomRight.x)} ${fmt(bottomRight.y)}`,
    bottomLeft: `${fmt(bottomLeft.x)} ${fmt(bottomLeft.y)}`,
  };

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
            ['background-color', formatHexColor(background)],
            ['border-radius', shorthand],
          ],
        },
      ],
    });
    return { css, tree, shorthand, longhands, overlapScale, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new BorderRadiusError(err.message);
    throw err;
  }
}
