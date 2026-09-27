/**
 * SVG rendering for a bar/space module string -- one background rect and
 * one rect per bar, with an optional row of human-readable digits under
 * the bars. No reference, no script and no style element are ever written.
 * The hex colour parser and its low-contrast warning are the same
 * approach `qr-generator`'s own `svg.ts` uses (Task 1), reimplemented here
 * so this package stays self-contained.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface ColorResult {
  color: Rgb;
  warning?: string;
}

const DEFAULT_DARK: Rgb = { r: 0, g: 0, b: 0 };
const DEFAULT_LIGHT: Rgb = { r: 255, g: 255, b: 255 };

export function parseHexColor(input: string | undefined, fallback: Rgb, field: string): ColorResult {
  if (!input) return { color: fallback };
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(input);
  if (short) {
    const [, r, g, b] = short;
    return { color: { r: parseInt(r! + r!, 16), g: parseInt(g! + g!, 16), b: parseInt(b! + b!, 16) } };
  }
  const long = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(input);
  if (long) {
    const [, r, g, b] = long;
    return { color: { r: parseInt(r!, 16), g: parseInt(g!, 16), b: parseInt(b!, 16) } };
  }
  return {
    color: fallback,
    warning: `"${field}" was not a #rgb or #rrggbb colour, so the default was used instead.`,
  };
}

function relativeLuminance(c: Rgb): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface ResolvedColors {
  dark: Rgb;
  light: Rgb;
  warnings: string[];
}

export function resolveColors(darkInput: string | undefined, lightInput: string | undefined): ResolvedColors {
  const warnings: string[] = [];
  const dark = parseHexColor(darkInput, DEFAULT_DARK, 'dark');
  if (dark.warning) warnings.push(dark.warning);
  const light = parseHexColor(lightInput, DEFAULT_LIGHT, 'light');
  if (light.warning) warnings.push(light.warning);
  if (contrastRatio(dark.color, light.color) < 3) {
    warnings.push(
      'The dark and light colours are close in brightness (contrast ratio under 3), which can make the code harder for scanners to read.',
    );
  }
  return { dark: dark.color, light: light.color, warnings };
}

export function rgbToHex(c: Rgb): string {
  const h = (v: number): string => v.toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export interface LabelGroup {
  text: string;
  /** 0-based module offset (within the bars, not counting quiet zone) where this group starts. */
  startModule: number;
  /** How many bar modules this group's text is centred under. */
  moduleSpan: number;
}

export interface BarSvgOptions {
  moduleWidth?: number;
  height?: number;
  showText?: boolean;
  dark?: string;
  light?: string;
}

export interface RenderResult {
  output: string;
  warnings: string[];
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function barcodeToSvg(
  modules: string,
  quietLeft: number,
  quietRight: number,
  labels: LabelGroup[],
  options: BarSvgOptions = {},
): RenderResult {
  const moduleWidth = Math.max(1, Math.round(options.moduleWidth ?? 2));
  const barHeight = Math.max(1, Math.round(options.height ?? 100));
  const showText = options.showText ?? true;
  const { dark, light, warnings } = resolveColors(options.dark, options.light);

  const totalModules = quietLeft + modules.length + quietRight;
  const width = totalModules * moduleWidth;
  const textHeight = showText && labels.length > 0 ? 18 : 0;
  const height = barHeight + textHeight;

  let bars = '';
  for (let i = 0; i < modules.length; i++) {
    if (modules[i] === '1') {
      const x = (quietLeft + i) * moduleWidth;
      bars += `<rect x="${x}" y="0" width="${moduleWidth}" height="${barHeight}" fill="${rgbToHex(dark)}"/>`;
    }
  }

  let text = '';
  if (showText) {
    for (const g of labels) {
      const centerModule = quietLeft + g.startModule + g.moduleSpan / 2;
      const x = centerModule * moduleWidth;
      text += `<text x="${x}" y="${barHeight + 14}" text-anchor="middle" font-family="monospace" font-size="14" fill="${rgbToHex(dark)}">${escapeXmlText(g.text)}</text>`;
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${rgbToHex(light)}"/>` +
    bars +
    text +
    `</svg>`;

  return { output: svg, warnings };
}
