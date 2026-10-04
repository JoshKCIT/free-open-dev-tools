/**
 * Crop, rotate and flip geometry.
 *
 * Pure whole-number arithmetic only: this file draws nothing. It says which
 * rectangle of the upright picture to take, how big the edited picture is,
 * and the six numbers of the drawing transform that put that rectangle where
 * it belongs, so the page and the background worker (two separate drawing
 * sites) use one plan and cannot drift apart.
 *
 * Order, always: crop first, then a clockwise quarter turn (0, 90, 180 or
 * 270 degrees), then a mirror (none, left to right, top to bottom or both),
 * then whatever resizing the visitor chose, measured against the edited size.
 *
 * Every transform number is a whole number, and the cropped rectangle lands
 * exactly on whole output pixels, so a browser that draws the rectangle with
 * this transform copies each pixel to its place without resampling.
 */

export const ROTATIONS = [0, 90, 180, 270] as const;
export const FLIPS = ['none', 'horizontal', 'vertical', 'both'] as const;

export type Rotation = (typeof ROTATIONS)[number];
export type FlipMode = (typeof FLIPS)[number];

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageEdits {
  /** In pixels of the upright picture (after any stored turn is applied). Left out, the whole picture is kept. */
  crop?: CropRect;
  rotate: Rotation;
  flip: FlipMode;
}

export interface EditPlan {
  /** The rectangle of the upright picture to draw. */
  source: CropRect;
  /** Size of the edited picture. */
  width: number;
  height: number;
  /** The six numbers of a 2D transform matrix (a, b, c, d, e, f), applied before drawing the source rectangle at 0, 0. */
  transform: [number, number, number, number, number, number];
  /** True when the edits change nothing, so the plain drawing path is used. */
  identity: boolean;
}

export class ImageEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageEditError';
  }
}

/** Never -0: an exact comparison of two plans would tell +0 and -0 apart. */
function plain(n: number): number {
  return n === 0 ? 0 : n;
}

function isWhole(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

function checkCrop(crop: CropRect, bitmapWidth: number, bitmapHeight: number): void {
  const size = `${bitmapWidth} by ${bitmapHeight}`;
  if (!isWhole(crop.x) || !isWhole(crop.y) || !isWhole(crop.width) || !isWhole(crop.height)) {
    throw new ImageEditError(`The crop must be whole numbers of pixels. The picture is ${size} pixels.`);
  }
  if (crop.x < 0 || crop.y < 0) {
    throw new ImageEditError(`The crop corner cannot be negative. The picture is ${size} pixels.`);
  }
  if (crop.width < 1 || crop.height < 1) {
    throw new ImageEditError(`The crop must be at least 1 pixel wide and 1 pixel tall. The picture is ${size} pixels.`);
  }
  // Sums of whole numbers below 2^53 are exact; larger inputs are refused by the same comparison.
  if (crop.x + crop.width > bitmapWidth || crop.y + crop.height > bitmapHeight) {
    throw new ImageEditError(
      `The crop (${crop.width} by ${crop.height} starting at ${crop.x}, ${crop.y}) does not fit inside the picture, which is ${size} pixels.`,
    );
  }
}

/**
 * Plans the edits for a picture of the given upright size. Refuses a crop
 * that is not whole numbers, has a side under 1 pixel, starts below 0 or
 * reaches past the picture, and a rotation or flip not in the two lists.
 */
export function planEdits(bitmapWidth: number, bitmapHeight: number, edits: ImageEdits): EditPlan {
  if (!isWhole(bitmapWidth) || !isWhole(bitmapHeight) || bitmapWidth < 1 || bitmapHeight < 1) {
    throw new ImageEditError('The picture has no usable size to edit.');
  }
  if (!ROTATIONS.includes(edits.rotate)) {
    throw new ImageEditError('Rotation must be 0, 90, 180 or 270 degrees.');
  }
  if (!FLIPS.includes(edits.flip)) {
    throw new ImageEditError('Flip must be none, horizontal, vertical or both.');
  }

  let source: CropRect = { x: 0, y: 0, width: bitmapWidth, height: bitmapHeight };
  if (edits.crop) {
    checkCrop(edits.crop, bitmapWidth, bitmapHeight);
    source = { x: edits.crop.x, y: edits.crop.y, width: edits.crop.width, height: edits.crop.height };
  }
  const cw = source.width;
  const ch = source.height;
  const turned = edits.rotate === 90 || edits.rotate === 270;
  const width = turned ? ch : cw;
  const height = turned ? cw : ch;

  // A clockwise turn about the corner, then the shift that brings the turned rectangle back to 0, 0.
  let a: number;
  let b: number;
  let c: number;
  let d: number;
  let e: number;
  let f: number;
  switch (edits.rotate) {
    case 90:
      [a, b, c, d, e, f] = [0, 1, -1, 0, ch, 0];
      break;
    case 180:
      [a, b, c, d, e, f] = [-1, 0, 0, -1, cw, ch];
      break;
    case 270:
      [a, b, c, d, e, f] = [0, -1, 1, 0, 0, cw];
      break;
    default:
      [a, b, c, d, e, f] = [1, 0, 0, 1, 0, 0];
  }
  // A mirror in the edited picture: x becomes width - x, and/or y becomes height - y.
  if (edits.flip === 'horizontal' || edits.flip === 'both') {
    a = -a;
    c = -c;
    e = width - e;
  }
  if (edits.flip === 'vertical' || edits.flip === 'both') {
    b = -b;
    d = -d;
    f = height - f;
  }

  const identity =
    source.x === 0 &&
    source.y === 0 &&
    source.width === bitmapWidth &&
    source.height === bitmapHeight &&
    edits.rotate === 0 &&
    edits.flip === 'none';

  return {
    source,
    width,
    height,
    transform: [plain(a), plain(b), plain(c), plain(d), plain(e), plain(f)],
    identity,
  };
}

/**
 * The size the edited picture will have (and whether the edits change anything at all, which is when a picture of
 * that size is drawn), worked from a size read out of a
 * file header. A JPEG may store its picture turned a quarter (its own
 * orientation note), so the header size can be the sideways size of the
 * upright picture: for a JPEG a crop that fits the sideways size is accepted
 * here. The drawing site plans again from the decoded picture's real size,
 * which is the check that counts.
 */
export function planEditedSize(
  headerWidth: number,
  headerHeight: number,
  edits: ImageEdits,
  mayBeStoredTurned: boolean,
): { width: number; height: number; changes: boolean } {
  try {
    const plan = planEdits(headerWidth, headerHeight, edits);
    return { width: plan.width, height: plan.height, changes: !plan.identity };
  } catch (err) {
    if (mayBeStoredTurned && err instanceof ImageEditError) {
      try {
        const plan = planEdits(headerHeight, headerWidth, edits);
        return { width: plan.width, height: plan.height, changes: !plan.identity };
      } catch {
        // Neither orientation fits: report the first refusal.
      }
    }
    throw err;
  }
}
