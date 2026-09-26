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

export class EffectsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EffectsError';
  }
}

/** The four soft UI shapes this tool writes. */
export type SoftShape = 'flat' | 'concave' | 'convex' | 'pressed';
const SOFT_SHAPES: readonly SoftShape[] = ['flat', 'concave', 'convex', 'pressed'];

function clampChannel(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * Mixes an already-parsed colour's own sRGB channels a percentage of the way
 * toward white (255 per channel) or black (0 per channel), rounding each
 * channel to the nearest integer. This is this tool's own construction of
 * the widely used soft UI shadow look (documented in `meta.json`'s
 * `ambiguities` as not defined by any CSS specification): a conventional
 * linear per-channel mix, not a perceptual colour space blend.
 */
export function mixTowards(color: RgbaColor, target: 'white' | 'black', amount: number): RgbaColor {
  const t = target === 'white' ? 255 : 0;
  const a = Math.max(0, Math.min(100, amount)) / 100;
  return {
    r: clampChannel(color.r + (t - color.r) * a),
    g: clampChannel(color.g + (t - color.g) * a),
    b: clampChannel(color.b + (t - color.b) * a),
    alpha: color.alpha,
  };
}

/**
 * WCAG 2.2's own "relative luminance" definition: "For the sRGB colorspace,
 * the relative luminance of a color is defined as L = 0.2126 * R + 0.7152 *
 * G + 0.0722 * B where R, G and B are defined as: if RsRGB <= 0.04045 then R
 * = RsRGB/12.92 else R = ((RsRGB+0.055)/1.055) ^ 2.4 ... and RsRGB, GsRGB,
 * and BsRGB are defined as: RsRGB = R8bit/255".
 */
function relativeLuminance(color: RgbaColor): number {
  const channel = (v8bit: number): number => {
    const v = v8bit / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/**
 * WCAG 2.2's own "contrast ratio" definition: "(L1 + 0.05) / (L2 + 0.05),
 * where L1 is the relative luminance of the lighter of the colors, and L2 is
 * the relative luminance of the darker of the colors."
 */
function contrastRatio(a: RgbaColor, b: RgbaColor): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const l1 = Math.max(la, lb);
  const l2 = Math.min(la, lb);
  return (l1 + 0.05) / (l2 + 0.05);
}

export interface GlassOptions {
  /** In px. Default 12, clamped 0-40. */
  blur?: number;
  /** In percent. Default 160, clamped 100-200. */
  saturation?: number;
  /** The tint colour, as a 3/4/6/8-digit hex colour. Default '#ffffff'. */
  tint?: string;
  /** In percent, used as the tint's own alpha. Default 20, clamped 0-100. */
  tintOpacity?: number;
  /** In percent, the white border line's own alpha. Default 40, clamped 0-100. */
  borderOpacity?: number;
  /** In px. Default 16, clamped 0-48. */
  rounding?: number;
}

export interface SoftOptions {
  /** The base colour, as a 3/4/6/8-digit hex colour. Default '#e0e5ec'. */
  base?: string;
  /** In px. Default 8, clamped 1-40. */
  distance?: number;
  /** In px. Default 16, clamped 0-80. */
  blur?: number;
  /** In percent. Default 15, clamped 1-50. */
  intensity?: number;
  shape?: SoftShape;
  /** In px. Default 20, clamped 0-48. */
  rounding?: number;
}

export interface GenerateEffectOptions {
  /** 'glass' or 'soft'. Default 'glass'. */
  mode?: 'glass' | 'soft';
  glass?: GlassOptions;
  soft?: SoftOptions;
  /** Preview box width in px. Default 240, clamped 80-400 (glass) or 40-480 (soft, via the scene). */
  width?: number;
  /** Preview box height in px. Default 160, clamped 80-400 (glass) or 40-480 (soft). */
  height?: number;
}

export interface GenerateEffectResult {
  /** The .glass rule (glass mode) or the .scene/.soft rules (soft mode). */
  css: string;
  /** The element tree the CSS styles. */
  tree: PreviewTreeNode;
  /** 'pattern' in glass mode (the preview needs a busy backdrop to blur), 'plain' in soft mode. */
  backdrop: 'plain' | 'pattern';
  /** The WCAG 2.2 contrast ratio between the darker shadow and the base colour, in soft mode; null in glass mode. */
  contrastRatio: number | null;
  warnings: string[];
}

const DEFAULT_TINT = '#ffffff';
const DEFAULT_BASE = '#e0e5ec';

function safeColor(text: string | undefined, field: string, fallback: string, warnings: string[]): RgbaColor {
  try {
    return parseHexColor(text ?? fallback, field);
  } catch {
    warnings.push(`${field} was not a valid hex colour, so the default was used instead.`);
    return parseHexColor(fallback);
  }
}

function withAlpha(color: RgbaColor, alpha: number): RgbaColor {
  return { r: color.r, g: color.g, b: color.b, alpha };
}

function generateGlass(
  options: GlassOptions | undefined,
  width: number,
  height: number,
  warnings: string[],
): GenerateEffectResult {
  const g = options ?? {};
  // Filter Effects Module Level 2, section 2 "Backdrop filters: the
  // backdrop-filter property": "If the value ... is none then there is no
  // filter effect applied. Otherwise, the list of functions are applied in
  // the order provided." No specification bound is placed on blur or
  // saturate's own arguments; the ranges below are this tool's own.
  const blur = clampNumber('Blur', g.blur ?? 12, 0, 40, 12);
  const saturation = clampNumber('Saturation', g.saturation ?? 160, 100, 200, 160);
  const tintOpacity = clampNumber('Tint opacity', g.tintOpacity ?? 20, 0, 100, 20);
  const borderOpacity = clampNumber('Border opacity', g.borderOpacity ?? 40, 0, 100, 40);
  const rounding = clampNumber('Corner rounding', g.rounding ?? 16, 0, 48, 16);
  for (const r of [blur, saturation, tintOpacity, borderOpacity, rounding]) if (r.warning) warnings.push(r.warning);

  const tintBase = safeColor(g.tint, 'Tint colour', DEFAULT_TINT, warnings);
  const tint = withAlpha(tintBase, tintOpacity.value / 100);
  const borderColor = withAlpha({ r: 255, g: 255, b: 255, alpha: 1 }, borderOpacity.value / 100);

  const filterValue = `blur(${formatLength(blur.value, 'px')}) saturate(${formatLength(saturation.value, '%')})`;

  const declarations: [string, string][] = [
    ['width', formatLength(width, 'px')],
    ['height', formatLength(height, 'px')],
    ['background-color', formatHexColor(tint)],
    ['backdrop-filter', filterValue],
    // Safari versions before unprefixed support; confirmed directly against
    // the installed css-tree 3.2.1 lexer that this vendor-prefixed property
    // name is recognised, so no KNOWN_DIFFERENCES entry is needed.
    ['-webkit-backdrop-filter', filterValue],
    ['border', `1px solid ${formatHexColor(borderColor)}`],
    ['border-radius', formatLength(rounding.value, 'px', { bareZero: true })],
    ['box-shadow', '0px 8px 32px 0px #00000026'],
    ['display', 'grid'],
    ['place-items', 'center'],
  ];

  const tree: PreviewTreeNode = {
    className: 'glass',
    children: [{ className: 'glass-label', text: 'Frosted glass' }],
  };

  try {
    assertSafeTree(tree);
    const css = stylesheetText({
      rules: [
        { selector: '.glass', declarations },
        {
          selector: '.glass-label',
          declarations: [
            ['color', '#ffffff'],
            ['font-family', 'system-ui'],
            ['font-size', formatLength(16, 'px')],
            ['font-weight', '600'],
          ],
        },
      ],
    });
    return { css, tree, backdrop: 'pattern', contrastRatio: null, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new EffectsError(err.message);
    throw err;
  }
}

function generateSoft(
  options: SoftOptions | undefined,
  width: number,
  height: number,
  warnings: string[],
): GenerateEffectResult {
  const s = options ?? {};
  const distance = clampNumber('Shadow distance', s.distance ?? 8, 1, 40, 8);
  const blur = clampNumber('Blur', s.blur ?? 16, 0, 80, 16);
  const intensity = clampNumber('Intensity', s.intensity ?? 15, 1, 50, 15);
  const rounding = clampNumber('Corner rounding', s.rounding ?? 20, 0, 48, 20);
  for (const r of [distance, blur, intensity, rounding]) if (r.warning) warnings.push(r.warning);

  const shape: SoftShape = SOFT_SHAPES.includes(s.shape as SoftShape) ? (s.shape as SoftShape) : 'flat';
  const base = safeColor(s.base, 'Base colour', DEFAULT_BASE, warnings);

  // Each shadow colour is the base colour mixed the chosen percentage of the
  // way toward white or black (see mixTowards above; documented in
  // meta.json's ambiguities as this tool's own construction, not a CSS
  // specification value).
  const light = mixTowards(base, 'white', intensity.value);
  const dark = mixTowards(base, 'black', intensity.value);

  const ratio = contrastRatio(dark, base);
  // WCAG 2.2, Success Criterion 1.4.11 Non-text Contrast: "The visual
  // presentation of the following have a contrast ratio of at least 3:1
  // against adjacent color(s): User Interface Components ...".
  if (ratio < 3) {
    warnings.push(
      `The darker shadow edge's contrast against the base colour is only ${formatNumber(ratio, 2)}:1, below the 3:1 ratio WCAG 2.2's Success Criterion 1.4.11 (Non-text Contrast) asks of a user interface component's edge.`,
    );
  }

  const inset = shape === 'pressed' ? ' inset' : '';
  const shadow = `${formatLength(-distance.value, 'px')} ${formatLength(-distance.value, 'px')} ${formatLength(blur.value, 'px')} 0px ${formatHexColor(light)}${inset}, ${formatLength(distance.value, 'px')} ${formatLength(distance.value, 'px')} ${formatLength(blur.value, 'px')} 0px ${formatHexColor(dark)}${inset}`;

  const softDeclarations: [string, string][] = [
    ['width', formatLength(Math.min(width, height, 200), 'px')],
    ['height', formatLength(Math.min(width, height, 200), 'px')],
    ['border-radius', formatLength(rounding.value, 'px', { bareZero: true })],
    ['box-shadow', shadow],
  ];
  if (shape === 'concave') {
    softDeclarations.push([
      'background-image',
      `linear-gradient(145deg, ${formatHexColor(dark)}, ${formatHexColor(light)})`,
    ]);
  } else if (shape === 'convex') {
    softDeclarations.push([
      'background-image',
      `linear-gradient(145deg, ${formatHexColor(light)}, ${formatHexColor(dark)})`,
    ]);
  } else {
    softDeclarations.push(['background-color', formatHexColor(base)]);
  }

  const sceneDeclarations: [string, string][] = [
    ['width', formatLength(width, 'px')],
    ['height', formatLength(height, 'px')],
    ['background-color', formatHexColor(base)],
    ['display', 'grid'],
    ['place-items', 'center'],
  ];

  const tree: PreviewTreeNode = { className: 'scene', children: [{ className: 'soft' }] };

  try {
    assertSafeTree(tree);
    const css = stylesheetText({
      rules: [
        { selector: '.scene', declarations: sceneDeclarations },
        // A flat class selector, not ".scene > .soft": css-safe.ts's own
        // assertSafeSelector accepts only class selectors (optionally
        // ending in :hover), never a combinator -- the same flat-selector
        // discipline this phase's other multi-element generators already
        // established for their own shared item/cell classes. The tree
        // itself still nests .soft inside .scene; only the selector text
        // is flat.
        { selector: '.soft', declarations: softDeclarations },
      ],
    });
    return { css, tree, backdrop: 'plain', contrastRatio: ratio, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new EffectsError(err.message);
    throw err;
  }
}

/**
 * Generates a frosted glass panel (Filter Effects Module Level 2,
 * https://drafts.csswg.org/filter-effects-2/#BackdropFilterProperty) or a
 * soft UI surface (this tool's own construction; the box shadow syntax
 * itself is CSS Backgrounds and Borders Module Level 3,
 * https://www.w3.org/TR/css-backgrounds-3/), warning when the soft UI
 * surface's darker shadow edge falls below the WCAG 2.2
 * (https://www.w3.org/TR/WCAG22/) Success Criterion 1.4.11 non-text contrast
 * ratio. CSS Color Module Level 4 (https://www.w3.org/TR/css-color-4/)
 * section 5.2 governs every hex colour written.
 */
export function generateEffect(options: GenerateEffectOptions): GenerateEffectResult {
  const warnings: string[] = [];
  const mode = options.mode === 'soft' ? 'soft' : 'glass';
  const widthResult = clampNumber('Width', options.width ?? 240, 80, 400, 240);
  const heightResult = clampNumber('Height', options.height ?? 160, 80, 400, 160);
  if (widthResult.warning) warnings.push(widthResult.warning);
  if (heightResult.warning) warnings.push(heightResult.warning);

  if (mode === 'glass') return generateGlass(options.glass, widthResult.value, heightResult.value, warnings);
  return generateSoft(options.soft, widthResult.value, heightResult.value, warnings);
}
