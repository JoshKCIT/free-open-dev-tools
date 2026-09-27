/**
 * Dominant colours from decoded pixels, computed entirely from a plain byte
 * array -- this package never reads a file, never touches a canvas, and
 * names no browser-only type anywhere. Reading a picked file, checking its
 * header before ever decoding it (`sniff.ts`), and turning it into pixel
 * bytes all live in the web application's own worker, outside this folder,
 * so this folder can be copied out and tested in plain Node.
 */
import {
  extractPalette,
  formatHex as formatHexColor,
  type QuantizedColor,
  type ExtractPaletteOptions,
} from './quantize';
import meta from './meta.json';

export { meta };
export { sniffImage, MAX_FILE_BYTES, MAX_PIXELS, ImageColorError, type SniffResult, type ImageFormat } from './sniff';
export { samplePixels, SAMPLE_PATTERN, MAX_SAMPLED_PIXELS, type QuantizedColor, type SampledPixel } from './quantize';

export const formatHex = formatHexColor;

export interface ExtractFromPixelsResult {
  colors: QuantizedColor[];
  sampled: number;
}

/**
 * Extracts the dominant palette of an already-decoded image: at most
 * `count` colours (default 6), each with its hex, RGB channels and share
 * of the pixels used, plus how many pixels the palette was actually built
 * from. Deterministic: the same `rgba` always gives the same colours in
 * the same order.
 */
export function extractFromPixels(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: ExtractPaletteOptions = {},
): ExtractFromPixelsResult {
  return extractPalette(rgba, width, height, options);
}

/**
 * A `:root` block of `--image-<n>` CSS custom properties, one per colour in
 * `colors`, in the order given -- text only, never applied to any element.
 */
export function paletteCss(colors: QuantizedColor[]): string {
  const lines = colors.map((c, i) => `  --image-${i + 1}: ${c.hex};`);
  return [':root {', ...lines, '}'].join('\n');
}
