/**
 * Exact rational arithmetic over BigInt, so a size, speed or time can be
 * converted and compared without ever going through a floating-point
 * division. Always kept reduced (gcd divided out) with a positive
 * denominator, so equal values are always `===` field-for-field.
 */

export interface Rational {
  num: bigint;
  den: bigint;
}

function gcdBig(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

export function makeRational(num: bigint, den: bigint): Rational {
  if (den === 0n) throw new Error('rational: division by zero');
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  if (num === 0n) return { num: 0n, den: 1n };
  const g = gcdBig(num, den);
  return { num: num / g, den: den / g };
}

export function fromBigInt(n: bigint): Rational {
  return { num: n, den: 1n };
}

export const ZERO: Rational = { num: 0n, den: 1n };

export function isZero(r: Rational): boolean {
  return r.num === 0n;
}

export function addR(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function subR(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function mulR(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.num, a.den * b.den);
}

export function divR(a: Rational, b: Rational): Rational {
  if (b.num === 0n) throw new Error('rational: division by zero');
  return makeRational(a.num * b.den, a.den * b.num);
}

/** -1, 0 or 1 as a compares to b. */
export function cmpR(a: Rational, b: Rational): number {
  const l = a.num * b.den;
  const r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

export type AmountField = 'size' | 'speed' | 'time' | 'value';

export class DataSizeError extends Error {
  readonly field: AmountField;
  constructor(field: AmountField, message: string) {
    super(message);
    this.name = 'DataSizeError';
    this.field = field;
  }
}

const MAX_INPUT_LENGTH = 100;
const MAX_VALUE = fromBigInt(10n ** 30n);
const MAX_EXPONENT_MAGNITUDE = 100;

/**
 * Parses a decimal amount into an exact {@link Rational}. Never uses
 * `Number` or `parseFloat`: every digit is read by hand into a BigInt, so a
 * value like 1.005 is exactly 1005/1000, not whatever IEEE 754 double is
 * closest to it.
 *
 * Accepts: an optional leading `+`, one or more ASCII digits, an optional
 * single `.` followed by one or more digits, and an optional exponent
 * (`e`/`E`, an optional sign, 1 to 3 digits, magnitude at most 100).
 * Refuses: empty or non-numeric text, a minus sign, a comma, `Infinity`,
 * `NaN`, `0x10`, a dangling `e` with no digits, more than one `.`,
 * non-ASCII digits, input longer than 100 characters, and any value greater
 * than 10^30 (exactly 10^30 is accepted).
 */
export function parseAmount(text: string, field: AmountField): Rational {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new DataSizeError(field, 'Enter a number, such as 1.5');
  }
  if (trimmed.length > MAX_INPUT_LENGTH) {
    throw new DataSizeError(
      field,
      `That value is longer than ${MAX_INPUT_LENGTH} characters, longer than any real size, speed or time needs`,
    );
  }
  if (trimmed.includes(',')) {
    throw new DataSizeError(field, 'Use a dot as the decimal separator and no thousands separators');
  }
  if (trimmed.startsWith('-')) {
    throw new DataSizeError(field, 'Enter a value of zero or more');
  }

  const match = /^\+?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,3}))?$/.exec(trimmed);
  if (!match) {
    throw new DataSizeError(field, 'Enter a number, such as 1.5');
  }
  const intPart = match[1]!;
  const fracPart = match[2] ?? '';
  const expPart = match[3];
  const exponent = expPart !== undefined ? parseInt(expPart, 10) : 0;
  if (Math.abs(exponent) > MAX_EXPONENT_MAGNITUDE) {
    throw new DataSizeError(field, `Enter a number with an exponent no larger than ${MAX_EXPONENT_MAGNITUDE}`);
  }

  const digits = intPart + fracPart;
  const digitsBig = BigInt(digits);
  const scale = exponent - fracPart.length;
  const value =
    scale >= 0 ? fromBigInt(digitsBig * 10n ** BigInt(scale)) : makeRational(digitsBig, 10n ** BigInt(-scale));

  if (cmpR(value, MAX_VALUE) > 0) {
    throw new DataSizeError(field, 'That value is larger than 10^30, beyond any real size, speed or time');
  }
  return value;
}
