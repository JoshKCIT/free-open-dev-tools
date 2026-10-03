import pixelmatch from 'pixelmatch';

/**
 * A refusal with a plain sentence the page can show as it is. Every message names a size, a limit or a field and never
 * holds any byte of a picture or any file name.
 */
export class ImageCompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageCompareError';
  }
}

/** pixelmatch's own default threshold. */
export const DEFAULT_THRESHOLD = 0.1;

/** The most pixels one compared picture may have, padded or not: three RGBA buffers of this size are 192 MB. */
export const MAX_COMPARE_PIXELS = 16_000_000;

export interface Size {
  width: number;
  height: number;
}

export interface CompareResult {
  /** The exact number of pixels counted as different. */
  differing: number;
  /** `width * height`. */
  total: number;
  /** RGBA: differing pixels red, anti-aliased pixels skipped by the detector yellow, the rest faded gray. */
  diff: Uint8ClampedArray;
}

/** Returns the threshold when it is a number from 0 to 1, otherwise refuses it, naming the Threshold field. */
export function checkThreshold(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ImageCompareError('Threshold must be a number from 0 to 1.');
  }
  return value;
}

function isSize(size: Size): boolean {
  return Number.isInteger(size.width) && Number.isInteger(size.height) && size.width >= 1 && size.height >= 1;
}

const LIMIT_TEXT = '16,000,000';

/**
 * Decides the size both pictures are compared at. Equal sizes are compared as they are. Different sizes are refused
 * unless `mismatch` is `pad`, in which case both are taken to the larger width and the larger height (the smaller
 * picture is padded at its right and bottom edges). The compared picture may not have more than 16,000,000 pixels, so
 * padding two long thin pictures cannot ask for a huge buffer.
 */
export function planCompare(
  a: Size,
  b: Size,
  mismatch: 'refuse' | 'pad',
): { width: number; height: number; padded: boolean } {
  if (!isSize(a) || !isSize(b)) throw new ImageCompareError('An image size is not valid.');
  const same = a.width === b.width && a.height === b.height;
  if (!same && mismatch !== 'pad') {
    throw new ImageCompareError(
      `The images are different sizes: the first is ${a.width} by ${a.height} pixels and the second is ${b.width} by ${b.height} pixels. Choose Pad smaller image to compare them anyway.`,
    );
  }
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  if (width * height > MAX_COMPARE_PIXELS) {
    throw new ImageCompareError(
      same
        ? `These images are ${width} by ${height} pixels, more than the ${LIMIT_TEXT} pixels this page compares.`
        : `Padding would make an image of ${width} by ${height} pixels, more than the ${LIMIT_TEXT} pixels this page compares.`,
    );
  }
  return { width, height, padded: !same };
}

function isWhole(data: unknown): data is Uint8ClampedArray {
  return data instanceof Uint8ClampedArray && data.byteOffset % 4 === 0;
}

/**
 * Copies a picture to the top left corner of a larger transparent canvas (every new pixel is 0, 0, 0, 0). When the
 * target is the same size the picture itself is returned, not a copy. The result is always a whole array of its own
 * (never a view at an odd offset), which pixelmatch needs for its 32-bit reads.
 */
export function padPixels(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  toWidth: number,
  toHeight: number,
): Uint8ClampedArray {
  if (!isWhole(src)) throw new ImageCompareError('The pixel data is not a whole Uint8ClampedArray.');
  const sizes = [width, height, toWidth, toHeight];
  if (!sizes.every((n) => Number.isInteger(n) && n >= 1) || src.length !== width * height * 4) {
    throw new ImageCompareError('The pixel data is not the stated size.');
  }
  if (toWidth < width || toHeight < height) {
    throw new ImageCompareError('A picture can only be padded to a size at least as large as its own.');
  }
  if (toWidth * toHeight > MAX_COMPARE_PIXELS) {
    throw new ImageCompareError(`Padding would make an image of more than ${LIMIT_TEXT} pixels.`);
  }
  if (toWidth === width && toHeight === height) return src;
  const out = new Uint8ClampedArray(toWidth * toHeight * 4);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    out.set(src.subarray(y * rowBytes, (y + 1) * rowBytes), y * toWidth * 4);
  }
  return out;
}

/**
 * Compares two equally sized RGBA pictures with pixelmatch 7.2.0 and counts the differing pixels exactly. A pixel
 * counts when its YIQ colour difference is greater than 35215 * threshold * threshold; unless `includeAA` is set,
 * pixels pixelmatch's detector takes for anti-aliasing are skipped (drawn yellow in the difference image and not
 * counted). Differing pixels are drawn red, and the others as gray blended with white at alpha 0.1.
 */
export function compareImages(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  options: { threshold: number; includeAA: boolean },
): CompareResult {
  const threshold = checkThreshold(options.threshold);
  if (!isWhole(a) || !isWhole(b)) throw new ImageCompareError('The pixel data is not a whole Uint8ClampedArray.');
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    a.length !== width * height * 4 ||
    b.length !== a.length
  ) {
    throw new ImageCompareError('The pixel data is not the stated size.');
  }
  const total = width * height;
  const diff = new Uint8ClampedArray(total * 4);
  const differing = pixelmatch(a, b, diff, width, height, {
    threshold,
    includeAA: options.includeAA,
    alpha: 0.1,
    diffColor: [255, 0, 0],
  });
  return { differing, total, diff };
}

/**
 * The share of differing pixels as text, worked out in whole numbers. The share in hundredths of a percent is
 * `differing * 10000 / total` rounded half up (an exact tie goes up), so there is no floating point rounding to
 * surprise anyone. It is shown with two decimals and a percent sign, except at the two ends: while any pixel differs
 * it is never shown as 0.00 (it reads `less than 0.01 %`), and while any pixel matches it is never shown as 100.00 (it
 * reads `more than 99.99 %`).
 */
export function shareText(differing: number, total: number): string {
  if (
    !Number.isSafeInteger(differing) ||
    !Number.isSafeInteger(total) ||
    total < 1 ||
    differing < 0 ||
    differing > total ||
    !Number.isSafeInteger(20000 * total)
  ) {
    throw new ImageCompareError('The pixel counts are not valid.');
  }
  // floor((2 * differing * 10000 + total) / (2 * total)) is differing * 10000 / total rounded half up. Every number
  // below is a whole number under 2 to the power 53, so each step is exact.
  const numerator = 20000 * differing + total;
  const denominator = 2 * total;
  const hundredths = (numerator - (numerator % denominator)) / denominator;
  if (differing > 0 && hundredths === 0) return 'less than 0.01 %';
  if (differing < total && hundredths === 10000) return 'more than 99.99 %';
  const whole = Math.floor(hundredths / 100);
  const fraction = String(hundredths % 100).padStart(2, '0');
  return `${whole}.${fraction} %`;
}
