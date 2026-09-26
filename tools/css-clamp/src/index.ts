import meta from './meta.json';

export { meta };

export class CssClampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CssClampError';
  }
}

export type ClampUnit = 'rem' | 'px';

export interface FluidClampOptions {
  /** The size at and below `minViewport`, in px. Clamped to 1..1000. */
  minSize: number;
  /** The size at and above `maxViewport`, in px. Clamped to 1..1000. Must not be below `minSize`. */
  maxSize: number;
  /** The viewport width, in px, at and below which the size is `minSize`. Clamped to 1..100000. */
  minViewport: number;
  /** The viewport width, in px, at and above which the size is `maxSize`. Clamped to 1..100000. Must be above `minViewport`. */
  maxViewport: number;
  /** Assumed root font size, in px, for the rem output. Clamped to 1..1000. Default 16. */
  rootFontSize?: number;
  /** 'rem' (default, keeps following the visitor's font size preference) or 'px'. */
  unit?: ClampUnit;
  /** Decimal places for every number in the output. Clamped to 0..10. Default 4. */
  precision?: number;
}

export interface FluidClampResult {
  /** The bare value, e.g. `clamp(1rem, 0.8333rem + 0.8333vw, 1.5rem)`. */
  value: string;
  /** `font-size: <value>;`. */
  declaration: string;
  /** The straight line's slope, in px of size per px of viewport (unitless ratio). */
  slope: number;
  /** The straight line's y-intercept, in px (the size the line would give at a 0px viewport). */
  intercept: number;
  minSize: number;
  maxSize: number;
  minViewport: number;
  maxViewport: number;
  rootFontSize: number;
  unit: ClampUnit;
  warnings: string[];
}

/** WCAG 2.2 says text must be resizable to 200 percent (SC 1.4.4). No fetched source gives an exact
 * ratio above which a fluid range is certain to fail that on zoom (see meta.json ambiguities); this is
 * this tool's own conservative, disclosed heuristic threshold. */
const ZOOM_RISK_RATIO = 2.5;

function clampField(field: string, value: number, min: number, max: number, warnings: string[]): number {
  if (!Number.isFinite(value)) {
    warnings.push(`${field} was not a finite number; using ${min} instead.`);
    return min;
  }
  if (value < min) {
    warnings.push(`${field} of ${value} is below the minimum; clamped to ${min}.`);
    return min;
  }
  if (value > max) {
    warnings.push(`${field} of ${value} is above the maximum; clamped to ${max}.`);
    return max;
  }
  return value;
}

/** Rounds to `precision` decimal places, trims trailing zeros and the point, never an exponent or -0. */
function formatNumber(n: number, precision: number): string {
  if (!Number.isFinite(n)) throw new CssClampError(`${n} is not a finite number.`);
  const fixed = Math.abs(n) < 1e-12 ? '0' : n.toFixed(Math.max(0, Math.min(10, precision)));
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return trimmed === '-0' ? '0' : trimmed;
}

/**
 * Builds a fluid `clamp()` value from a minimum and maximum size and the
 * viewport widths they apply at, using the straight-line ("CSS lock")
 * construction Utopia's own blog post credits to Pedro Rodriguez:
 *
 *   Slope = (MaxSize - MinSize) / (MaxWidth - MinWidth)
 *   yIntersection = (-1 * MinWidth) * Slope + MinSize
 *   font-size: clamp(MinSize[rem], yIntersection[rem] + Slope * 100vw, MaxSize[rem])
 */
export function fluidClamp(options: FluidClampOptions): FluidClampResult {
  const warnings: string[] = [];
  const minSize = clampField('the minimum size', options.minSize, 1, 1000, warnings);
  const maxSizeRaw = clampField('the maximum size', options.maxSize, 1, 1000, warnings);
  const minViewport = clampField('the minimum viewport', options.minViewport, 1, 100000, warnings);
  const maxViewport = clampField('the maximum viewport', options.maxViewport, 1, 100000, warnings);
  const rootFontSize = clampField('the root font size', options.rootFontSize ?? 16, 1, 1000, warnings);
  const unit: ClampUnit = options.unit === 'px' ? 'px' : 'rem';
  const precision = Number.isFinite(options.precision) ? Math.max(0, Math.min(10, options.precision!)) : 4;

  if (maxSizeRaw < minSize) {
    throw new CssClampError(
      `The minimum size (${minSize}) is above the maximum size (${maxSizeRaw}). Raise the maximum or lower the minimum.`,
    );
  }
  if (maxViewport <= minViewport) {
    throw new CssClampError(
      `The minimum viewport (${minViewport}) is at or above the maximum viewport (${maxViewport}). The viewport range must not be empty.`,
    );
  }

  const maxSize = maxSizeRaw;
  const slope = (maxSize - minSize) / (maxViewport - minViewport);
  const intercept = minSize - slope * minViewport;

  if (minSize > 0 && maxSize / minSize > ZOOM_RISK_RATIO) {
    warnings.push(
      `The maximum size is more than ${ZOOM_RISK_RATIO} times the minimum. WCAG 2.2 success criterion 1.4.4 (Resize Text) requires text to be resizable to 200 percent; a fluid range this wide has a greater chance of a visitor being unable to reach that by zooming. Test with real browser zoom.`,
    );
  }

  let value: string;
  if (unit === 'px') {
    value = `clamp(${formatNumber(minSize, precision)}px, ${formatNumber(intercept, precision)}px + ${formatNumber(
      slope * 100,
      precision,
    )}vw, ${formatNumber(maxSize, precision)}px)`;
  } else {
    const minRem = minSize / rootFontSize;
    const maxRem = maxSize / rootFontSize;
    const interceptRem = intercept / rootFontSize;
    value = `clamp(${formatNumber(minRem, precision)}rem, ${formatNumber(interceptRem, precision)}rem + ${formatNumber(
      slope * 100,
      precision,
    )}vw, ${formatNumber(maxRem, precision)}rem)`;
  }

  return {
    value,
    declaration: `font-size: ${value};`,
    slope,
    intercept,
    minSize,
    maxSize,
    minViewport,
    maxViewport,
    rootFontSize,
    unit,
    warnings,
  };
}

/**
 * Applies the CSS Values and Units Level 4 definition of `clamp(MIN, VAL, MAX)`
 * -- "exactly the same value as max(MIN, min(VAL, MAX))" -- to find the size
 * a `FluidClampResult` gives at any viewport width, in px.
 */
export function evaluateClamp(result: FluidClampResult, viewportWidth: number): number {
  const preferred = result.intercept + result.slope * viewportWidth;
  return Math.max(result.minSize, Math.min(preferred, result.maxSize));
}
