import meta from './meta.json';
import {
  COMMON_RATIOS,
  COMMON_RESOLUTIONS,
  COMMON_SIZES_SOURCE,
  type RatioEntry,
  type ResolutionEntry,
} from './common-sizes';

export { meta, COMMON_RATIOS, COMMON_RESOLUTIONS, COMMON_SIZES_SOURCE };
export type { RatioEntry, ResolutionEntry };

export class AspectRatioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AspectRatioError';
  }
}

export interface Ratio {
  w: number;
  h: number;
}

export type SolveFor = 'width' | 'height' | 'ratio';

export interface SolveAspectOptions {
  solveFor: SolveFor;
  width?: number;
  height?: number;
  ratio?: Ratio;
}

export interface SolveAspectResult {
  width: number;
  height: number;
  ratio: Ratio;
  /** Only set when solving for width or height: the unrounded value minus the rounded one. */
  roundingError?: number;
  warnings: string[];
}

const SIZE_MIN = 1;
const SIZE_MAX = 100000;

function clampSize(field: string, value: number, warnings: string[]): number {
  if (!Number.isFinite(value)) {
    warnings.push(`${field} was not a finite number; using ${SIZE_MIN} instead.`);
    return SIZE_MIN;
  }
  if (value < SIZE_MIN) {
    warnings.push(`${field} of ${value} is below the minimum; clamped to ${SIZE_MIN}.`);
    return SIZE_MIN;
  }
  if (value > SIZE_MAX) {
    warnings.push(`${field} of ${value} is above the maximum; clamped to ${SIZE_MAX}.`);
    return SIZE_MAX;
  }
  return value;
}

function validateRatio(ratio: Ratio | undefined): Ratio {
  if (!ratio || !Number.isFinite(ratio.w) || !Number.isFinite(ratio.h) || ratio.w <= 0 || ratio.h <= 0) {
    throw new AspectRatioError('The ratio must have two positive numbers.');
  }
  return ratio;
}

/**
 * Solves a missing width, height or ratio. `solveFor: 'width'` and
 * `'height'` need the other size plus `ratio`; `solveFor: 'ratio'` needs
 * `width` and `height`. Sizes are rounded to whole pixels; the exact,
 * unrounded value minus the rounded one is reported as `roundingError`.
 */
export function solveAspect(options: SolveAspectOptions): SolveAspectResult {
  const warnings: string[] = [];

  if (options.solveFor === 'ratio') {
    if (options.width === undefined || options.height === undefined) {
      throw new AspectRatioError('Solving for the ratio needs both a width and a height.');
    }
    const width = clampSize('the width', options.width, warnings);
    const height = clampSize('the height', options.height, warnings);
    const simplified = simplifyRatio(width, height);
    return {
      width,
      height,
      ratio: { w: simplified.w, h: simplified.h },
      warnings,
    };
  }

  const ratio = validateRatio(options.ratio);

  if (options.solveFor === 'height') {
    if (options.width === undefined) throw new AspectRatioError('Solving for the height needs a width.');
    const width = clampSize('the width', options.width, warnings);
    const exact = width * (ratio.h / ratio.w);
    const height = Math.round(exact);
    return { width, height, ratio, roundingError: exact - height, warnings };
  }

  // solveFor === 'width'
  if (options.height === undefined) throw new AspectRatioError('Solving for the width needs a height.');
  const height = clampSize('the height', options.height, warnings);
  const exact = height * (ratio.w / ratio.h);
  const width = Math.round(exact);
  return { width, height, ratio, roundingError: exact - width, warnings };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

export interface NearestWholeRatio {
  w: number;
  h: number;
  /** |nearest - exact| / exact. */
  error: number;
}

export interface SimplifiedRatio {
  /** As given (for a decimal ratio) or reduced by the greatest common divisor (for whole numbers). */
  w: number;
  h: number;
  /** Set only when the input was not already a whole-number ratio: the nearest ratio with both
   * terms at most 100, and its relative error. */
  nearestWhole?: NearestWholeRatio;
}

/**
 * Reduces a whole-number width and height to the simplest whole-number
 * ratio by their greatest common divisor. For a decimal ratio (such as
 * 2.39:1), the input is kept exactly as written, and the nearest ratio
 * expressible with two whole numbers each at most 100 is also computed,
 * with its relative error.
 */
export function simplifyRatio(w: number, h: number): SimplifiedRatio {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new AspectRatioError('Both numbers must be positive and finite.');
  }
  if (Number.isInteger(w) && Number.isInteger(h)) {
    const g = gcd(w, h);
    return { w: w / g, h: h / g };
  }

  const target = w / h;
  let best: NearestWholeRatio | null = null;
  for (let b = 1; b <= 100; b++) {
    const a = Math.round(target * b);
    if (a < 1 || a > 100) continue;
    const error = Math.abs(a / b - target) / target;
    if (!best || error < best.error - 1e-15 || (Math.abs(error - best.error) < 1e-15 && b < best.h)) {
      best = { w: a, h: b, error };
    }
  }
  return { w, h, nearestWhole: best ?? undefined };
}

/** Rounds to at most `maxDecimals` places, trims trailing zeros and the point, never an exponent or -0. */
function formatNumber(n: number, maxDecimals = 4): string {
  if (!Number.isFinite(n)) throw new AspectRatioError(`${n} is not a finite number.`);
  const fixed = n.toFixed(Math.max(0, Math.min(10, maxDecimals)));
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return trimmed === '-0' ? '0' : trimmed;
}

/** `aspect-ratio: <w> / <h>;`, the CSS Values and Units Level 4 `<ratio>` type's own serialization form. */
export function formatAspectRatioCss(ratio: Ratio): string {
  return `aspect-ratio: ${formatNumber(ratio.w)} / ${formatNumber(ratio.h)};`;
}
