/**
 * GS1 modulo 10 check digits and EAN-13, EAN-8 and UPC-A encodation.
 *
 * Every figure below is fetched and quoted from the GS1 General
 * Specifications (Release 26.0, fetched 2026-09-27 via
 * `ref.gs1.org/standards/genspecs/`, extracted with `pdftotext -layout`):
 * section 7.9.1 "Standard check digit calculations for GS1 data structures"
 * (Table 7-8, Table 7-9's own worked example), and section 5.2
 * "Linear barcodes - EAN/UPC symbology specifications" (5.2.1.2.1 Table 5-3
 * number sets, 5.2.1.2.2 Table 5-4 auxiliary patterns, 5.2.2.1-5.2.2.3
 * symbol structure, 5.2.3.4 Table 5-11 quiet zone widths).
 *
 * The digit element-width tables (Table 5-3) are cross-checked byte for
 * byte against the installed `@zxing/library`'s own
 * `AbstractUPCEANReader.L_PATTERNS` (fetched source)
 * -- both sources agree exactly (digit 0's set-A widths are
 * "3 2 1 1" in the fetched GS1 text and `[3, 2, 1, 1]` in the installed
 * library). The "set C" (right-half) width sequence per digit is the SAME
 * array as set A -- confirmed directly from `EAN13Reader.decodeMiddle`,
 * which decodes the right half by calling `decodeDigit` with the same
 * `L_PATTERNS` table, relying only on the guard pattern's colour
 * alternation to give set C's bars-first reading; GS1's own text says the
 * same thing in words ("Number set C characters are mirror images of
 * number set B characters"). Set B ("G") is each set A pattern's own
 * element widths in reverse order (`AbstractUPCEANReader`'s own
 * `L_AND_G_PATTERNS` construction, quoted in `code128.ts`'s sibling
 * comment).
 */

export class BarcodeError extends Error {
  readonly position?: number;
  readonly reason: string;
  constructor(message: string, reason: string, position?: number) {
    super(message);
    this.name = 'BarcodeError';
    this.reason = reason;
    this.position = position;
  }
}

/**
 * GS1 General Specifications Table 7-8 (the "Standard check digit
 * calculations for GS1 data structures" algorithm, identical for GTIN-8,
 * GTIN-12, GTIN-13, GTIN-14 and longer fixed-length fields): weights 3 and
 * 1 alternate starting from the RIGHTMOST digit, summed, then "Subtract
 * sum from nearest equal or higher multiple of ten". Table 7-9's own
 * worked example (18-digit field "376104250021234569"): data digits
 * "37610425002123456", weights "31313131313131313" (from N1), products sum
 * to 101, nearest higher multiple of ten is 110, check digit = 110 - 101 =
 * 9 -- reproduced exactly by this function below in `test/index.test.ts`.
 */
export function gs1CheckDigit(digits: string): string {
  if (!/^[0-9]+$/.test(digits) || digits.length === 0) {
    throw new BarcodeError('The check digit calculation needs one or more digits.', 'invalid-input');
  }
  let sum = 0;
  // Weights alternate 3, 1 starting from the RIGHTMOST digit.
  for (let i = 0; i < digits.length; i++) {
    const fromRight = digits.length - 1 - i;
    const weight = fromRight % 2 === 0 ? 3 : 1;
    sum += (digits.charCodeAt(i) - 48) * weight;
  }
  // "Subtract sum from nearest equal or higher multiple of ten" -- when sum
  // is itself a multiple of ten, Math.ceil(sum / 10) * 10 equals sum, so the
  // check digit is 0, exactly as "equal ... multiple of ten" requires.
  const nearestEqualOrHigherMultipleOfTen = Math.ceil(sum / 10) * 10;
  return String(nearestEqualOrHigherMultipleOfTen - sum);
}

/** Table 5-3 number set A element widths (space, bar, space, bar; each
 * digit's four elements sum to seven modules). Digit 0's "3 2 1 1" and
 * digit 9's "3 1 1 2" match the installed `@zxing/library`'s own
 * `AbstractUPCEANReader.L_PATTERNS` exactly. */
const SET_A_WIDTHS: readonly (readonly [number, number, number, number])[] = [
  [3, 2, 1, 1],
  [2, 2, 2, 1],
  [2, 1, 2, 2],
  [1, 4, 1, 1],
  [1, 1, 3, 2],
  [1, 2, 3, 1],
  [1, 1, 1, 4],
  [1, 3, 1, 2],
  [1, 2, 1, 3],
  [3, 1, 1, 2],
];

/** Table 5-5's leading-digit parity pattern for the six symbol characters
 * of an EAN-13 left half, as a 6-bit mask (bit 5 = symbol position 1,
 * ..., bit 0 = symbol position 6; 1 = number set B, 0 = number set A).
 * Digit 1's "A A B A B B" is bits 001011 = 0x0B, matching this table. */
const FIRST_DIGIT_PARITY: readonly number[] = [0x00, 0x0b, 0x0d, 0x0e, 0x13, 0x19, 0x1c, 0x15, 0x16, 0x1a];

function patternToModules(widths: readonly number[], startsWithBar: boolean): string {
  let out = '';
  let bar = startsWithBar;
  for (const w of widths) {
    out += (bar ? '1' : '0').repeat(w);
    bar = !bar;
  }
  return out;
}

function setADigit(d: number): string {
  return patternToModules(SET_A_WIDTHS[d]!, false);
}
function setBDigit(d: number): string {
  return patternToModules([...SET_A_WIDTHS[d]!].reverse(), false);
}
function setCDigit(d: number): string {
  return patternToModules(SET_A_WIDTHS[d]!, true);
}

/** Table 5-4: the normal guard bar pattern is bar-space-bar, one module
 * each (3 modules); the centre guard bar pattern is space-bar-space-bar-
 * space, one module each (5 modules). */
const NORMAL_GUARD = '101';
const CENTER_GUARD = '01010';

export interface BarcodeResult {
  /** The digit string actually encoded (including any check digit this
   * function computed). */
  text: string;
  /** The bar/space module string of the symbol's own bars, "1" for a bar
   * and "0" for a space -- quiet zones are not included here; `svg.ts`
   * adds each symbology's own quiet zone width from Table 5-11. */
  modules: string;
}

function assertDigits(input: string): void {
  if (!/^[0-9]*$/.test(input)) {
    const pos = [...input].findIndex((ch) => ch < '0' || ch > '9');
    throw new BarcodeError(`"${input[pos]}" at position ${pos + 1} is not a digit.`, 'non-digit', pos + 1);
  }
}

function checkOrCompute(dataDigits: string, providedCheck: string | undefined): string {
  const expected = gs1CheckDigit(dataDigits);
  if (providedCheck === undefined) return dataDigits + expected;
  if (providedCheck !== expected) {
    throw new BarcodeError(
      `The check digit "${providedCheck}" is wrong. The GS1 check digit for these digits is ${expected}.`,
      'wrong-check-digit',
      dataDigits.length + 1,
    );
  }
  return dataDigits + providedCheck;
}

/**
 * EAN-13 (5.2.2.1): left Quiet Zone, normal guard, six symbol characters
 * from number sets A and B (variable parity per the leading digit, Table
 * 5-5), centre guard, six symbol characters from number set C (the
 * rightmost of which is the check digit), normal guard, right Quiet Zone.
 * Accepts 12 data digits (a check digit is computed) or 13 (the 13th is
 * verified).
 */
export function encodeEan13(input: string): BarcodeResult {
  assertDigits(input);
  if (input.length !== 12 && input.length !== 13) {
    throw new BarcodeError('EAN-13 needs 12 digits, or 13 with the check digit included.', 'wrong-length');
  }
  const full = input.length === 13 ? checkOrCompute(input.slice(0, 12), input[12]) : checkOrCompute(input, undefined);

  const leading = full.charCodeAt(0) - 48;
  const parity = FIRST_DIGIT_PARITY[leading]!;
  let left = '';
  for (let i = 0; i < 6; i++) {
    const digit = full.charCodeAt(1 + i) - 48;
    const useB = (parity >> (5 - i)) & 1;
    left += useB ? setBDigit(digit) : setADigit(digit);
  }
  let right = '';
  for (let i = 0; i < 6; i++) {
    right += setCDigit(full.charCodeAt(7 + i) - 48);
  }
  return { text: full, modules: NORMAL_GUARD + left + CENTER_GUARD + right + NORMAL_GUARD };
}

/**
 * EAN-8 (5.2.2.2): left Quiet Zone, normal guard, four symbol characters
 * from number set A, centre guard, four symbol characters from number set
 * C (the rightmost the check digit), normal guard, right Quiet Zone.
 * Accepts 7 data digits (a check digit is computed) or 8 (the 8th is
 * verified). EAN-8 has no variable parity.
 */
export function encodeEan8(input: string): BarcodeResult {
  assertDigits(input);
  if (input.length !== 7 && input.length !== 8) {
    throw new BarcodeError('EAN-8 needs 7 digits, or 8 with the check digit included.', 'wrong-length');
  }
  const full = input.length === 8 ? checkOrCompute(input.slice(0, 7), input[7]) : checkOrCompute(input, undefined);

  let left = '';
  for (let i = 0; i < 4; i++) left += setADigit(full.charCodeAt(i) - 48);
  let right = '';
  for (let i = 0; i < 4; i++) right += setCDigit(full.charCodeAt(4 + i) - 48);
  return { text: full, modules: NORMAL_GUARD + left + CENTER_GUARD + right + NORMAL_GUARD };
}

/**
 * UPC-A (5.2.2.3): "A UPC-A barcode may be decoded as a 13-digit number by
 * adding an implied leading zero to the GTIN-12." Because EAN-13's own
 * leading-digit-0 parity pattern (Table 5-5) is AAAAAA, encoding
 * `'0' + full12` as EAN-13 produces bit-for-bit the same bars a UPC-A
 * symbol's own "six symbol characters from number set A" rule would
 * produce directly -- this is exactly what the required test
 * "UPC-A is encoded as the EAN-13 symbol with a leading zero as GS1
 * defines" checks. Accepts 11 data digits (a check digit is computed) or
 * 12 (the 12th is verified).
 */
export function encodeUpcA(input: string): BarcodeResult {
  assertDigits(input);
  if (input.length !== 11 && input.length !== 12) {
    throw new BarcodeError('UPC-A needs 11 digits, or 12 with the check digit included.', 'wrong-length');
  }
  const full = input.length === 12 ? checkOrCompute(input.slice(0, 11), input[11]) : checkOrCompute(input, undefined);
  const asEan13 = encodeEan13('0' + full);
  return { text: full, modules: asEan13.modules };
}

/** Table 5-11's own quiet zone widths, in modules, per symbology. */
export const QUIET_ZONES: Record<'ean13' | 'ean8' | 'upca', { left: number; right: number }> = {
  ean13: { left: 11, right: 7 },
  ean8: { left: 7, right: 7 },
  upca: { left: 9, right: 9 },
};
