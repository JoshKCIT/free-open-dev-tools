/**
 * Computes the output pixel size for every resize mode this tool offers, and
 * the pixel ceiling that keeps a canvas from ever being created too large
 * for a real browser to decode, draw and encode.
 *
 * Pure arithmetic only: this file never touches a canvas, an image element
 * or any browser-only type. It is built and tested in plain Node by the
 * standalone gate.
 */

export interface SizeSource {
  width: number;
  height: number;
}

export type ResizeMode = 'none' | 'percent' | 'fit' | 'exact';

export interface SizeOptions {
  mode: ResizeMode;
  /** Percent mode: a percentage of the source's own width and height. */
  percent?: number;
  /** Fit and exact modes: the box, or exact size, in pixels. */
  width?: number;
  height?: number;
  /**
   * Exact mode only. When set, the given `width` is authoritative and
   * `height` is computed from the source's own aspect ratio (the field the
   * visitor left blank, or overrode, does not matter -- `width` wins). When
   * unset, both `width` and `height` are used exactly as given, which can
   * change the source's own aspect ratio.
   */
  keepAspect?: boolean;
  /**
   * Fit mode only. When unset (the default), the source is never enlarged:
   * a source already smaller than the box keeps its own size. When set, a
   * smaller source is scaled up to fill the box.
   */
  enlarge?: boolean;
}

export interface SizePlan {
  width: number;
  height: number;
  warnings: string[];
}

/**
 * Measured directly against this project's own tested chromium, firefox and
 * webkit engines (mobile-chrome shares chromium's engine): every one of them
 * decodes a plain fill, draws it and encodes it to both PNG and JPEG at
 * 40,000,000 pixels inside a worker, or -- on the one tested engine with no
 * off-screen drawing surface available to a worker at all -- on the page
 * thread's own never-shown surface (see the worker's own header comment).
 * No engine needed this ceiling reduced below the plan's own starting
 * figure.
 */
export const MAX_OUTPUT_PIXELS = 40_000_000;

function clampPositiveInt(n: number): number {
  return Math.max(1, Math.round(n));
}

/**
 * Scales `width` by `height` down (preserving aspect ratio) until the pixel
 * count is at or under `maxPixels`, rounding each side to the nearest whole
 * pixel and never going below 1. Used only to name the largest size that
 * still fits when a plan is refused for being too large.
 */
export function largestFittingSize(width: number, height: number, maxPixels: number): SizeSource {
  const pixels = width * height;
  if (pixels <= maxPixels) return { width: clampPositiveInt(width), height: clampPositiveInt(height) };
  const scale = Math.sqrt(maxPixels / pixels);
  return { width: clampPositiveInt(width * scale), height: clampPositiveInt(height * scale) };
}

/**
 * Returns the planned output size for a source image under one of the four
 * resize modes, plus any warning about the request itself (never about the
 * pixel ceiling, which is a separate, plan-level refusal `index.ts` owns).
 */
export function planSize(source: SizeSource, options: SizeOptions): SizePlan {
  const warnings: string[] = [];

  switch (options.mode) {
    case 'none':
      return { width: clampPositiveInt(source.width), height: clampPositiveInt(source.height), warnings };

    case 'percent': {
      const requested = options.percent ?? 100;
      let pct = requested;
      if (pct <= 0) {
        pct = 1;
        warnings.push("'percent' must be greater than zero; it was clamped to 1.");
      }
      return {
        width: clampPositiveInt((source.width * pct) / 100),
        height: clampPositiveInt((source.height * pct) / 100),
        warnings,
      };
    }

    case 'fit': {
      const boxWidth = options.width && options.width > 0 ? options.width : source.width;
      const boxHeight = options.height && options.height > 0 ? options.height : source.height;
      const rawScale = Math.min(boxWidth / source.width, boxHeight / source.height);
      // Fitting inside a box never enlarges the source unless the visitor
      // explicitly asks for that: a scale over 1 is clamped back to 1 here
      // rather than in the caller, so `enlarge: false` (the default) really
      // does mean "never larger than the source" for every box size.
      const scale = options.enlarge ? rawScale : Math.min(rawScale, 1);
      return {
        width: clampPositiveInt(source.width * scale),
        height: clampPositiveInt(source.height * scale),
        warnings,
      };
    }

    case 'exact': {
      const aspect = source.height / source.width;
      const width = options.width && options.width > 0 ? options.width : source.width;
      let height = options.height && options.height > 0 ? options.height : source.height;
      if (options.keepAspect) {
        // width is authoritative; height is derived from the source's own
        // aspect ratio regardless of what the height field itself held.
        height = width * aspect;
      }
      return { width: clampPositiveInt(width), height: clampPositiveInt(height), warnings };
    }
  }
}
