/**
 * WCAG 2.2 (https://www.w3.org/TR/WCAG22/) relative luminance, contrast
 * ratio, and the success-criterion thresholds for Contrast (Minimum) 1.4.3,
 * Contrast (Enhanced) 1.4.6, and Non-text Contrast 1.4.11.
 *
 * Relative luminance, quoted from the WCAG 2.2 glossary: "For the sRGB
 * colorspace, the relative luminance of a color is defined as L = 0.2126 *
 * R + 0.7152 * G + 0.0722 * B where R, G and B are defined as: if RsRGB <=
 * 0.04045 then R = RsRGB/12.92 else R = ((RsRGB+0.055)/1.055) ^ 2.4 ... and
 * RsRGB, GsRGB, and BsRGB are defined as: RsRGB = R8bit/255". Contrast
 * ratio, quoted from the same glossary: "(L1 + 0.05) / (L2 + 0.05), where
 * L1 is the relative luminance of the lighter of the colors, and L2 is the
 * relative luminance of the darker of the colors." Note 1 there: "Contrast
 * ratios can range from 1 to 21 (commonly written 1:1 to 21:1)."
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}
export interface RgbaColor extends RgbColor {
  alpha: number;
}

function linearise(channel8bit: number): number {
  const s = channel8bit / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.2's own relative luminance formula, 0 (darkest black) to 1 (lightest white). */
export function relativeLuminance(color: RgbColor): number {
  return 0.2126 * linearise(color.r) + 0.7152 * linearise(color.g) + 0.0722 * linearise(color.b);
}

/**
 * WCAG 2.2's own contrast ratio formula: "(L1 + 0.05) / (L2 + 0.05), where
 * L1 is the relative luminance of the lighter of the colors, and L2 is the
 * relative luminance of the darker of the colors." Always >= 1.
 */
export function contrastRatio(a: RgbColor, b: RgbColor): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const l1 = Math.max(la, lb);
  const l2 = Math.min(la, lb);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Success Criterion 1.4.3 Contrast (Minimum, Level AA): 4.5:1 for normal
 * text, 3:1 for large-scale text. Success Criterion 1.4.6 Contrast
 * (Enhanced, Level AAA): 7:1 for normal text, 4.5:1 for large-scale text.
 * Success Criterion 1.4.11 Non-text Contrast (Level AA): 3:1 for user
 * interface components and required graphical objects. "Large-scale
 * (text)" is defined in the WCAG 2.2 glossary as "with at least 18 point or
 * 14 point bold ... font size", which this tool's own page states as its
 * assumed pixel sizes (16px normal, 24px large), named in `limits`.
 */
export const WCAG_THRESHOLDS = {
  aa: { normal: 4.5, large: 3 },
  aaa: { normal: 7, large: 4.5 },
  nonText: 3,
} as const;

/**
 * Composites `top` over `bottom` using the standard "over" alpha-compositing
 * operator, in sRGB. When `bottom` is itself translucent, composite it over
 * white first (the WCAG 2.2 Understanding document's own default: "If no
 * background color is specified, then white is assumed") and pass the
 * fully-opaque result as `bottom` here.
 */
export function compositeOver(top: RgbaColor, bottom: RgbaColor): RgbaColor {
  const outAlpha = top.alpha + bottom.alpha * (1 - top.alpha);
  if (outAlpha <= 0) return { r: 0, g: 0, b: 0, alpha: 0 };
  const mix = (t: number, b: number): number => (t * top.alpha + b * bottom.alpha * (1 - top.alpha)) / outAlpha;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), alpha: outAlpha };
}

export const WHITE: RgbaColor = { r: 255, g: 255, b: 255, alpha: 1 };
