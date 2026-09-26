import meta from './meta.json';
import { parseColor, convertColor, gamutMapToSrgb, inSrgbGamut, type Color } from './color-space';
import { relativeLuminance, contrastRatio, WCAG_THRESHOLDS, compositeOver, WHITE, type RgbaColor } from './wcag';
import { apcaLc, APCA_VERSION, APCA_LABEL } from './apca';
import {
  CssSafetyError,
  stylesheetText,
  formatHexColor,
  formatLength,
  assertSafeTree,
  type PreviewTreeNode,
} from './css-safe';

export { meta, APCA_VERSION, APCA_LABEL, relativeLuminance };
export type { PreviewTreeNode };

export class ContrastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContrastError';
  }
}

export interface WcagResult {
  /** e.g. "1.4.3" */
  criterion: string;
  /** e.g. "Normal text", "Large text", "Non-text" */
  appliesTo: string;
  /** The minimum ratio this row needs. */
  needs: number;
  result: 'Pass' | 'Fail';
}

export interface CheckContrastResult {
  wcag: { ratio: number; results: WcagResult[] };
  apca: { lc: number; label: string; version: string };
  /** One `.sample` rule (colours and size) plus its two text-size rules, built through the canonical safety writer. */
  css: string;
  tree: PreviewTreeNode;
  warnings: string[];
}

const DEFAULT_FOREGROUND = '#1f2937';
const DEFAULT_BACKGROUND = '#ffffff';

/** Parses `text` (falling back to `fallback` with a named warning on failure), gamut-maps it into sRGB. */
function safeColorToRgba(text: string | undefined, fallback: string, fieldName: string, warnings: string[]): RgbaColor {
  let color: Color;
  try {
    color = parseColor((text ?? '').trim() === '' ? fallback : text!);
  } catch {
    warnings.push(`${fieldName} was not a usable colour, so the default was used instead.`);
    color = parseColor(fallback);
  }
  const srgb = inSrgbGamut(color) ? convertColor(color, 'srgb') : gamutMapToSrgb(color);
  return { r: srgb.coords[0]!, g: srgb.coords[1]!, b: srgb.coords[2]!, alpha: color.alpha };
}

/**
 * Checks `foreground` against `background` for WCAG 2.2 contrast (Success
 * Criteria 1.4.3, 1.4.6, 1.4.11) and reports an independent APCA lightness
 * contrast figure, kept entirely separate (D-114): the two scales are never
 * combined into one number or one pass/fail badge. A translucent foreground
 * is composited over the background; a translucent background is first
 * composited over white, per the WCAG 2.2 Understanding document's own
 * default ("If no background color is specified, then white is assumed").
 */
export function checkContrast(foreground?: string, background?: string): CheckContrastResult {
  const warnings: string[] = [];
  const fg = safeColorToRgba(foreground, DEFAULT_FOREGROUND, 'Foreground colour', warnings);
  const bg = safeColorToRgba(background, DEFAULT_BACKGROUND, 'Background colour', warnings);

  const bgOpaque = bg.alpha < 1 ? compositeOver(bg, WHITE) : bg;
  const fgOpaque = fg.alpha < 1 ? compositeOver(fg, bgOpaque) : fg;

  const ratio = contrastRatio(fgOpaque, bgOpaque);
  const results: WcagResult[] = [
    {
      criterion: '1.4.3',
      appliesTo: 'Normal text',
      needs: WCAG_THRESHOLDS.aa.normal,
      result: ratio >= WCAG_THRESHOLDS.aa.normal ? 'Pass' : 'Fail',
    },
    {
      criterion: '1.4.3',
      appliesTo: 'Large text',
      needs: WCAG_THRESHOLDS.aa.large,
      result: ratio >= WCAG_THRESHOLDS.aa.large ? 'Pass' : 'Fail',
    },
    {
      criterion: '1.4.6',
      appliesTo: 'Normal text',
      needs: WCAG_THRESHOLDS.aaa.normal,
      result: ratio >= WCAG_THRESHOLDS.aaa.normal ? 'Pass' : 'Fail',
    },
    {
      criterion: '1.4.6',
      appliesTo: 'Large text',
      needs: WCAG_THRESHOLDS.aaa.large,
      result: ratio >= WCAG_THRESHOLDS.aaa.large ? 'Pass' : 'Fail',
    },
    {
      criterion: '1.4.11',
      appliesTo: 'Non-text',
      needs: WCAG_THRESHOLDS.nonText,
      result: ratio >= WCAG_THRESHOLDS.nonText ? 'Pass' : 'Fail',
    },
  ];

  const lc = apcaLc(fgOpaque, bgOpaque);

  const tree: PreviewTreeNode = {
    className: 'sample',
    children: [
      { className: 'sample-normal', text: 'Normal text sample' },
      { className: 'sample-large', text: 'Large text sample' },
    ],
  };

  try {
    assertSafeTree(tree);
    const css = stylesheetText({
      rules: [
        {
          selector: '.sample',
          declarations: [
            ['color', formatHexColor(fgOpaque)],
            ['background-color', formatHexColor(bgOpaque)],
            ['width', formatLength(320, 'px')],
            ['height', formatLength(160, 'px')],
          ],
        },
        { selector: '.sample-normal', declarations: [['font-size', formatLength(16, 'px')]] },
        { selector: '.sample-large', declarations: [['font-size', formatLength(24, 'px')]] },
      ],
    });
    return { wcag: { ratio, results }, apca: { lc, label: APCA_LABEL, version: APCA_VERSION }, css, tree, warnings };
  } catch (err) {
    if (err instanceof CssSafetyError) throw new ContrastError(err.message);
    throw err;
  }
}
