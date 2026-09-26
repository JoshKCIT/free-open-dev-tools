import meta from './meta.json';

export { meta };

/** The eleven units this tool converts between. */
export type Unit = 'px' | 'rem' | 'em' | 'pt' | 'pc' | 'in' | 'cm' | 'mm' | 'vw' | 'vh' | 'percent';

export type UnitKind = 'absolute' | 'font-relative' | 'viewport-relative' | 'percentage';

export interface UnitInfo {
  unit: Unit;
  kind: UnitKind;
}

/**
 * The eleven units, each with what its value depends on. Order here is the
 * order every conversion result and every page table row is shown in.
 */
export const UNITS: readonly UnitInfo[] = [
  { unit: 'px', kind: 'absolute' },
  { unit: 'rem', kind: 'font-relative' },
  { unit: 'em', kind: 'font-relative' },
  { unit: 'pt', kind: 'absolute' },
  { unit: 'pc', kind: 'absolute' },
  { unit: 'in', kind: 'absolute' },
  { unit: 'cm', kind: 'absolute' },
  { unit: 'mm', kind: 'absolute' },
  { unit: 'vw', kind: 'viewport-relative' },
  { unit: 'vh', kind: 'viewport-relative' },
  { unit: 'percent', kind: 'percentage' },
];

export class CssUnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CssUnitError';
  }
}

/**
 * The absolute length ratios CSS Values and Units Level 4 section 6.2
 * defines, with px as the canonical unit:
 *
 *   "1in = 2.54cm = 96px"; "1cm = 96px/2.54"; "1mm = 1/10th of 1cm";
 *   "1pt = 1/72nd of 1in"; "1pc = 1/6th of 1in"; "1px = 1/96th of 1in".
 *
 * Every other absolute unit is expressed here as a px-per-unit factor
 * derived from those exact ratios, never approximated.
 */
const PX_PER_IN = 96;
const PX_PER_CM = PX_PER_IN / 2.54;
const PX_PER_UNIT: Record<'px' | 'in' | 'cm' | 'mm' | 'pt' | 'pc', number> = {
  px: 1,
  in: PX_PER_IN,
  cm: PX_PER_CM,
  mm: PX_PER_CM / 10,
  pt: PX_PER_IN / 72,
  pc: PX_PER_IN / 6,
};

export type PercentReference = 'parent-font-size' | 'container-width';

export interface UnitContext {
  /** Assumed root element font size, for `rem`. Clamped to 1..1000. Default 16. */
  rootFontSize?: number;
  /** Assumed font size of the element's parent, for `em` and percent-of-font-size. Clamped to 1..1000. Default 16. */
  parentFontSize?: number;
  /** Assumed viewport width, for `vw`. Clamped to 1..100000. Default 1440. */
  viewportWidth?: number;
  /** Assumed viewport height, for `vh`. Clamped to 1..100000. Default 900. */
  viewportHeight?: number;
  /** What a percentage is relative to. Default 'parent-font-size'. */
  percentOf?: PercentReference;
  /** Assumed container width, for percent-of-container-width. Clamped to 1..100000. Default 600. */
  containerWidth?: number;
}

export interface ResolvedUnitContext {
  rootFontSize: number;
  parentFontSize: number;
  viewportWidth: number;
  viewportHeight: number;
  percentOf: PercentReference;
  containerWidth: number;
}

export interface ConvertLengthResult {
  /** Every unit's equivalent value, in `UNITS` order. Unrounded; round for display. */
  results: { unit: Unit; value: number }[];
  /** The context actually used, after clamping. */
  context: ResolvedUnitContext;
  warnings: string[];
}

const DEFAULT_CONTEXT: ResolvedUnitContext = {
  rootFontSize: 16,
  parentFontSize: 16,
  viewportWidth: 1440,
  viewportHeight: 900,
  percentOf: 'parent-font-size',
  containerWidth: 600,
};

/** A context field's smallest allowed value: a font size or viewport at or below this is clamped up to it. */
const CONTEXT_MIN = 1;
const CONTEXT_MAX_FONT = 1000;
const CONTEXT_MAX_VIEWPORT = 100000;

function clampContextField(
  field: string,
  value: number | undefined,
  fallback: number,
  max: number,
  warnings: string[],
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) {
    warnings.push(`${field} was not a finite number; using ${fallback} instead.`);
    return fallback;
  }
  if (value < CONTEXT_MIN) {
    warnings.push(`${field} of ${value} is at or below zero; clamped to the minimum, ${CONTEXT_MIN}.`);
    return CONTEXT_MIN;
  }
  if (value > max) {
    warnings.push(`${field} of ${value} is above the maximum, ${max}; clamped to it.`);
    return max;
  }
  return value;
}

function resolveContext(input: UnitContext, warnings: string[]): ResolvedUnitContext {
  return {
    rootFontSize: clampContextField(
      'the root font size',
      input.rootFontSize,
      DEFAULT_CONTEXT.rootFontSize,
      CONTEXT_MAX_FONT,
      warnings,
    ),
    parentFontSize: clampContextField(
      'the parent font size',
      input.parentFontSize,
      DEFAULT_CONTEXT.parentFontSize,
      CONTEXT_MAX_FONT,
      warnings,
    ),
    viewportWidth: clampContextField(
      'the viewport width',
      input.viewportWidth,
      DEFAULT_CONTEXT.viewportWidth,
      CONTEXT_MAX_VIEWPORT,
      warnings,
    ),
    viewportHeight: clampContextField(
      'the viewport height',
      input.viewportHeight,
      DEFAULT_CONTEXT.viewportHeight,
      CONTEXT_MAX_VIEWPORT,
      warnings,
    ),
    percentOf: input.percentOf === 'container-width' ? 'container-width' : 'parent-font-size',
    containerWidth: clampContextField(
      'the container width',
      input.containerWidth,
      DEFAULT_CONTEXT.containerWidth,
      CONTEXT_MAX_VIEWPORT,
      warnings,
    ),
  };
}

/** Converts one value, already in the given unit, to its exact px equivalent. */
function toPx(value: number, unit: Unit, context: ResolvedUnitContext): number {
  switch (unit) {
    case 'px':
    case 'in':
    case 'cm':
    case 'mm':
    case 'pt':
    case 'pc':
      return value * PX_PER_UNIT[unit];
    case 'rem':
      return value * context.rootFontSize;
    case 'em':
      return value * context.parentFontSize;
    case 'vw':
      return (value / 100) * context.viewportWidth;
    case 'vh':
      return (value / 100) * context.viewportHeight;
    case 'percent':
      return context.percentOf === 'container-width'
        ? (value / 100) * context.containerWidth
        : (value / 100) * context.parentFontSize;
  }
}

/** The inverse of `toPx`: how many of `unit` a px value equals. */
function fromPx(px: number, unit: Unit, context: ResolvedUnitContext): number {
  switch (unit) {
    case 'px':
    case 'in':
    case 'cm':
    case 'mm':
    case 'pt':
    case 'pc':
      return px / PX_PER_UNIT[unit];
    case 'rem':
      return px / context.rootFontSize;
    case 'em':
      return px / context.parentFontSize;
    case 'vw':
      return (px / context.viewportWidth) * 100;
    case 'vh':
      return (px / context.viewportHeight) * 100;
    case 'percent':
      return context.percentOf === 'container-width'
        ? (px / context.containerWidth) * 100
        : (px / context.parentFontSize) * 100;
  }
}

/**
 * Converts `value`, given in unit `from`, to every unit in `UNITS` (px
 * canonical, CSS Values and Units Level 4 section 6.2), through the
 * assumed `context` for the units that need one. `context` fields outside
 * their allowed range are clamped with a warning naming the field; `value`
 * itself must be a finite number (any sign) or this throws.
 */
export function convertLength(value: number, from: Unit, context: UnitContext = {}): ConvertLengthResult {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CssUnitError(`"${value}" is not a finite number.`);
  }
  const warnings: string[] = [];
  const resolved = resolveContext(context, warnings);
  const px = toPx(value, from, resolved);
  const results = UNITS.map((u) => ({ unit: u.unit, value: fromPx(px, u.unit, resolved) }));
  return { results, context: resolved, warnings };
}
