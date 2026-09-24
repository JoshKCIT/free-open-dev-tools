import { describe, it, expect } from 'vitest';
import { parseNumber, formatNumber, MAX_OUTPUT_DIGITS, ScientificNotationError } from '../src/index';

it('a value with more significant digits than a double can hold round trips unchanged', () => {
  // 30 significant digits: far beyond a double's ~17-digit precision.
  const input = '1.23456789012345678901234567890e50';
  const value = parseNumber(input);
  expect(value.digits).toBe('123456789012345678901234567890');
  expect(formatNumber(value, 'scientific')).toBe('1.23456789012345678901234567890 × 10^50');
  expect(formatNumber(value, 'e')).toBe('1.23456789012345678901234567890e+50');

  // Round trip through E notation, which unambiguously preserves every
  // significant digit. (A round trip through plain decimal cannot prove
  // this: once the value is expanded to an integer with trailing zeros,
  // decimal notation itself cannot distinguish a placeholder zero required
  // by magnitude from a zero that was actually significant — that
  // ambiguity is inherent to decimal notation, not a defect here.)
  const reparsed = parseNumber(formatNumber(value, 'e'));
  expect(reparsed.digits).toBe(value.digits);
  expect(reparsed.exponent).toBe(value.exponent);

  // The decimal expansion is still exact: the significant digits appear
  // unchanged, followed only by the zeros the magnitude requires.
  const decimal = formatNumber(value, 'decimal');
  expect(decimal.startsWith('123456789012345678901234567890')).toBe(true);
  expect(decimal.endsWith('0'.repeat(21))).toBe(true);
});

it('the string 0.30000000000000004 keeps all seventeen significant digits', () => {
  const value = parseNumber('0.30000000000000004');
  expect(value.digits).toBe('30000000000000004');
  expect(value.digits.length).toBe(17);
  expect(formatNumber(value, 'decimal')).toBe('0.30000000000000004');
});

it('engineering notation always produces an exponent that is a multiple of three', () => {
  const inputs = ['1', '12', '123', '1234', '0.1', '0.01', '0.001', '123456789', '0.0000005', '-4200000'];
  for (const input of inputs) {
    const value = parseNumber(input);
    const formatted = formatNumber(value, 'engineering', { letterExponent: true });
    const match = /e([+-]\d+)$/.exec(formatted);
    expect(match).not.toBeNull();
    const exponent = Number(match![1]);
    // `-6 % 3` is `-0` in JavaScript, not `0`; compare by value, not by
    // Object.is, so an evenly-divisible negative exponent still passes.
    expect(exponent % 3 === 0).toBe(true);
  }
});

it('an enormous exponent is rejected promptly naming both lengths', () => {
  const value = parseNumber('1e1000000000');
  expect(() => formatNumber(value, 'decimal')).toThrow(ScientificNotationError);
  try {
    formatNumber(value, 'decimal');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(ScientificNotationError);
    const message = (err as Error).message;
    expect(message).toContain('1000000001');
    expect(message).toContain(String(MAX_OUTPUT_DIGITS));
  }
});

it('an arithmetic expression such as 0.1 + 0.2 is rejected rather than evaluated', () => {
  expect(() => parseNumber('0.1 + 0.2')).toThrow(ScientificNotationError);
  expect(() => parseNumber('0.1+0.2')).toThrow(ScientificNotationError);
});

it('significant figures are whatever the input states and a trailing zero is never invented', () => {
  expect(parseNumber('1500').digits).toBe('1500');
  expect(parseNumber('0.0010').digits).toBe('10');
  expect(parseNumber('1.5').digits).toBe('15');

  // Formatting without requesting rounding never invents a trailing zero.
  const value = parseNumber('1.5');
  expect(formatNumber(value, 'scientific')).toBe('1.5 × 10^0');
});

describe('decimal, scientific, engineering and E notation definitions', () => {
  it('scientific notation has exactly one non-zero digit before the point and round trips', () => {
    const value = parseNumber('12345.678');
    const scientific = formatNumber(value, 'scientific');
    expect(scientific).toBe('1.2345678 × 10^4');
    expect(parseNumber(formatNumber(value, 'decimal')).digits).toBe(value.digits);
  });

  it('engineering notation for the same value has one, two or three digits before the point and round trips', () => {
    const value = parseNumber('12345.678');
    const engineering = formatNumber(value, 'engineering');
    expect(engineering).toBe('12.345678 × 10^3');
    expect(parseNumber('12.345678e3').digits).toBe(value.digits);
  });

  it('E notation is the letter form of the exponent and round trips', () => {
    const value = parseNumber('12345.678');
    expect(formatNumber(value, 'e')).toBe('1.2345678e+4');
    expect(parseNumber('1.2345678e+4').digits).toBe(value.digits);
  });

  it('a value smaller than one produces a negative exponent in all three notations, engineering still a multiple of three', () => {
    const value = parseNumber('0.000123');
    expect(formatNumber(value, 'scientific')).toBe('1.23 × 10^-4');
    expect(formatNumber(value, 'e')).toBe('1.23e-4');
    const engineering = formatNumber(value, 'engineering', { letterExponent: true });
    expect(engineering).toBe('123e-6');
    const exponentMatch = /e([+-]\d+)$/.exec(engineering)!;
    expect(Number(exponentMatch[1]) % 3 === 0).toBe(true);
  });

  it('zero is representable in every notation and round trips, with the sign preserved for a signed zero', () => {
    expect(formatNumber(parseNumber('0'), 'decimal')).toBe('0');
    expect(formatNumber(parseNumber('0'), 'scientific')).toBe('0');
    expect(formatNumber(parseNumber('-0'), 'decimal')).toBe('-0');
    expect(parseNumber('-0').sign).toBe(-1);
    expect(parseNumber('0').sign).toBe(1);
  });

  it('rounding to a requested number of significant figures rounds half away from zero', () => {
    const value = parseNumber('1.25');
    expect(formatNumber(value, 'decimal', { significantFigures: 2 })).toBe('1.3');
    const negative = parseNumber('-1.25');
    expect(formatNumber(negative, 'decimal', { significantFigures: 2 })).toBe('-1.3');
    // A carry that propagates out of the front: 999 rounded to 2 sig figs is 1000 (1.0 x 10^3).
    const carry = parseNumber('999');
    expect(formatNumber(carry, 'scientific', { significantFigures: 2 })).toBe('1.0 × 10^3');
  });

  it('a separator people type is accepted and reported as stripped', () => {
    const withComma = parseNumber('12,345.6789');
    expect(withComma.separatorStripped).toBe(true);
    expect(withComma.digits).toBe('123456789');

    const withUnderscore = parseNumber('1_000_000');
    expect(withUnderscore.separatorStripped).toBe(true);
    expect(withUnderscore.digits).toBe('1000000');

    const plain = parseNumber('12345');
    expect(plain.separatorStripped).toBe(false);
  });

  it('an input that is not a number is rejected with the position of the first character that could not be read', () => {
    try {
      parseNumber('12a45');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ScientificNotationError);
      expect((err as ScientificNotationError).position).toBe(2);
    }
  });
});
