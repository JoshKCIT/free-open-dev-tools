import meta from './meta.json';
import {
  CssSafetyError,
  clampNumber,
  formatLength,
  parseHexColor,
  formatHexColor,
  stylesheetText,
  assertSafeTree,
  type PreviewTreeNode,
  type LengthUnit,
} from './css-safe';

export { meta };
export type { PreviewTreeNode };

export class FilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterError';
  }
}

export type ScalarFilterName =
  'blur' | 'brightness' | 'contrast' | 'grayscale' | 'hue-rotate' | 'invert' | 'opacity' | 'saturate' | 'sepia';

export type FilterFunctionName = ScalarFilterName | 'drop-shadow';

export interface FilterFunctionInfo {
  name: FilterFunctionName;
  /** Unit shown beside the amount field. drop-shadow has no single scalar amount. */
  unit: LengthUnit | null;
  /** The smallest amount this tool accepts for this function. */
  min: number;
  /** The largest amount this tool accepts for this function -- the specification's own cap when it states one, otherwise a practical tool ceiling (see `capIsSpecMandated`). */
  max: number;
  /** Filter Effects Level 1's own default value for this function's argument when omitted. */
  specDefault: number;
  /** True when `max` is a value the specification itself mandates (values above it must be clamped); false when `max` is only this tool's own practical ceiling. */
  capIsSpecMandated: boolean;
  /** One line quoting or closely paraphrasing Filter Effects Level 1's own definition of this function. */
  note: string;
}

/**
 * The ten Filter Effects Level 1 filter functions
 * (https://www.w3.org/TR/filter-effects-1/), section 6.1 "Supported Filter
 * Functions": "<filter-function> = <blur()> | <brightness()> | <contrast()>
 * | <drop-shadow()> | <grayscale()> | <hue-rotate()> | <invert()> |
 * <opacity()> | <sepia()> | <saturate()>". Unit, range and default are
 * quoted from each function's own definition in that section.
 */
export const FILTER_FUNCTIONS: readonly FilterFunctionInfo[] = [
  {
    name: 'blur',
    unit: 'px',
    min: 0,
    max: 100,
    specDefault: 0,
    capIsSpecMandated: false,
    note: '"blur() = blur( <length>? )" ... "Negative values are not allowed. Default value when omitted is 0px." No upper bound is specified; 100px is this tool\'s own practical ceiling.',
  },
  {
    name: 'brightness',
    unit: '%',
    min: 0,
    max: 300,
    specDefault: 100,
    capIsSpecMandated: false,
    note: '"brightness() = brightness( <number-percentage>? )" ... "Negative values are not allowed. Default value when omitted is 1." "Values of amount over 100% are allowed, providing brighter results" -- no upper bound is specified; 300% is this tool\'s own practical ceiling.',
  },
  {
    name: 'contrast',
    unit: '%',
    min: 0,
    max: 300,
    specDefault: 100,
    capIsSpecMandated: false,
    note: '"contrast() = contrast( <number-percentage>? )" ... "Negative values are not allowed. Default value when omitted is 1." "Values of amount over 100% are allowed, providing results with more contrast" -- no upper bound is specified; 300% is this tool\'s own practical ceiling.',
  },
  {
    name: 'grayscale',
    unit: '%',
    min: 0,
    max: 100,
    specDefault: 100,
    capIsSpecMandated: true,
    note: '"grayscale() = grayscale( <number-percentage>? )" ... "Values of amount over 100% are allowed but UAs must clamp the values to 1."',
  },
  {
    name: 'hue-rotate',
    unit: 'deg',
    min: -720,
    max: 720,
    specDefault: 0,
    capIsSpecMandated: false,
    note: '"hue-rotate() = hue-rotate( [ <angle> | <zero> ]? )" ... "Implementations must not normalize this value in order to allow animations beyond 360deg." The specification places no bound at all; -720deg to 720deg (two full turns either way) is this tool\'s own practical ceiling for a usable slider.',
  },
  {
    name: 'invert',
    unit: '%',
    min: 0,
    max: 100,
    specDefault: 100,
    capIsSpecMandated: true,
    note: '"invert() = invert( <number-percentage>? )" ... "Values of amount over 100% are allowed but UAs must clamp the values to 1."',
  },
  {
    name: 'opacity',
    unit: '%',
    min: 0,
    max: 100,
    specDefault: 100,
    capIsSpecMandated: true,
    note: '"opacity() = opacity( <number-percentage>? )" ... "Values of amount over 100% are allowed but UAs must clamp the values to 1."',
  },
  {
    name: 'saturate',
    unit: '%',
    min: 0,
    max: 300,
    specDefault: 100,
    capIsSpecMandated: false,
    note: '"saturate() = saturate( <number-percentage>? )" ... "Values of amount over 100% are allowed, providing super-saturated results" -- no upper bound is specified; 300% is this tool\'s own practical ceiling.',
  },
  {
    name: 'sepia',
    unit: '%',
    min: 0,
    max: 100,
    specDefault: 100,
    capIsSpecMandated: true,
    note: '"sepia() = sepia( <number-percentage>? )" ... "Values of amount over 100% are allowed but UAs must clamp the values to 1."',
  },
  {
    name: 'drop-shadow',
    unit: null,
    min: 0,
    max: 0,
    specDefault: 0,
    capIsSpecMandated: false,
    note: '"drop-shadow() = drop-shadow( <color>? && <length>{2,3} )" ... "Values are interpreted as for box-shadow but with the optional 3rd <length> value being the standard deviation instead of blur radius." Spread values and multiple shadows are not accepted for this function.',
  },
];

const FILTER_FUNCTION_INFO: ReadonlyMap<FilterFunctionName, FilterFunctionInfo> = new Map(
  FILTER_FUNCTIONS.map((f) => [f.name, f]),
);

export interface ScalarFilterLayer {
  name: ScalarFilterName;
  amount: number;
}

export interface DropShadowFilterLayer {
  name: 'drop-shadow';
  x: number;
  y: number;
  blur: number;
  color: string;
}

export type FilterLayer = ScalarFilterLayer | DropShadowFilterLayer;

export interface GenerateFilterOptions {
  /** One to four filter functions, in the order they should be applied. */
  functions: FilterLayer[];
  /** Preview box width in px. Default 240, clamped to 40-480. */
  width?: number;
  /** Preview box height in px. Default 160, clamped to 40-480. */
  height?: number;
}

export interface GenerateFilterResult {
  /** One `.photo` rule (plus a `.photo-label` rule) declaring width, height, a fixed background and the filter. */
  css: string;
  /** The element tree the CSS styles: the photo, with one label child. */
  tree: PreviewTreeNode;
  /** The `filter` value alone (the function list, without the rest of the rule). */
  value: string;
  warnings: string[];
}

const MAX_LAYERS = 4;
// Slot 2's own default amount is 0.3, not a rounder-looking value, because a
// visible blur is not pixel-snapped the way a solid fill or a border-radius
// curve is: filter:blur() re-rasterises the WHOLE element, so the same
// sub-pixel stage-position difference 08-01/08-02 already measured (the live
// page's own layout can leave the stage a fractional CSS pixel off a round
// number, where the blank comparison page sits at an exact position) gets
// spread into a much wider band of differing pixels than an unblurred edge
// would show -- measured this session on chromium at 240x160: safe (matching
// the unblurred baseline) up to about 0.7px, then a sharp jump; Firefox and
// mobile Chrome needed a further margin below that chromium-only threshold.
// See 08-03-SUMMARY.md "Measured per-engine behaviour".
const DEFAULT_LAYERS: FilterLayer[] = [
  { name: 'grayscale', amount: 60 },
  { name: 'blur', amount: 0.3 },
];

/**
 * A fixed decorative background gradient (D-118: constructed entirely from
 * this tool's own literal, allow-listed colours -- never derived from
 * visitor input) so every filter function has real colour and contrast to
 * act on. Chosen once here, not offered as a field.
 */
const PHOTO_BACKGROUND = 'linear-gradient(135deg, #f97316 0%, #ec4899 50%, #6366f1 100%)';

function unitFor(name: ScalarFilterName): LengthUnit {
  const unit = FILTER_FUNCTION_INFO.get(name)!.unit;
  return unit ?? '%';
}

function resolveScalarLayer(raw: ScalarFilterLayer, index: number, warnings: string[]): string {
  const info = FILTER_FUNCTION_INFO.get(raw.name);
  if (!info) {
    warnings.push(`Slot ${index + 1} named a function this tool does not offer, so grayscale was used instead.`);
    return resolveScalarLayer({ name: 'grayscale', amount: 60 }, index, warnings);
  }
  const clamped = clampNumber(`Slot ${index + 1} (${info.name})`, raw.amount, info.min, info.max, info.specDefault);
  if (clamped.warning) warnings.push(clamped.warning);
  return `${info.name}(${formatLength(clamped.value, unitFor(raw.name))})`;
}

function resolveDropShadowLayer(raw: DropShadowFilterLayer, index: number, warnings: string[]): string {
  const xResult = clampNumber(`Slot ${index + 1} (drop-shadow) horizontal offset`, raw.x, -50, 50, 0);
  const yResult = clampNumber(`Slot ${index + 1} (drop-shadow) vertical offset`, raw.y, -50, 50, 0);
  const blurResult = clampNumber(`Slot ${index + 1} (drop-shadow) blur`, raw.blur, 0, 100, 0);
  if (xResult.warning) warnings.push(xResult.warning);
  if (yResult.warning) warnings.push(yResult.warning);
  if (blurResult.warning) warnings.push(blurResult.warning);
  let color;
  try {
    color = parseHexColor(raw.color ?? '#000000', `Slot ${index + 1} (drop-shadow) colour`);
  } catch {
    warnings.push(`Slot ${index + 1} (drop-shadow) colour was not a valid hex colour, so black was used instead.`);
    color = parseHexColor('#000000');
  }
  const len = (n: number) => formatLength(n, 'px', { bareZero: true });
  // "Values are interpreted as for box-shadow but with the optional 3rd
  // <length> value being the standard deviation instead of blur radius" --
  // no spread, no inset.
  return `drop-shadow(${len(xResult.value)} ${len(yResult.value)} ${len(blurResult.value)} ${formatHexColor(color)})`;
}

function resolveLayer(raw: FilterLayer, index: number, warnings: string[]): string {
  if (raw.name === 'drop-shadow') return resolveDropShadowLayer(raw, index, warnings);
  return resolveScalarLayer(raw, index, warnings);
}

/**
 * Generates a `filter` value (and the whole `.photo`/`.photo-label` rule
 * pair around it) from one to four filter functions applied in order, per
 * Filter Effects Module Level 1 (https://www.w3.org/TR/filter-effects-1/),
 * section 6.1 ("Supported Filter Functions") for the grammar and range of
 * each function, and CSS Color Module Level 4
 * (https://www.w3.org/TR/css-color-4/) section 5.2 for the drop shadow's hex
 * colour. `FILTER_FUNCTIONS` is the closed list this tool ever writes: the
 * SVG-reference form of the `filter` property (an in-page fragment id in
 * parentheses) is never produced, because it is not one of the ten names
 * this writer knows.
 */
export function generateFilter(options: GenerateFilterOptions): GenerateFilterResult {
  const warnings: string[] = [];
  const rawLayers =
    Array.isArray(options.functions) && options.functions.length > 0
      ? options.functions.slice(0, MAX_LAYERS)
      : DEFAULT_LAYERS;

  const layerValues = rawLayers.map((layer, i) => resolveLayer(layer, i, warnings));
  const value = layerValues.join(' ');

  const widthResult = clampNumber('Width', options.width ?? 240, 40, 480, 240);
  const heightResult = clampNumber('Height', options.height ?? 160, 40, 480, 160);
  if (widthResult.warning) warnings.push(widthResult.warning);
  if (heightResult.warning) warnings.push(heightResult.warning);

  const tree: PreviewTreeNode = {
    className: 'photo',
    children: [{ className: 'photo-label', text: 'Aa' }],
  };

  try {
    assertSafeTree(tree);
    const css = stylesheetText({
      rules: [
        {
          selector: '.photo',
          declarations: [
            ['width', formatLength(widthResult.value, 'px')],
            ['height', formatLength(heightResult.value, 'px')],
            ['background-image', PHOTO_BACKGROUND],
            ['display', 'grid'],
            ['place-items', 'center'],
            ['filter', value],
          ],
        },
        {
          selector: '.photo-label',
          declarations: [
            ['color', '#ffffff'],
            ['font-family', 'system-ui'],
            ['font-size', formatLength(48, 'px')],
            ['font-weight', '700'],
          ],
        },
      ],
    });
    return { css, tree, value, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new FilterError(err.message);
    throw err;
  }
}
