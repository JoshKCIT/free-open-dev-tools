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

export class TextShadowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextShadowError';
  }
}

export interface TextShadowLayer {
  /** Horizontal offset in px. */
  x: number;
  /** Vertical offset in px. */
  y: number;
  /** Blur radius in px. Negative values are invalid per the specification and are clamped to 0. */
  blur: number;
  /** The shadow colour, as a 3/4/6/8-digit hex colour. */
  color: string;
  /** Opacity 0-100 percent, folded into the colour's own alpha channel. */
  opacity: number;
}

/**
 * The closed subset of CSS Fonts Level 4's own `<generic-family>` keywords
 * this tool offers for the preview font (https://www.w3.org/TR/css-fonts-4/#generic-font-families).
 */
export type TextShadowFontFamily = 'sans-serif' | 'serif' | 'monospace' | 'system-ui';

export interface GenerateTextShadowOptions {
  /** One to four layers, front to back -- the first layer is painted on top. */
  layers: TextShadowLayer[];
  /** The visitor's own sample text. Trimmed, capped at 80 characters. Default 'Shadow'. */
  sample?: string;
  /** A generic font family. Default 'sans-serif'. */
  fontFamily?: TextShadowFontFamily;
  /** Font size in px. Default 64, clamped to 12-160. */
  fontSize?: number;
  /** Font weight: 400, 700 or 900. Default 400. */
  fontWeight?: 400 | 700 | 900;
  /** Sample text colour, as a 3/4/6/8-digit hex colour. Default '#0f172a'. */
  textColor?: string;
  /** Preview box background, as a 3/4/6/8-digit hex colour. Default '#ffffff'. */
  background?: string;
  /** Preview box width in px. Default 360, clamped to 120-720. */
  width?: number;
  /** Preview box height in px. Default 160, clamped to 40-400. */
  height?: number;
}

export interface GenerateTextShadowResult {
  /** One `.text` rule declaring layout, font, colours and text-shadow. */
  css: string;
  /** The element tree the CSS styles: one text element carrying the sample. */
  tree: PreviewTreeNode;
  /** The `text-shadow` value alone (the shadow list, without the rest of the rule). */
  value: string;
  warnings: string[];
}

const DEFAULT_BACKGROUND = '#ffffff';
const DEFAULT_TEXT_COLOR = '#0f172a';
const DEFAULT_LAYER_COLOR = '#000000';
const MAX_LAYERS = 4;
const MAX_SAMPLE_LENGTH = 80;
const FONT_FAMILIES: readonly TextShadowFontFamily[] = ['sans-serif', 'serif', 'monospace', 'system-ui'];
const FONT_WEIGHTS: readonly number[] = [400, 700, 900];

interface ResolvedLayer {
  x: number;
  y: number;
  blur: number;
  color: RgbaColor;
}

function safeLayerColor(text: string | undefined, opacity: number | undefined, field: string, warnings: string[]): RgbaColor {
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

function resolveLayer(layer: Partial<TextShadowLayer> | undefined, index: number, warnings: string[]): ResolvedLayer {
  const name = `Layer ${index + 1}`;
  const x = clampNumber(`${name} horizontal offset`, layer?.x ?? 0, -100, 100, 0);
  const y = clampNumber(`${name} vertical offset`, layer?.y ?? 0, -100, 100, 0);
  // CSS Text Decoration Level 3, section 4: "Values are interpreted as for
  // box-shadow" -- box-shadow's own blur radius may not be negative, so
  // this is clamped to zero here too, consistent with every other field.
  const blur = clampNumber(`${name} blur`, layer?.blur ?? 0, 0, 100, 0);
  for (const r of [x, y, blur]) if (r.warning) warnings.push(r.warning);
  const color = safeLayerColor(layer?.color, layer?.opacity, `${name} colour`, warnings);
  return { x: x.value, y: y.value, blur: blur.value, color };
}

function safeColor(text: string | undefined, fallback: string, field: string, warnings: string[]): RgbaColor {
  try {
    return parseHexColor(text ?? fallback, field);
  } catch {
    warnings.push(`${field} was not a valid hex colour, so the default was used instead.`);
    return parseHexColor(fallback);
  }
}

function safeFontFamily(value: unknown, warnings: string[]): TextShadowFontFamily {
  if (typeof value === 'string' && (FONT_FAMILIES as readonly string[]).includes(value)) {
    return value as TextShadowFontFamily;
  }
  warnings.push('Font family was not one of the offered generic families, so sans-serif was used instead.');
  return 'sans-serif';
}

function safeFontWeight(value: unknown, warnings: string[]): 400 | 700 | 900 {
  if (typeof value === 'number' && FONT_WEIGHTS.includes(value)) return value as 400 | 700 | 900;
  warnings.push('Font weight was not 400, 700 or 900, so 400 was used instead.');
  return 400;
}

function safeSample(text: string | undefined, warnings: string[]): string {
  const trimmed = (text ?? '').trim();
  const base = trimmed.length > 0 ? trimmed : 'Shadow';
  if (base.length > MAX_SAMPLE_LENGTH) {
    warnings.push(`The sample text was longer than ${MAX_SAMPLE_LENGTH} characters, so it was shortened.`);
    return base.slice(0, MAX_SAMPLE_LENGTH);
  }
  return base;
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
 * Writes one `<shadow>` per CSS Text Decoration Level 3's own component
 * order: offset-x, offset-y, blur radius, colour. No spread distance, no
 * inset keyword -- the specification states outright that neither exists
 * for this property.
 */
function layerValue(layer: ResolvedLayer): string {
  return [len(layer.x), len(layer.y), len(layer.blur), formatHexColor(layer.color)].join(' ');
}

/**
 * Generates a `text-shadow` value (and the whole `.text` rule around it)
 * from one to four independent shadow layers, per CSS Text Decoration
 * Module Level 3 (https://www.w3.org/TR/css-text-decor-3/) section 4 ("Text
 * Shadows: the text-shadow property"): "Value: none | [ <color>? &&
 * <length>{2,3} ] # ... Values are interpreted as for box-shadow
 * [CSS-BACKGROUNDS-3]. (But note that spread values and the inset keyword
 * are not allowed.) ... The shadow effects are applied front-to-back: the
 * first shadow is on top." The preview font is drawn from CSS Fonts Module
 * Level 4's own generic font families
 * (https://www.w3.org/TR/css-fonts-4/#generic-font-families), and colours
 * from CSS Color Module Level 4 (https://www.w3.org/TR/css-color-4/)
 * section 5.2.
 */
export function generateTextShadow(options: GenerateTextShadowOptions): GenerateTextShadowResult {
  const warnings: string[] = [];
  const rawLayers =
    Array.isArray(options.layers) && options.layers.length > 0 ? options.layers.slice(0, MAX_LAYERS) : [{}];
  const layers = rawLayers.map((layer, i) => resolveLayer(layer, i, warnings));

  const fontFamily = safeFontFamily(options.fontFamily, warnings);
  const fontWeight = safeFontWeight(options.fontWeight, warnings);
  const fontSizeResult = clampNumber('Font size', options.fontSize ?? 64, 12, 160, 64);
  const widthResult = clampNumber('Width', options.width ?? 360, 120, 720, 360);
  const heightResult = clampNumber('Height', options.height ?? 160, 40, 400, 160);
  for (const r of [fontSizeResult, widthResult, heightResult]) if (r.warning) warnings.push(r.warning);

  const textColor = safeColor(options.textColor, DEFAULT_TEXT_COLOR, 'Text colour', warnings);
  const background = safeColor(options.background, DEFAULT_BACKGROUND, 'Background colour', warnings);
  const sample = safeSample(options.sample, warnings);

  const value = layers.map(layerValue).join(', ');
  const tree: PreviewTreeNode = { className: 'text', text: sample };

  try {
    assertSafeTree(tree);
    const css = stylesheetText({
      rules: [
        {
          selector: '.text',
          declarations: [
            ['display', 'grid'],
            ['place-items', 'center'],
            ['width', formatLength(widthResult.value, 'px')],
            ['height', formatLength(heightResult.value, 'px')],
            ['font-family', fontFamily],
            ['font-size', formatLength(fontSizeResult.value, 'px')],
            ['font-weight', String(fontWeight)],
            ['line-height', '1.2'],
            ['color', formatHexColor(textColor)],
            ['background-color', formatHexColor(background)],
            ['text-shadow', value],
          ],
        },
      ],
    });
    return { css, tree, value, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new TextShadowError(err.message);
    throw err;
  }
}
