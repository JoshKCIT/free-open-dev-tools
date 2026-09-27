/**
 * Deterministic median cut over RGBA bytes.
 *
 * Median cut is described in Paul Heckbert's 1982 SIGGRAPH paper "Color
 * Image Quantization for Frame Buffer Display" -- this is a from-scratch
 * implementation written in this project's own words from that paper's
 * description of the algorithm (repeatedly split the box of sampled colour
 * points with the greatest range along one channel, at that channel's
 * median), not a port of any published source.
 *
 * No browser-only type appears anywhere in this file: it takes plain
 * numeric byte arrays only, so the folder can be copied out and tested in
 * plain Node.
 */

export interface SampledPixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Walks `rgba` at a fixed stride so at most `maxSamples` pixels are ever
 * used -- never a random subset, so the same image always samples the same
 * pixels. When the image has `maxSamples` pixels or fewer, every pixel is
 * sampled (stride 1).
 */
export function samplePixels(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  maxSamples: number,
): SampledPixel[] {
  const total = width * height;
  if (total <= 0) return [];
  const stride = total <= maxSamples ? 1 : Math.ceil(total / maxSamples);
  const out: SampledPixel[] = [];
  for (let index = 0; index < total && out.length < maxSamples; index += stride) {
    const offset = index * 4;
    out.push({ r: rgba[offset]!, g: rgba[offset + 1]!, b: rgba[offset + 2]!, a: rgba[offset + 3]! });
  }
  return out;
}

type Channel = 'r' | 'g' | 'b';
const CHANNEL_TIE_ORDER: Channel[] = ['r', 'g', 'b'];

interface Box {
  pixels: SampledPixel[];
}

function channelRange(pixels: SampledPixel[], channel: Channel): number {
  let min = Infinity;
  let max = -Infinity;
  for (const p of pixels) {
    const v = p[channel];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

/** The channel with the largest range in this box; ties broken red, then green, then blue. */
function widestChannel(pixels: SampledPixel[]): { channel: Channel; range: number } {
  let best: { channel: Channel; range: number } = { channel: 'r', range: -1 };
  for (const channel of CHANNEL_TIE_ORDER) {
    const range = channelRange(pixels, channel);
    if (range > best.range) best = { channel, range };
  }
  return best;
}

function splitBox(box: Box): [Box, Box] {
  const { channel } = widestChannel(box.pixels);
  const sorted = [...box.pixels].sort((a, b) => a[channel] - b[channel]);
  const mid = Math.floor(sorted.length / 2);
  return [{ pixels: sorted.slice(0, mid) }, { pixels: sorted.slice(mid) }];
}

export interface QuantizedColor {
  hex: string;
  r: number;
  g: number;
  b: number;
  share: number;
}

function meanColor(pixels: SampledPixel[]): { r: number; g: number; b: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of pixels) {
    r += p.r;
    g += p.g;
    b += p.b;
  }
  const n = pixels.length || 1;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

export function formatHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const hex = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Median cut over an already-sampled, already-filtered pixel list: starts
 * with one box holding every pixel, then repeatedly splits the box with
 * the largest channel range across all current boxes (ties: the box with
 * more pixels, then the earlier box) at the median of that box's own
 * widest channel (ties among that box's own channels: red, then green,
 * then blue), until `count` boxes exist or no remaining box has more than
 * one pixel and some non-zero channel range left to split (a box whose
 * pixels are already all the same colour is left alone, rather than
 * duplicating that colour into two boxes). Each returned colour is its
 * box's mean colour and share
 * of the pixels actually used, ordered by share (largest first) then by
 * hex string, so the order is total and therefore deterministic.
 */
function medianCut(pixels: SampledPixel[], count: number): QuantizedColor[] {
  if (pixels.length === 0) return [];

  let boxes: Box[] = [{ pixels }];
  while (boxes.length < count) {
    let bestIndex = -1;
    let bestRange = -1;
    let bestSize = -1;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      if (box.pixels.length < 2) continue; // cannot split further
      const { range } = widestChannel(box.pixels);
      if (range <= 0) continue; // every pixel in this box is already the same colour; splitting it would only duplicate that colour
      const size = box.pixels.length;
      if (range > bestRange || (range === bestRange && size > bestSize)) {
        bestIndex = i;
        bestRange = range;
        bestSize = size;
      }
    }
    if (bestIndex === -1) break; // no box can split any further
    const [a, b] = splitBox(boxes[bestIndex]!);
    boxes = [...boxes.slice(0, bestIndex), a, b, ...boxes.slice(bestIndex + 1)];
  }

  const total = pixels.length;
  const colors: QuantizedColor[] = boxes
    .filter((box) => box.pixels.length > 0)
    .map((box) => {
      const { r, g, b } = meanColor(box.pixels);
      return { r, g, b, hex: formatHex(r, g, b), share: box.pixels.length / total };
    });

  colors.sort((x, y) => y.share - x.share || (x.hex < y.hex ? -1 : x.hex > y.hex ? 1 : 0));
  return colors;
}

/** At most this many pixels are ever sampled from an image, however large. */
export const MAX_SAMPLED_PIXELS = 65_536;

export interface ExtractPaletteOptions {
  /** How many colours to return, at most. Default 6. */
  count?: number;
  /** Leave out pixels below `alphaThreshold` alpha before quantizing. Default true. */
  ignoreTransparent?: boolean;
  /** The alpha value (0-255) below which a pixel is considered transparent. Default 128. */
  alphaThreshold?: number;
}

export interface ExtractPaletteResult {
  colors: QuantizedColor[];
  /** How many pixels were actually used to build the palette, after sampling and any transparency filter. */
  sampled: number;
}

/**
 * Samples `rgba` at a fixed stride (`samplePixels`, at most
 * `MAX_SAMPLED_PIXELS`), optionally leaves out pixels below
 * `alphaThreshold` alpha, and runs median cut over what remains.
 */
export function extractPalette(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: ExtractPaletteOptions = {},
): ExtractPaletteResult {
  const count = options.count ?? 6;
  const ignoreTransparent = options.ignoreTransparent ?? true;
  const alphaThreshold = options.alphaThreshold ?? 128;

  const sampled = samplePixels(rgba, width, height, MAX_SAMPLED_PIXELS);
  const used = ignoreTransparent ? sampled.filter((p) => p.a >= alphaThreshold) : sampled;

  return { colors: medianCut(used, count), sampled: used.length };
}

/**
 * The 64 by 64 four-quadrant test pattern built from CSS Color Module
 * Level 4's own named colours red (#ff0000), lime (#00ff00), blue
 * (#0000ff) and white (#ffffff): top-left red, top-right lime, bottom-left
 * blue, bottom-right white, each fully opaque and exactly one quarter of
 * the image.
 */
export const SAMPLE_PATTERN_SIZE = 64;

function buildSamplePattern(): { width: number; height: number; rgba: Uint8ClampedArray } {
  const size = SAMPLE_PATTERN_SIZE;
  const half = size / 2;
  const rgba = new Uint8ClampedArray(size * size * 4);
  const quadrantColor = (x: number, y: number): [number, number, number] => {
    const left = x < half;
    const top = y < half;
    if (top && left) return [255, 0, 0]; // red
    if (top && !left) return [0, 255, 0]; // lime
    if (!top && left) return [0, 0, 255]; // blue
    return [255, 255, 255]; // white
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = quadrantColor(x, y);
      const offset = (y * size + x) * 4;
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = 255;
    }
  }
  return { width: size, height: size, rgba };
}

export const SAMPLE_PATTERN = buildSamplePattern();
