/**
 * The size an SVG is drawn at when nothing else says: its own width and
 * height, else its viewBox, else 300 by 150 (the size a browser gives an SVG
 * that states none).
 *
 * Only the first element's own attributes count. Lengths are read as CSS
 * lengths: a number with no unit is pixels, and the absolute units px, pt,
 * pc, mm, cm and in are converted at 96 pixels to the inch (CSS Values and
 * Units Level 4). The font-relative units em and ex are read at the CSS
 * initial font size: 1em is 16 pixels and 1ex is 8 pixels, as a browser
 * draws an SVG shown as a picture. A percentage or anything unreadable
 * counts as missing. Pure text work: nothing is drawn here.
 */
import { readRootElement, SvgGuardError } from './svg-guard';

/**
 * The most pixels an SVG may declare, and the most it is drawn at, before anything is drawn. An SVG is drawn on the
 * page itself and drawing cannot be stopped once it starts, so this is well below the limit for a picture.
 */
export const MAX_SVG_PIXELS = 16_777_216;

export class SvgSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvgSizeError';
  }
}

const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 150;

/** Pixels in one unit of each absolute CSS length unit. */
const UNIT_PIXELS: ReadonlyMap<string, number> = new Map([
  ['px', 1],
  ['pt', 96 / 72],
  ['pc', 16],
  ['mm', 96 / 25.4],
  ['cm', 96 / 2.54],
  ['in', 96],
  // Font-relative: the initial font size of 16 pixels, and half of it for the height of a lower-case x.
  ['em', 16],
  ['ex', 8],
]);

const NUMBER_SHAPE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A length in pixels, or undefined for a missing, relative, percentage or unreadable value. */
function lengthInPixels(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (value.length === 0 || value.length > 64) return undefined;
  let numberPart = value;
  let factor = 1;
  const unit = value.slice(-2);
  const unitFactor = UNIT_PIXELS.get(unit);
  if (unitFactor !== undefined) {
    numberPart = value.slice(0, -2);
    factor = unitFactor;
  }
  if (!NUMBER_SHAPE.test(numberPart)) return undefined;
  const pixels = Number(numberPart) * factor;
  return Number.isFinite(pixels) && pixels > 0 ? pixels : undefined;
}

/** The size of a viewBox ("min-x min-y width height", separated by spaces or commas), or undefined. */
function viewBoxSize(raw: string | undefined): { width: number; height: number } | undefined {
  if (raw === undefined || raw.length > 200) return undefined;
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .filter((p) => p.length > 0);
  if (parts.length !== 4) return undefined;
  if (!parts.every((p) => NUMBER_SHAPE.test(p))) return undefined;
  const width = Number(parts[2]);
  const height = Number(parts[3]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : undefined;
}

/** A side as a person reads it; absurd sides are not printed digit by digit. */
function shown(n: number): string {
  return n > 1_000_000_000 ? 'over 1,000,000,000' : n.toLocaleString('en-US');
}

function whole(n: number): number {
  return Math.max(1, Math.round(n));
}

/**
 * The width and height in whole pixels an SVG is drawn at, from its own
 * first element. Refuses text with no readable first element, a first
 * element that is not an svg, and a size over the pixel limit.
 */
export function svgSize(text: string): { width: number; height: number } {
  let root: ReturnType<typeof readRootElement>;
  try {
    root = readRootElement(text);
  } catch (err) {
    if (err instanceof SvgGuardError) throw new SvgSizeError('This file does not start with a readable svg element.');
    throw err;
  }
  const colon = root.name.lastIndexOf(':');
  if ((colon === -1 ? root.name : root.name.slice(colon + 1)).toLowerCase() !== 'svg') {
    throw new SvgSizeError('This file does not start with an svg element.');
  }

  const declaredWidth = lengthInPixels(root.attributes.get('width'));
  const declaredHeight = lengthInPixels(root.attributes.get('height'));
  const box = viewBoxSize(root.attributes.get('viewBox'));

  let width: number;
  let height: number;
  if (declaredWidth !== undefined && declaredHeight !== undefined) {
    width = declaredWidth;
    height = declaredHeight;
  } else if (declaredWidth !== undefined) {
    width = declaredWidth;
    height = box ? (declaredWidth * box.height) / box.width : DEFAULT_HEIGHT;
  } else if (declaredHeight !== undefined) {
    height = declaredHeight;
    width = box ? (declaredHeight * box.width) / box.height : DEFAULT_WIDTH;
  } else if (box) {
    width = box.width;
    height = box.height;
  } else {
    width = DEFAULT_WIDTH;
    height = DEFAULT_HEIGHT;
  }

  const w = whole(width);
  const h = whole(height);
  if (!Number.isFinite(w * h) || w * h > MAX_SVG_PIXELS) {
    throw new SvgSizeError(
      `This SVG declares ${shown(w)} by ${shown(h)} pixels, more than the ${MAX_SVG_PIXELS.toLocaleString('en-US')} this page draws.`,
    );
  }
  return { width: w, height: h };
}
