import { it, expect, describe } from 'vitest';
import { formatRational } from '../src/format';
import { makeRational, fromBigInt } from '../src/rational';

describe('formatRational', () => {
  it('a whole number of at most 21 digits prints in full and is exact', () => {
    expect(formatRational(fromBigInt(1_073_741_824n), 6)).toEqual({ text: '1073741824', rounded: false });
  });

  it('zero prints 0', () => {
    expect(formatRational(fromBigInt(0n), 6)).toEqual({ text: '0', rounded: false });
  });

  it('1/1024 (0.0009765625) at 6 digits rounds half up to 0.000976563', () => {
    // 0.0009765625's 7th significant digit is exactly 5, so half-up rounds the 6th digit
    // (2) up to 3, giving ...563; round-half-to-even would give ...562 instead.
    const r = formatRational(makeRational(1n, 1024n), 6);
    expect(r.text).toBe('0.000976563');
    expect(r.rounded).toBe(true);
  });

  it('1/1024 at 12 digits prints the exact value', () => {
    const r = formatRational(makeRational(1n, 1024n), 12);
    expect(r.text).toBe('0.0009765625');
    expect(r.rounded).toBe(false);
  });

  it('1 bit in EiB (1/9223372036854775808) prints 1.0842e-19, marked rounded', () => {
    const r = formatRational(makeRational(1n, 9_223_372_036_854_775_808n), 6);
    expect(r.text).toBe('1.0842e-19');
    expect(r.rounded).toBe(true);
  });

  it('10^21 prints in scientific notation at 6 digits', () => {
    const r = formatRational(fromBigInt(10n ** 21n), 6);
    expect(r.text).toMatch(/e\+/);
  });

  it('a rounding carry (999999.6 -> 1000000) shifts the exponent correctly, matching JS toPrecision', () => {
    // (999999.6).toPrecision(6) === '1.00000e+6': once the carry pushes the value to 1000000,
    // decimal exponent 6 is outside the plain-notation range (-6..5 for 6 significant digits),
    // so scientific notation is correct, not a formatting mistake.
    expect((999999.6).toPrecision(6)).toBe('1.00000e+6');
    const r = formatRational(makeRational(9_999_996n, 10n), 6);
    expect(r.text).toBe('1e+6');
    expect(r.rounded).toBe(true);
  });

  it('trailing zeros are trimmed in plain decimal notation', () => {
    const r = formatRational(makeRational(1n, 2n), 6);
    expect(r.text).toBe('0.5');
    expect(r.rounded).toBe(false);
  });

  it('trailing zeros are trimmed in scientific notation', () => {
    const r = formatRational(fromBigInt(8n * 10n ** 21n), 6);
    expect(r.text).toBe('8e+21');
  });
});
