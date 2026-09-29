/**
 * Renders an exact {@link Rational} to a fixed number of significant
 * digits, half up (away from zero), never through a float. A whole number
 * of at most 21 digits always prints in full and is exact, overriding the
 * significant-digit rounding entirely (so a value like 1 GiB in bytes,
 * 1073741824, prints exactly rather than being rounded to 6 digits).
 */
import type { Rational } from './rational';

export interface FormatResult {
  text: string;
  rounded: boolean;
}

function pow10(e: bigint): bigint {
  return 10n ** e;
}

/** True when num/den >= 10^e (num, den > 0). */
function geTenToThe(num: bigint, den: bigint, e: number): boolean {
  if (e >= 0) return num >= den * pow10(BigInt(e));
  return num * pow10(BigInt(-e)) >= den;
}

/** The integer e such that 10^e <= num/den < 10^(e+1) (num > 0, den > 0). */
function decimalExponent(num: bigint, den: bigint): number {
  let e = num.toString().length - den.toString().length;
  while (!geTenToThe(num, den, e)) e--;
  while (geTenToThe(num, den, e + 1)) e++;
  return e;
}

/** Half up (away from zero) rounding of the non-negative rational a/b to an integer. */
function roundDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  return 2n * r >= b ? q + 1n : q;
}

/** The first `n` significant digits of num/den (as an n-digit or n+1-digit integer if rounding carried), starting at decimal exponent `e`. */
function significantDigitsBig(num: bigint, den: bigint, n: number, e: number): bigint {
  const shift = n - 1 - e;
  if (shift >= 0) return roundDiv(num * pow10(BigInt(shift)), den);
  return roundDiv(num, den * pow10(BigInt(-shift)));
}

function plainDecimalFromDigits(digitsStr: string, exp: number): string {
  if (exp >= 0) {
    const intLen = exp + 1;
    const intPart = digitsStr.slice(0, intLen);
    const fracPart = digitsStr.slice(intLen).replace(/0+$/, '');
    return fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
  }
  const zeros = '0'.repeat(-exp - 1);
  const frac = (zeros + digitsStr).replace(/0+$/, '');
  return frac.length > 0 ? `0.${frac}` : '0';
}

function scientificFromDigits(digitsStr: string, exp: number): string {
  const first = digitsStr[0];
  const rest = digitsStr.slice(1).replace(/0+$/, '');
  const mantissa = rest.length > 0 ? `${first}.${rest}` : first;
  const sign = exp >= 0 ? '+' : '-';
  return `${mantissa}e${sign}${Math.abs(exp)}`;
}

export function formatRational(r: Rational, significantDigits: number): FormatResult {
  if (r.num === 0n) return { text: '0', rounded: false };

  if (r.den === 1n) {
    const s = r.num.toString();
    if (s.length <= 21) return { text: s, rounded: false };
  }

  const { num, den } = r;
  const e = decimalExponent(num, den);
  let digitsBig = significantDigitsBig(num, den, significantDigits, e);
  let exp = e;
  let digitsStr = digitsBig.toString();
  if (digitsStr.length > significantDigits) {
    // Rounding carried into an extra digit (e.g. 999999.6 -> 1000000): shift the exponent instead.
    exp += 1;
    digitsBig = digitsBig / 10n;
    digitsStr = digitsBig.toString();
  }
  while (digitsStr.length < significantDigits) digitsStr = '0' + digitsStr;

  const shift = significantDigits - 1 - exp;
  const exact =
    shift >= 0 ? num * pow10(BigInt(shift)) === den * digitsBig : num === den * pow10(BigInt(-shift)) * digitsBig;
  const rounded = !exact;

  const text =
    exp >= -6 && exp <= significantDigits - 1
      ? plainDecimalFromDigits(digitsStr, exp)
      : scientificFromDigits(digitsStr, exp);
  return { text, rounded };
}
