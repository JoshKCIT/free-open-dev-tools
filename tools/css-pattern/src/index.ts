import meta from './meta.json';
import {
  CssSafetyError,
  assertSafeTree,
  clampNumber,
  formatHexColor,
  formatLength,
  parseHexColor,
  stylesheetText,
  type PreviewTreeNode,
  type RgbaColor,
} from './css-safe';
import {
  CssPatternError,
  PATTERNS,
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  patternSvg,
  svgPatternCss,
  svgPatternHtml,
} from './svg-pattern';

export { meta, CssPatternError, PATTERNS, patternSvg, svgPatternCss, svgPatternHtml };
export type { PreviewTreeNode };

export interface GeneratePatternOptions {
  /** One of PATTERNS. Default 'stripes-diagonal'. */
  pattern?: string;
  /** 'gradient' (default) or 'svg'. */
  output?: string;
  /** The line colour, a 3, 4, 6 or 8 digit hex colour. Default #1d4ed8. */
  foreground?: string;
  /** The background colour. Default #dbeafe. */
  background?: string;
  /** The size of one repeat in pixels, clamped to 4 to 200. Default 24. */
  size?: number;
  /** Line thickness in percent of the size, clamped to 1 to 50. Default 20. Not read for checks and zigzag. */
  thickness?: number;
}

export type GeneratePatternResult =
  | {
      output: 'gradient';
      /** The stylesheet, written by the canonical stylesheet writer. */
      css: string;
      /** The element tree the CSS styles: one element. */
      tree: PreviewTreeNode;
      markup: string;
      warnings: string[];
    }
  | {
      output: 'svg';
      /** The stylesheet, written by the small writer for the data address form. */
      css: string;
      /** The content of the script-free frame: a style element holding exactly css, then the element it styles. */
      html: string;
      markup: string;
      warnings: string[];
    };

const OUTPUTS: ReadonlySet<string> = new Set(['gradient', 'svg']);
const DEFAULT_FOREGROUND = '#1d4ed8';
const DEFAULT_BACKGROUND = '#dbeafe';
const MARKUP = '<div class="pattern"></div>';
/** Patterns that have no line thickness: the field is not read for them. */
const WITHOUT_THICKNESS: ReadonlySet<string> = new Set(['checks', 'zigzag']);

/**
 * For a page whose colour box can hold any typed text: the value when it is a 3, 4, 6 or 8 digit hex colour, otherwise
 * the fallback with a warning that names the field and never repeats what was typed.
 */
export function colourOrDefault(
  value: string,
  fallback: string,
  label: string,
): { colour: string; warning: string | null } {
  try {
    parseHexColor(value, label);
    return { colour: value, warning: null };
  } catch (err) {
    if (err instanceof CssSafetyError) {
      return {
        colour: fallback,
        warning: `${label} was not a valid hexadecimal colour, so ${fallback} was used instead.`,
      };
    }
    throw err;
  }
}

function colourOf(value: string | undefined, fallback: string, label: string): RgbaColor {
  try {
    return parseHexColor(value ?? fallback, label);
  } catch (err) {
    if (err instanceof CssSafetyError) {
      throw new CssPatternError(`${label} is not a valid hexadecimal colour: use 3, 4, 6 or 8 digits after a #.`);
    }
    throw err;
  }
}

function choose(value: string | undefined, allowed: ReadonlySet<string>, fallback: string, label: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new CssPatternError(`${label} is not one of the choices on offer.`);
  }
  return value;
}

/** The background image, and the position of each layer when a pattern needs one, for a pattern and its measures in pixels. */
function gradientLayers(
  pattern: string,
  size: number,
  line: number,
  percent: number,
  fg: string,
): { image: string; position?: string } {
  const px = (n: number) => formatLength(n, 'px');
  const lines = (angle: number) =>
    `repeating-linear-gradient(${angle}deg, ${fg} ${px(0)}, ${fg} ${px(line)}, transparent ${px(line)}, transparent ${px(size)})`;
  // A diagonal line is measured across the repeat of the gradient line, which is half its length once the tile is cut.
  const diagonal = (angle: number) => {
    const edge = formatLength(percent / 2, '%');
    return `repeating-linear-gradient(${angle}deg, ${fg} 0%, ${fg} ${edge}, transparent ${edge}, transparent 50%)`;
  };
  switch (pattern) {
    case 'stripes-diagonal':
      return { image: diagonal(45) };
    case 'stripes-horizontal':
      return { image: lines(180) };
    case 'stripes-vertical':
      return { image: lines(90) };
    case 'checks':
      return { image: `repeating-conic-gradient(${fg} 0%, ${fg} 25%, transparent 25%, transparent 50%)` };
    case 'dots':
      return {
        image: `radial-gradient(circle at 50% 50%, ${fg} ${px(0)}, ${fg} ${px(line)}, transparent ${px(line)})`,
      };
    case 'grid':
      return { image: `${lines(90)}, ${lines(0)}` };
    case 'zigzag': {
      const shift = formatLength(-size / 2, 'px', { bareZero: true });
      return {
        image: [135, 225, 315, 45]
          .map((angle) => `linear-gradient(${angle}deg, ${fg} 25%, transparent 25%)`)
          .join(', '),
        position: `${shift} 0, ${shift} 0, 0 0, 0 0`,
      };
    }
    default:
      return { image: `${diagonal(45)}, ${diagonal(135)}` };
  }
}

/**
 * Writes the CSS for one repeating background pattern, per CSS Images Level 3 (https://www.w3.org/TR/css-images-3/):
 * repeating and radial gradients cut to a tile by `background-size`, or the tile itself as a small SVG in a data
 * address (SVG 2, https://www.w3.org/TR/SVG2/). The gradient form is written by the canonical stylesheet writer. The
 * SVG form is written by the small writer in svg-pattern.ts, because the canonical writer refuses every address by
 * design; that writer takes only numbers, colours and a pattern name from a closed list.
 */
export function generatePattern(options: GeneratePatternOptions): GeneratePatternResult {
  const warnings: string[] = [];
  const pattern = choose(options.pattern, new Set(PATTERNS.keys()), 'stripes-diagonal', 'Pattern');
  const output = choose(options.output, OUTPUTS, 'gradient', 'Output');

  const sizeResult = clampNumber('Size', options.size as number, 4, 200, 24);
  if (options.size === undefined) sizeResult.warning = null;
  if (sizeResult.warning) warnings.push(sizeResult.warning);
  const size = sizeResult.value;

  let thickness = 20;
  if (!WITHOUT_THICKNESS.has(pattern)) {
    const thicknessResult = clampNumber('Thickness', options.thickness as number, 1, 50, 20);
    if (options.thickness === undefined) thicknessResult.warning = null;
    if (thicknessResult.warning) warnings.push(thicknessResult.warning);
    thickness = thicknessResult.value;
  }

  const foreground = formatHexColor(colourOf(options.foreground, DEFAULT_FOREGROUND, 'Foreground'));
  const background = formatHexColor(colourOf(options.background, DEFAULT_BACKGROUND, 'Background'));

  if (output === 'svg') {
    const css = svgPatternCss(patternSvg(pattern, size, thickness, foreground, background), background, size);
    return { output: 'svg', css, html: svgPatternHtml(css), markup: MARKUP, warnings };
  }

  const layers = gradientLayers(pattern, size, (size * thickness) / 100, thickness, foreground);
  const tree: PreviewTreeNode = { className: 'pattern' };
  try {
    assertSafeTree(tree);
    const css = stylesheetText({
      rules: [
        {
          selector: '.pattern',
          declarations: [
            ['width', formatLength(PREVIEW_WIDTH, 'px')],
            ['height', formatLength(PREVIEW_HEIGHT, 'px')],
            ['background-color', background],
            ['background-image', layers.image],
            ['background-size', `${formatLength(size, 'px')} ${formatLength(size, 'px')}`],
            ...(layers.position === undefined
              ? []
              : ([['background-position', layers.position]] as [string, string][])),
          ],
        },
      ],
    });
    return { output: 'gradient', css, tree, markup: MARKUP, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new CssPatternError(err.message);
    throw err;
  }
}
