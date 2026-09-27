/**
 * SVG rendering for a QR matrix, and the hex colour parser both svg.ts and
 * png.ts share. No text, no reference and no script are ever written --
 * the output is one background rect and one path drawing every dark module,
 * so there is nothing here that can load a resource.
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

/** Parses `#rgb` or `#rrggbb` only. Anything else falls back to `fallback`
 * with a warning naming `field`. */
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

/** WCAG 2.2 relative luminance for one sRGB colour (each channel 0-255). */
function relativeLuminance(c: Rgb): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG 2.2 contrast ratio between two colours (always >= 1). */
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

export interface Matrix {
  size: number;
  modules: Uint8Array;
}

export interface RenderOptions {
  scale?: number;
  margin?: number;
  dark?: string;
  light?: string;
}

export interface RenderResult {
  output: string;
  warnings: string[];
}

const DEFAULT_MARGIN = 4; // ISO/IEC 18004 quiet zone, four modules on every side

export function matrixToSvg(matrix: Matrix, options: RenderOptions = {}): RenderResult {
  const scale = Math.max(1, Math.round(options.scale ?? 8));
  const margin = Math.max(0, Math.round(options.margin ?? DEFAULT_MARGIN));
  const { dark, light, warnings } = resolveColors(options.dark, options.light);
  if (margin < DEFAULT_MARGIN) {
    warnings.push(
      `A margin of ${margin} modules is narrower than the ${DEFAULT_MARGIN}-module quiet zone ISO/IEC 18004 requires, which can make the code harder to scan.`,
    );
  }
  const { size, modules } = matrix;
  const total = size + margin * 2;
  const pixelSize = total * scale;

  let path = '';
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (modules[row * size + col] === 1) {
        const x = (col + margin) * scale;
        const y = (row + margin) * scale;
        path += `M${x} ${y}h${scale}v${scale}h${-scale}z`;
      }
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelSize}" height="${pixelSize}" viewBox="0 0 ${pixelSize} ${pixelSize}">` +
    `<rect width="${pixelSize}" height="${pixelSize}" fill="${rgbToHex(light)}"/>` +
    (path ? `<path d="${path}" fill="${rgbToHex(dark)}"/>` : '') +
    `</svg>`;

  return { output: svg, warnings };
}
