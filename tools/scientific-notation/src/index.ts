import meta from './meta.json';

export { meta };

export type Notation = 'decimal' | 'scientific' | 'engineering' | 'e';

export class ScientificNotationError extends Error {
  /** Index into the input where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'ScientificNotationError';
    this.position = position;
  }
}

export interface DecimalValue {
  sign: 1 | -1;
  /**
   * Significant digits, no decimal point, leading zeros stripped. The first
   * character is non-zero unless the value is zero, in which case this is
   * the single character "0". Trailing zeros the input actually wrote are
   * kept — they are never stripped, and no digit here is ever invented.
   */
  digits: string;
  /**
   * Power of ten of the first digit: value = sign * d0.d1d2... * 10^exponent,
   * where d0 is `digits[0]`. Unused (0) when `digits` is "0".
   */
  exponent: number;
  /** True when the input contained a separator (comma, underscore or space) that was stripped. */
  separatorStripped: boolean;
}

export interface FormatOptions {
  /** Round to this many significant figures, half away from zero. Never adds precision beyond what `digits` already has. */
  significantFigures?: number;
  /**
   * Use the letter form of the exponent (`1.5e+10`) instead of `× 10^n` for
   * `scientific` and `engineering`. `e` notation always uses the letter
   * form regardless of this option.
   */
  letterExponent?: boolean;
}

/**
 * The largest number of characters a decimal expansion may produce. Checked
 * with integer arithmetic on the exponent and the digit count *before* any
 * string is built, because this page runs on every keystroke by default and
 * an exponent of a billion must be rejected promptly rather than attempting
 * a billion-character expansion.
 */
export const MAX_OUTPUT_DIGITS = 100000;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

/** Converts a string of decimal digit characters to an integer, without `Number`, `parseInt` or `parseFloat`. */
function digitsToInt(text: string): number {
  let result = 0;
  for (let i = 0; i < text.length; i++) {
    result = result * 10 + (text.charCodeAt(i) - 48);
  }
  return result;
}

interface ScanResult {
  sign: 1 | -1;
  integerPart: string;
  fractionPart: string;
  exponentSign: 1 | -1;
  exponentDigits: string;
}

/**
 * Hand-rolled single-pass scanner over an already-cleaned string (separators
 * removed). This is what rejects an arithmetic expression such as `0.1+0.2`
 * rather than evaluating it: the scanner only ever recognises one optional
 * sign, one run of integer digits, one optional point and fraction digits,
 * and one optional exponent — a second `+` or any other stray character
 * stops the scan and the "characters left over" check below rejects it.
 */
function scanNumber(cleaned: string, original: string): ScanResult {
  let i = 0;
  let sign: 1 | -1 = 1;
  if (cleaned[i] === '+' || cleaned[i] === '-') {
    sign = cleaned[i] === '-' ? -1 : 1;
    i++;
  }

  let integerPart = '';
  while (isDigit(cleaned[i])) {
    integerPart += cleaned[i];
    i++;
  }

  let fractionPart = '';
  if (cleaned[i] === '.') {
    i++;
    while (isDigit(cleaned[i])) {
      fractionPart += cleaned[i];
      i++;
    }
  }

  if (integerPart === '' && fractionPart === '') {
    throw new ScientificNotationError(
      `"${original}" is not a decimal number. Expected an optional sign, digits, an optional decimal point and an optional exponent such as 1.5e10.`,
      0,
    );
  }

  let exponentSign: 1 | -1 = 1;
  let exponentDigits = '';
  if (cleaned[i] === 'e' || cleaned[i] === 'E') {
    const eIndex = i;
    i++;
    if (cleaned[i] === '+' || cleaned[i] === '-') {
      exponentSign = cleaned[i] === '-' ? -1 : 1;
      i++;
    }
    while (isDigit(cleaned[i])) {
      exponentDigits += cleaned[i];
      i++;
    }
    if (exponentDigits === '') {
      throw new ScientificNotationError(
        `"${original}" has an "e" with no digits after it. Expected an exponent such as e10 or e-5.`,
        eIndex,
      );
    }
  }

  if (i !== cleaned.length) {
    throw new ScientificNotationError(
      `"${original}" is not a decimal number: an arithmetic expression, extra character, or unexpected symbol "${cleaned[i]}" was found where the number should have ended.`,
      i,
    );
  }

  return { sign, integerPart, fractionPart, exponentSign, exponentDigits };
}

/**
 * Parses text into an exact decimal representation: a sign, a digit string
 * with no point in it, and an integer exponent saying where the point sits.
 * Nothing here parses into a JavaScript number at any point — every digit
 * the visitor typed survives exactly, however many of them there are.
 */
export function parseNumber(input: string): DecimalValue {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new ScientificNotationError('Nothing to convert.', 0);
  }

  let separatorStripped = false;
  let cleaned = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === ',' || ch === '_' || ch === ' ') {
      separatorStripped = true;
      continue;
    }
    cleaned += ch;
  }
  if (cleaned === '') {
    throw new ScientificNotationError('Nothing to convert.', 0);
  }

  const scan = scanNumber(cleaned, input);
  const rawDigits = scan.integerPart + scan.fractionPart;
  const pointPosition = scan.integerPart.length;

  let leadingZeros = 0;
  while (leadingZeros < rawDigits.length && rawDigits[leadingZeros] === '0') leadingZeros++;

  if (leadingZeros === rawDigits.length) {
    // Every digit is zero: the value is (signed) zero.
    return { sign: scan.sign, digits: '0', exponent: 0, separatorStripped };
  }

  const digits = rawDigits.slice(leadingZeros);
  const userExponent = scan.exponentSign * digitsToInt(scan.exponentDigits);
  const exponent = pointPosition - leadingZeros - 1 + userExponent;

  return { sign: scan.sign, digits, exponent, separatorStripped };
}

/**
 * Rounds a digit string to `sig` significant figures, half away from zero —
 * a digit-string operation on the representation, not a numeric one. Never
 * adds digits: if `sig` is at least as long as `digits`, it is returned
 * unchanged rather than padded with invented zeros.
 */
function roundToSignificantFigures(
  digits: string,
  exponent: number,
  sig: number,
): { digits: string; exponent: number } {
  if (sig >= digits.length) return { digits, exponent };
  const keepCount = Math.max(1, sig);
  const keep = digits.slice(0, keepCount);
  const roundUp = digits.charCodeAt(keepCount) >= 53; // '5'.charCodeAt(0) === 53

  if (!roundUp) return { digits: keep, exponent };

  const chars = keep.split('');
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] === '9') {
      chars[i] = '0';
      i--;
    } else {
      chars[i] = String(digitsToInt(chars[i]!) + 1);
      break;
    }
  }
  if (i < 0) {
    // Carried out past the front: 999 -> 1000, so prepend the carry digit
    // and drop the last place to keep the significant-figure count exact.
    chars.unshift('1');
    chars.pop();
    return { digits: chars.join(''), exponent: exponent + 1 };
  }
  return { digits: chars.join(''), exponent };
}

/** Splits a digit string so `n` digits sit before the point, padding on the right with zeros if there are not enough. */
function splitMantissa(digits: string, n: number): { before: string; after: string } {
  const padded = digits.length >= n ? digits : digits.padEnd(n, '0');
  return { before: padded.slice(0, n), after: padded.slice(n) };
}

function mantissaString(before: string, after: string): string {
  return after.length > 0 ? `${before}.${after}` : before;
}

/**
 * Predicts the length of a full decimal expansion with plain integer
 * arithmetic on `exponent` and `digits.length` — no string is built to
 * answer this question, so it costs nothing even for an enormous exponent.
 */
function predictedDecimalLength(digits: string, exponent: number): number {
  if (digits === '0') return 1;
  const pointPos = exponent + 1;
  if (pointPos <= 0) return 2 + -pointPos + digits.length; // "0." + zeros + digits
  if (pointPos >= digits.length) return pointPos; // digits followed by trailing zeros
  return digits.length + 1; // digits with a point inserted
}

function expandDecimal(digits: string, exponent: number): string {
  if (digits === '0') return '0';
  const pointPos = exponent + 1;
  if (pointPos <= 0) return '0.' + '0'.repeat(-pointPos) + digits;
  if (pointPos >= digits.length) return digits + '0'.repeat(pointPos - digits.length);
  return digits.slice(0, pointPos) + '.' + digits.slice(pointPos);
}

/**
 * Formats an exact decimal representation in one of four notations. Never
 * parses into a JavaScript number: a decimal expansion is digit-string
 * concatenation, and scientific/engineering/E notation just relocate the
 * point within the existing digit string.
 */
export function formatNumber(value: DecimalValue, notation: Notation, options: FormatOptions = {}): string {
  let { digits, exponent } = value;
  if (options.significantFigures !== undefined && options.significantFigures > 0) {
    ({ digits, exponent } = roundToSignificantFigures(digits, exponent, options.significantFigures));
  }
  const signPrefix = value.sign < 0 ? '-' : '';

  if (digits === '0') {
    return signPrefix + '0';
  }

  if (notation === 'decimal') {
    const predicted = predictedDecimalLength(digits, exponent);
    if (predicted > MAX_OUTPUT_DIGITS) {
      throw new ScientificNotationError(
        `Converting this to plain decimal would produce ${predicted} characters, more than the maximum of ${MAX_OUTPUT_DIGITS}. Use scientific or engineering notation instead.`,
        0,
      );
    }
    return signPrefix + expandDecimal(digits, exponent);
  }

  let leadingDigits = 1;
  let displayExponent = exponent;
  if (notation === 'engineering') {
    // Engineering notation is scientific notation with the exponent pushed
    // down to the nearest multiple of three at or below it.
    displayExponent = Math.floor(exponent / 3) * 3;
    leadingDigits = exponent - displayExponent + 1; // always 1, 2 or 3
  }

  const { before, after } = splitMantissa(digits, leadingDigits);
  const mantissa = mantissaString(before, after);
  const useLetterForm = notation === 'e' || options.letterExponent === true;

  if (useLetterForm) {
    const expSign = displayExponent < 0 ? '-' : '+';
    const magnitude = displayExponent < 0 ? -displayExponent : displayExponent;
    return `${signPrefix}${mantissa}e${expSign}${magnitude}`;
  }
  return `${signPrefix}${mantissa} × 10^${displayExponent}`;
}
