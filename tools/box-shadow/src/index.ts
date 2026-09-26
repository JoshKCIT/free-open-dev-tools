import meta from './meta.json';
import {
  CssSafetyError,
  clampNumber,
  formatLength,
  parseHexColor,
  formatHexColor,
  stylesheetText,
  assertSafeTree,
  type PreviewTreeNode,
  type RgbaColor,
} from './css-safe';

export { meta };
export type { PreviewTreeNode };

export class BoxShadowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoxShadowError';
  }
}

export interface BoxShadowLayer {
  /** Horizontal offset in px. A positive value draws the shadow to the right. */
  x: number;
  /** Vertical offset in px. A positive value draws the shadow downward. */
  y: number;
  /** Blur radius in px. Negative values are invalid per the specification and are clamped to 0. */
  blur: number;
  /** Spread distance in px. May be negative. */
  spread: number;
  /** The shadow colour, as a 3/4/6/8-digit hex colour. */
  color: string;
  /** Opacity 0-100 percent, folded into the colour's own alpha channel. */
  opacity: number;
  /** Whether this is an inner ("inset") shadow rather than an outer one. */
  inset: boolean;
}

export interface GenerateBoxShadowOptions {
  /** One to four layers, front to back -- the first layer is painted on top. */
  layers: BoxShadowLayer[];
  /** Preview box width in px. Default 240, clamped to 40-480. */
  width?: number;
  /** Preview box height in px. Default 160, clamped to 40-480. */
  height?: number;
  /** Corner rounding in px. Default 12, clamped to 0-120. */
  radius?: number;
  /** Preview box background, as a 3/4/6/8-digit hex colour. Default '#ffffff'. */
  background?: string;
}

export interface GenerateBoxShadowResult {
  /** One `.box` rule declaring width, height, background-color, border-radius and box-shadow. */
  css: string;
  /** The element tree the CSS styles: one box, no children. */
  tree: PreviewTreeNode;
  /** The `box-shadow` value alone (the shadow list, without the rest of the rule). */
  value: string;
  warnings: string[];
}

const DEFAULT_BACKGROUND = '#ffffff';
const DEFAULT_LAYER_COLOR = '#000000';
const MAX_LAYERS = 4;

interface ResolvedLayer {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: RgbaColor;
  inset: boolean;
}

function safeLayerColor(
  text: string | undefined,
  opacity: number | undefined,
  field: string,
  warnings: string[],
): RgbaColor {
  let base: RgbaColor;
  try {
    base = parseHexColor(text ?? DEFAULT_LAYER_COLOR, field);
  } catch {
    warnings.push(`${field} was not a valid hex colour, so the default was used instead.`);
    base = parseHexColor(DEFAULT_LAYER_COLOR);
  }
  const op = clampNumber(`${field} opacity`, opacity ?? 100, 0, 100, 100);
  if (op.warning) warnings.push(op.warning);
  return { r: base.r, g: base.g, b: base.b, alpha: op.value / 100 };
}

function resolveLayer(layer: Partial<BoxShadowLayer> | undefined, index: number, warnings: string[]): ResolvedLayer {
  const name = `Layer ${index + 1}`;
  const x = clampNumber(`${name} horizontal offset`, layer?.x ?? 0, -200, 200, 0);
  const y = clampNumber(`${name} vertical offset`, layer?.y ?? 0, -200, 200, 0);
  // CSS Backgrounds and Borders Level 3, section 6.1: "3rd <length [0,∞]>
  // Specifies the blur radius ... Negative values are invalid." Clamped to
  // zero here, consistent with every other field this tool clamps rather
  // than refuses.
  const blur = clampNumber(`${name} blur`, layer?.blur ?? 0, 0, 200, 0);
  const spread = clampNumber(`${name} spread`, layer?.spread ?? 0, -100, 100, 0);
  for (const r of [x, y, blur, spread]) if (r.warning) warnings.push(r.warning);
  const color = safeLayerColor(layer?.color, layer?.opacity, `${name} colour`, warnings);
  return { x: x.value, y: y.value, blur: blur.value, spread: spread.value, color, inset: Boolean(layer?.inset) };
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
 * `formatLength` with `bareZero` -- this tool's own documented zero-length
 * form (an ambiguity: CSS allows either "0" or "0px" for a zero length; this
 * package always writes the bare form, everywhere).
 */
function len(n: number): string {
  return formatLength(n, 'px', { bareZero: true });
}

/**
 * Writes one `<shadow>` per CSS Backgrounds and Borders Level 3's own
 * component order: offset-x, offset-y, blur radius, spread distance,
 * colour, then the optional `inset` keyword.
 */
function layerValue(layer: ResolvedLayer): string {
  const parts = [len(layer.x), len(layer.y), len(layer.blur), len(layer.spread), formatHexColor(layer.color)];
  if (layer.inset) parts.push('inset');
  return parts.join(' ');
}

/**
 * Generates a `box-shadow` value (and the whole `.box` rule around it) from
 * one to four independent shadow layers, per CSS Backgrounds and Borders
 * Module Level 3 (https://www.w3.org/TR/css-backgrounds-3/) section 6.1
 * ("Drop Shadows: the box-shadow property"): "<shadow># = <color>? && [
 * <length>{2} <length [0,∞]>? <length>? ] && inset?" and "The property
 * accepts ... a comma-separated list of shadows, ordered front to back" --
 * so the first layer supplied is the one painted on top. CSS Color Module
 * Level 4 (https://www.w3.org/TR/css-color-4/) section 5.2 governs the hex
 * colour each layer and the background are written as.
 */
export function generateBoxShadow(options: GenerateBoxShadowOptions): GenerateBoxShadowResult {
  const warnings: string[] = [];
  const rawLayers =
    Array.isArray(options.layers) && options.layers.length > 0 ? options.layers.slice(0, MAX_LAYERS) : [{}];
  const layers = rawLayers.map((layer, i) => resolveLayer(layer, i, warnings));

  const widthResult = clampNumber('Width', options.width ?? 240, 40, 480, 240);
  const heightResult = clampNumber('Height', options.height ?? 160, 40, 480, 160);
  const radiusResult = clampNumber('Corner rounding', options.radius ?? 12, 0, 120, 12);
  for (const r of [widthResult, heightResult, radiusResult]) if (r.warning) warnings.push(r.warning);
  const width = widthResult.value;
  const height = heightResult.value;
  const radius = radiusResult.value;

  const background = safeBackground(options.background, warnings);

  const value = layers.map(layerValue).join(', ');
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
            ['border-radius', len(radius)],
            ['box-shadow', value],
          ],
        },
      ],
    });
    return { css, tree, value, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new BoxShadowError(err.message);
    throw err;
  }
}
