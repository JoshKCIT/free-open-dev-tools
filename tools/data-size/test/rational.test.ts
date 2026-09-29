import { it, expect, describe } from 'vitest';
import { makeRational, addR, subR, mulR, divR, cmpR, fromBigInt, parseAmount, DataSizeError } from '../src/rational';

describe('rational arithmetic', () => {
  it('reduces by gcd and keeps a positive denominator', () => {
    expect(makeRational(6n, 3n)).toEqual({ num: 2n, den: 1n });
    expect(makeRational(3n, -6n)).toEqual({ num: -1n, den: 2n });
    expect(makeRational(0n, 5n)).toEqual({ num: 0n, den: 1n });
  });

  it('parse of 0.10 equals 1/10 reduced', () => {
    expect(parseAmount('0.10', 'value')).toEqual({ num: 1n, den: 10n });
  });

  it('exponent forms 1.5e3 and 25e-1 parse exactly', () => {
    expect(parseAmount('1.5e3', 'value')).toEqual({ num: 1500n, den: 1n });
    expect(parseAmount('25e-1', 'value')).toEqual({ num: 5n, den: 2n });
  });

  it('add, multiply, divide and compare agree with hand-computed fractions', () => {
    const a = makeRational(1n, 3n);
    const b = makeRational(1n, 6n);
    expect(addR(a, b)).toEqual(makeRational(1n, 2n));
    expect(subR(a, b)).toEqual(makeRational(1n, 6n));
    expect(mulR(a, b)).toEqual(makeRational(1n, 18n));
    expect(divR(a, b)).toEqual(makeRational(2n, 1n));
    expect(cmpR(a, b)).toBe(1);
    expect(cmpR(b, a)).toBe(-1);
    expect(cmpR(a, fromBigInt(0n))).toBe(1);
  });
});

describe('parseAmount refusals', () => {
  const bad = ['-1', '-0', 'abc', '1,5', '1.2.3', '1e', '0x10', 'Infinity', 'NaN', '', '١٢٣', 'x'.repeat(101)];
  for (const value of bad) {
    it(`refuses ${JSON.stringify(value)}`, () => {
      expect(() => parseAmount(value, 'size')).toThrow(DataSizeError);
    });
  }

  it('the error names the field', () => {
    try {
      parseAmount('abc', 'speed');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as DataSizeError).field).toBe('speed');
    }
  });

  it('1e30 and the 31-digit 10^30 are accepted; anything larger is refused', () => {
    expect(() => parseAmount('1e30', 'value')).not.toThrow();
    expect(() => parseAmount('1000000000000000000000000000000', 'value')).not.toThrow(); // 10^30, 31 digits
    expect(() => parseAmount('1000000000000000000000000000000.1', 'value')).toThrow(DataSizeError);
  });

  it('zero is accepted', () => {
    expect(parseAmount('0', 'size')).toEqual({ num: 0n, den: 1n });
  });
});
