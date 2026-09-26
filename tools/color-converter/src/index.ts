import meta from './meta.json';
import {
  ColorError,
  FORMATS,
  parseColor,
  convertColor,
  serializeColor,
  inSrgbGamut,
  gamutMapToSrgb,
  deltaEOK,
  type ColorFormat,
  type Color,
} from './color-space';

export { meta, FORMATS };
export type { ColorFormat };

export class ColorConverterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ColorConverterError';
  }
}

export interface FormatValue {
  format: ColorFormat;
  value: string;
}

export interface ConvertAllOptions {
  /** Decimal places for non-8-bit components. Default 3. */
  precision?: number;
  /** Use the legacy comma syntax for the formats that define one. Default false. */
  legacy?: boolean;
}

export interface ConvertAllResult {
  /** One entry per FORMATS, in that order. */
  formats: FormatValue[];
  /** Whether the parsed colour already falls inside sRGB. */
  inGamut: boolean;
  /** True when the sRGB-bound formats below were gamut-mapped rather than exact. */
  mapped: boolean;
  /** The Oklab colour-difference distance between the original colour and the mapped one (0 when inGamut). */
  deltaE: number;
  /** A hex string this tool's own serialiser produced, never the input text. */
  swatch: string;
  warnings: string[];
}

/** Formats whose display value is bound to the sRGB gamut and so uses the mapped colour when out of gamut. */
const SRGB_BOUND_FORMATS: readonly ColorFormat[] = ['hex', 'rgb', 'hsl', 'hwb', 'cmyk'];

/**
 * Parses one colour (CSS Color 4's hex, rgb(), hsl(), hwb(), lab(), lch(),
 * oklab(), oklch() and CSS Color 5's device-cmyk()) and converts it into
 * all nine supported formats. The sRGB-bound formats (hex, rgb, hsl, hwb,
 * cmyk) show the colour gamut-mapped into sRGB when it started out of
 * range; lab, lch, oklab and oklch always show the exact, unmapped value,
 * since those spaces can represent colours outside sRGB directly.
 */
export function convertAll(text: string, options?: ConvertAllOptions): ConvertAllResult {
  const precision = options?.precision ?? 3;
  const legacy = options?.legacy ?? false;

  let color: Color;
  try {
    color = parseColor(text);
  } catch (err) {
    if (err instanceof ColorError) throw new ColorConverterError(err.message);
    throw err;
  }

  const inGamut = inSrgbGamut(color);
  const mappedColor = inGamut ? convertColor(color, 'srgb') : gamutMapToSrgb(color);
  const deltaE = inGamut ? 0 : deltaEOK(color, mappedColor);
  const warnings: string[] = [];
  if (!inGamut) {
    warnings.push(
      `The colour is outside the sRGB gamut. HEX, RGB, HSL, HWB and CMYK below show it mapped into sRGB by the CSS Color 4 gamut mapping algorithm (Oklab distance ${deltaE.toFixed(4)} from the exact colour).`,
    );
  }

  const formats: FormatValue[] = FORMATS.map((format) => {
    const source = SRGB_BOUND_FORMATS.includes(format) ? mappedColor : color;
    return { format, value: serializeColor(source, format, { precision, legacy }) };
  });

  const swatch = serializeColor(mappedColor, 'hex');

  return { formats, inGamut, mapped: !inGamut, deltaE, swatch, warnings };
}
