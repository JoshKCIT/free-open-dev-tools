import meta from './meta.json';
import { gs1CheckDigit, encodeEan13, encodeEan8, encodeUpcA, QUIET_ZONES, BarcodeError } from './ean-upc';
import { encodeCode128, CODE128_PATTERNS, MAX_CODE128_LENGTH } from './code128';
import { barcodeToSvg, type LabelGroup, type BarSvgOptions } from './svg';

export { meta };
export { gs1CheckDigit, encodeEan13, encodeEan8, encodeUpcA, QUIET_ZONES, BarcodeError };
export { encodeCode128, CODE128_PATTERNS, MAX_CODE128_LENGTH };
export { barcodeToSvg };
export type { LabelGroup, BarSvgOptions };

export type Symbology = 'code128' | 'ean13' | 'ean8' | 'upca';

export interface GenerateBarcodeOptions {
  symbology: Symbology;
  data: string;
  moduleWidth?: number;
  height?: number;
  showText?: boolean;
  dark?: string;
  light?: string;
}

export interface BarcodeGenerateResult {
  symbology: Symbology;
  text: string;
  svg: string;
  warnings: string[];
  /** The check digit (EAN/UPC) or check value (Code 128) this symbol carries. */
  check: string;
  /** True when this function computed the check digit/value rather than the visitor supplying and this function confirming it. */
  checkComputed: boolean;
}

function ean13Labels(text: string): LabelGroup[] {
  return [
    { text: text[0]!, startModule: -11, moduleSpan: 11 },
    { text: text.slice(1, 7), startModule: 3, moduleSpan: 42 },
    { text: text.slice(7, 13), startModule: 3 + 42 + 5, moduleSpan: 42 },
  ];
}

function ean8Labels(text: string): LabelGroup[] {
  return [
    { text: text.slice(0, 4), startModule: 3, moduleSpan: 28 },
    { text: text.slice(4, 8), startModule: 3 + 28 + 5, moduleSpan: 28 },
  ];
}

function upcaLabels(text: string): LabelGroup[] {
  return [
    { text: text[0]!, startModule: -9, moduleSpan: 9 },
    { text: text.slice(1, 11), startModule: 3, moduleSpan: 3 + 42 + 5 + 42 - 3 - 12 },
    { text: text[11]!, startModule: 3 + 42 + 5 + 42 + 3, moduleSpan: 9 },
  ];
}

/**
 * Builds any of the four symbologies as SVG, computing (or confirming) the
 * GS1 check digit / Code 128 check character along the way.
 */
export function generateBarcode(options: GenerateBarcodeOptions): BarcodeGenerateResult {
  const svgOptions: BarSvgOptions = {
    moduleWidth: options.moduleWidth,
    height: options.height,
    showText: options.showText,
    dark: options.dark,
    light: options.light,
  };

  if (options.symbology === 'code128') {
    const result = encodeCode128(options.data);
    const { output, warnings } = barcodeToSvg(
      result.modules,
      10,
      10,
      [{ text: options.data, startModule: 0, moduleSpan: result.modules.length }],
      svgOptions,
    );
    return {
      symbology: 'code128',
      text: options.data,
      svg: output,
      warnings,
      check: String(result.checkValue),
      checkComputed: true,
    };
  }

  const digitsOnly = options.data.replace(/[^0-9]/g, '');
  const suppliedCheckDigit = digitsOnly.length === expectedLengthWithCheck(options.symbology);

  if (options.symbology === 'ean13') {
    const r = encodeEan13(options.data);
    const { output, warnings } = barcodeToSvg(
      r.modules,
      QUIET_ZONES.ean13.left,
      QUIET_ZONES.ean13.right,
      ean13Labels(r.text),
      svgOptions,
    );
    return {
      symbology: 'ean13',
      text: r.text,
      svg: output,
      warnings,
      check: r.text.slice(-1),
      checkComputed: !suppliedCheckDigit,
    };
  }
  if (options.symbology === 'ean8') {
    const r = encodeEan8(options.data);
    const { output, warnings } = barcodeToSvg(
      r.modules,
      QUIET_ZONES.ean8.left,
      QUIET_ZONES.ean8.right,
      ean8Labels(r.text),
      svgOptions,
    );
    return {
      symbology: 'ean8',
      text: r.text,
      svg: output,
      warnings,
      check: r.text.slice(-1),
      checkComputed: !suppliedCheckDigit,
    };
  }
  // upca
  const r = encodeUpcA(options.data);
  const { output, warnings } = barcodeToSvg(
    r.modules,
    QUIET_ZONES.upca.left,
    QUIET_ZONES.upca.right,
    upcaLabels(r.text),
    svgOptions,
  );
  return {
    symbology: 'upca',
    text: r.text,
    svg: output,
    warnings,
    check: r.text.slice(-1),
    checkComputed: !suppliedCheckDigit,
  };
}

function expectedLengthWithCheck(symbology: Symbology): number {
  switch (symbology) {
    case 'ean13':
      return 13;
    case 'ean8':
      return 8;
    case 'upca':
      return 12;
    default:
      return 0;
  }
}
