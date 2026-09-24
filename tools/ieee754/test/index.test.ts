import { describe, it, expect, vi } from 'vitest';
import { inspectFloat, fromBits, bitsFromHex, reportFromBits, Ieee754Error, type FloatFormat } from '../src/index';

// Pinned literal patterns (Round 3 ledger, cycle-3 hand fix). Computed with a
// BigInt-only reference classifier and a V8 round-trip probe, Node 22.14.0,
// as recorded in 02-06-PLAN.md's Review Dispositions Ledger.
const SIGNALLING = {
  binary32: ['0x7F800001', '0x7FA00000'],
  binary64: ['0x7FF0000000000001', '0x7FF4000000000000'],
} as const;

const QUIET_PAYLOAD = {
  binary32: { hex: '0x7FC00123', payload: 0x123n },
  binary64: { hex: '0x7FF8000000000123', payload: 0x123n },
} as const;

const LARGEST_SUBNORMAL = {
  binary32: { hex: '0x007FFFFF', exponent: -126, mantissa: 0x7fffffn },
  binary64: { hex: '0x000FFFFFFFFFFFFF', exponent: -1022, mantissa: 0xfffffffffffffn },
} as const;

const SMALLEST_NORMAL = {
  binary32: { hex: '0x00800000', exponent: -126 },
  binary64: { hex: '0x0010000000000000', exponent: -1022 },
} as const;

const NEGATIVE_ZERO = {
  binary32: '0x80000000',
  binary64: '0x8000000000000000',
} as const;

const FORMATS: FloatFormat[] = ['binary32', 'binary64'];

it('binary32 0x7f800001 reports exactly those bits and the signalling label', () => {
  const report = inspectFloat('0x7f800001', 'binary32', 'bits');
  expect(report.bits).toBe(BigInt('0x7f800001').toString(2).padStart(32, '0'));
  expect(report.label).toBe('signalling NaN');
  expect(report.isQuiet).toBe(false);
});

it('binary64 0x7ff0000000000001 reports exactly those bits and the signalling label', () => {
  const report = inspectFloat('0x7ff0000000000001', 'binary64', 'bits');
  expect(report.bits).toBe(BigInt('0x7ff0000000000001').toString(2).padStart(64, '0'));
  expect(report.label).toBe('signalling NaN');
  expect(report.isQuiet).toBe(false);
});

it('a not-a-number payload in the low mantissa bits survives unchanged', () => {
  const report32 = inspectFloat(QUIET_PAYLOAD.binary32.hex, 'binary32', 'bits');
  expect(report32.payload).toBe(QUIET_PAYLOAD.binary32.payload);
  expect(report32.isQuiet).toBe(true);

  const report64 = inspectFloat(QUIET_PAYLOAD.binary64.hex, 'binary64', 'bits');
  expect(report64.payload).toBe(QUIET_PAYLOAD.binary64.payload);
  expect(report64.isQuiet).toBe(true);
});

it('positive zero and negative zero produce different bit patterns and negative zero is labelled', () => {
  const positive = inspectFloat('0', 'binary32', 'value');
  const negative = inspectFloat('-0', 'binary32', 'value');
  expect(positive.bits).not.toBe(negative.bits);
  expect(positive.label).toBe('zero');
  expect(negative.label).toBe('negative zero');
  expect(positive.signBit).toBe('0');
  expect(negative.signBit).toBe('1');
});

it('both infinities have an all-ones exponent field and an all-zero mantissa', () => {
  for (const format of FORMATS) {
    const positive = inspectFloat('Infinity', format, 'value');
    const negative = inspectFloat('-Infinity', format, 'value');
    expect(positive.label).toBe('positive infinity');
    expect(negative.label).toBe('negative infinity');
    expect(positive.exponentField).toBe('1'.repeat(positive.exponentField.length));
    expect(negative.exponentField).toBe('1'.repeat(negative.exponentField.length));
    expect(positive.mantissaField).toBe('0'.repeat(positive.mantissaField.length));
    expect(negative.mantissaField).toBe('0'.repeat(negative.mantissaField.length));
  }
});

it('the smallest positive binary32 subnormal is labelled subnormal with the format minimum exponent', () => {
  // 2^-149, the smallest positive binary32 subnormal: bit pattern 0x00000001.
  const report = inspectFloat('0x00000001', 'binary32', 'bits');
  expect(report.label).toBe('subnormal');
  expect(report.hasImplicitLeadingOne).toBe(false);
  expect(report.unbiasedExponent).toBe(-126);
});

it('the decimal path agrees with an independent DataView for ordinary values in both formats', () => {
  const values = [1, -1, 0.5, 3.14, 100000, -12345.6789, 1e-10, 2 ** 10];

  for (const value of values) {
    // binary32: compute expected bits independently with our own DataView.
    const view32 = new DataView(new ArrayBuffer(4));
    view32.setFloat32(0, value, false);
    const expected32 = BigInt(view32.getUint32(0, false));
    const report32 = inspectFloat(String(value), 'binary32', 'value');
    expect(BigInt('0b' + report32.bits)).toBe(expected32);

    // binary64: same, with two 32-bit words joined.
    const view64 = new DataView(new ArrayBuffer(8));
    view64.setFloat64(0, value, false);
    const hi = BigInt(view64.getUint32(0, false));
    const lo = BigInt(view64.getUint32(4, false));
    const expected64 = (hi << 32n) | lo;
    const report64 = inspectFloat(String(value), 'binary64', 'value');
    expect(BigInt('0b' + report64.bits)).toBe(expected64);
  }
});

it('the three bit groups concatenated equal the full bit string', () => {
  const cases: [string, FloatFormat][] = [
    ['0x7f800001', 'binary32'],
    ['0x00000000', 'binary32'],
    ['0x80000000', 'binary32'],
    ['0x7ff0000000000001', 'binary64'],
    ['0x0010000000000000', 'binary64'],
  ];
  for (const [hex, format] of cases) {
    const report = inspectFloat(hex, format, 'bits');
    expect(report.signBit + report.exponentField + report.mantissaField).toBe(report.bits);
  }
});

it('a hexadecimal pattern of the wrong width is rejected naming the digit count required', () => {
  expect(() => inspectFloat('0x1234', 'binary32', 'bits')).toThrow(Ieee754Error);
  try {
    inspectFloat('0x1234', 'binary32', 'bits');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(Ieee754Error);
    expect((err as Error).message).toContain('8');
  }
  expect(() => inspectFloat('0x1234', 'binary64', 'bits')).toThrow(Ieee754Error);
  try {
    inspectFloat('0x1234', 'binary64', 'bits');
    expect.unreachable();
  } catch (err) {
    expect((err as Error).message).toContain('16');
  }
});

it('the decoded value of negative zero displays with its sign', () => {
  expect(inspectFloat('-0', 'binary32', 'value').decodedValue).toBe('-0');
  expect(inspectFloat('-0', 'binary64', 'value').decodedValue).toBe('-0');
  expect(inspectFloat(NEGATIVE_ZERO.binary32, 'binary32', 'bits').decodedValue).toBe('-0');
  expect(inspectFloat(NEGATIVE_ZERO.binary64, 'binary64', 'bits').decodedValue).toBe('-0');

  // fromBits is the display-only integer-to-number conversion reportFromBits
  // uses internally; exercised directly here so it stays covered on its own.
  expect(Object.is(fromBits(bitsFromHex(NEGATIVE_ZERO.binary32, 'binary32'), 'binary32'), -0)).toBe(true);
  expect(Object.is(fromBits(bitsFromHex(NEGATIVE_ZERO.binary64, 'binary64'), 'binary64'), -0)).toBe(true);
});

it('signalling not-a-number patterns in both widths come back bit-identical and labelled signalling', () => {
  for (const format of FORMATS) {
    for (const hex of SIGNALLING[format]) {
      const report = inspectFloat(hex, format, 'bits');
      expect(BigInt('0b' + report.bits)).toBe(BigInt(hex));
      expect(report.label).toBe('signalling NaN');
      expect(report.isQuiet).toBe(false);
    }
  }
});

it('a quiet not-a-number with a nonzero payload keeps that payload in both widths', () => {
  for (const format of FORMATS) {
    const { hex, payload } = QUIET_PAYLOAD[format];
    const report = inspectFloat(hex, format, 'bits');
    expect(BigInt('0b' + report.bits)).toBe(BigInt(hex));
    expect(report.label).toBe('quiet NaN');
    expect(report.isQuiet).toBe(true);
    expect(report.payload).toBe(payload);
  }
});

it('the largest subnormal in both widths is labelled subnormal with no implicit leading one', () => {
  for (const format of FORMATS) {
    const { hex, exponent, mantissa } = LARGEST_SUBNORMAL[format];
    const report = inspectFloat(hex, format, 'bits');
    expect(report.label).toBe('subnormal');
    expect(report.hasImplicitLeadingOne).toBe(false);
    expect(report.unbiasedExponent).toBe(exponent);
    expect(report.mantissa).toBe(mantissa);
  }
});

it('the smallest normal in both widths is labelled normal with the format minimum exponent', () => {
  for (const format of FORMATS) {
    const { hex, exponent } = SMALLEST_NORMAL[format];
    const report = inspectFloat(hex, format, 'bits');
    expect(report.label).toBe('normal');
    expect(report.hasImplicitLeadingOne).toBe(true);
    expect(report.unbiasedExponent).toBe(exponent);
    expect(report.mantissa).toBe(0n);
  }
});

it('negative zero in both widths is the sign bit alone and is labelled negative zero', () => {
  for (const format of FORMATS) {
    const report = inspectFloat(NEGATIVE_ZERO[format], format, 'bits');
    expect(report.label).toBe('negative zero');
    expect(report.signBit).toBe('1');
    expect(report.exponentField).toBe('0'.repeat(report.exponentField.length));
    expect(report.mantissaField).toBe('0'.repeat(report.mantissaField.length));
  }
});

it('hexadecimal inspection performs no floating-point write in either width', () => {
  const setFloat32 = vi.spyOn(DataView.prototype, 'setFloat32').mockImplementation(() => {
    throw new Error('float write during hexadecimal inspection');
  });
  const setFloat64 = vi.spyOn(DataView.prototype, 'setFloat64').mockImplementation(() => {
    throw new Error('float write during hexadecimal inspection');
  });

  try {
    const allPatterns: [string, FloatFormat][] = [
      ...SIGNALLING.binary32.map((h): [string, FloatFormat] => [h, 'binary32']),
      ...SIGNALLING.binary64.map((h): [string, FloatFormat] => [h, 'binary64']),
      [QUIET_PAYLOAD.binary32.hex, 'binary32'],
      [QUIET_PAYLOAD.binary64.hex, 'binary64'],
      [LARGEST_SUBNORMAL.binary32.hex, 'binary32'],
      [LARGEST_SUBNORMAL.binary64.hex, 'binary64'],
      [SMALLEST_NORMAL.binary32.hex, 'binary32'],
      [SMALLEST_NORMAL.binary64.hex, 'binary64'],
      [NEGATIVE_ZERO.binary32, 'binary32'],
      [NEGATIVE_ZERO.binary64, 'binary64'],
    ];

    for (const [hex, format] of allPatterns) {
      const report = inspectFloat(hex, format, 'bits');
      expect(BigInt('0b' + report.bits)).toBe(BigInt(hex));
    }

    expect(setFloat32).toHaveBeenCalledTimes(0);
    expect(setFloat64).toHaveBeenCalledTimes(0);
  } finally {
    setFloat32.mockRestore();
    setFloat64.mockRestore();
  }

  // The decimal path still works after restoring: 1.5 in binary64 is exact.
  const report = inspectFloat('1.5', 'binary64', 'value');
  expect(report.bits).toBe(BigInt('0x3FF8000000000000').toString(2).padStart(64, '0'));
});

it('the exported bit-pattern functions return every pinned pattern as the same BigInt', () => {
  const patterns: [string, FloatFormat][] = [
    ...SIGNALLING.binary32.map((h): [string, FloatFormat] => [h, 'binary32']),
    ...SIGNALLING.binary64.map((h): [string, FloatFormat] => [h, 'binary64']),
    [QUIET_PAYLOAD.binary32.hex, 'binary32'],
    [QUIET_PAYLOAD.binary64.hex, 'binary64'],
    [LARGEST_SUBNORMAL.binary32.hex, 'binary32'],
    [LARGEST_SUBNORMAL.binary64.hex, 'binary64'],
    [SMALLEST_NORMAL.binary32.hex, 'binary32'],
    [SMALLEST_NORMAL.binary64.hex, 'binary64'],
    [NEGATIVE_ZERO.binary32, 'binary32'],
    [NEGATIVE_ZERO.binary64, 'binary64'],
  ];

  for (const [hex, format] of patterns) {
    const bits = bitsFromHex(hex, format);
    expect(typeof bits).toBe('bigint');
    expect(bits).toBe(BigInt(hex));

    const report = reportFromBits(bits, format);
    expect(BigInt('0b' + report.bits)).toBe(BigInt(hex));
  }
});

describe('differential oracle: ordinary values agree with an independently hand-decomposed DataView reading', () => {
  it('binary32 3.14 matches a hand decomposition of an independent DataView read', () => {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, 3.14, false);
    const raw = view.getUint32(0, false);
    const sign = (raw >>> 31) & 1;
    const exponent = (raw >>> 23) & 0xff;
    const mantissa = raw & 0x7fffff;

    const report = inspectFloat('3.14', 'binary32', 'value');
    expect(Number(report.signBit)).toBe(sign);
    expect(report.biasedExponent).toBe(exponent);
    expect(Number(report.mantissa)).toBe(mantissa);
  });

  it('binary64 3.14 matches a hand decomposition of an independent DataView read', () => {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, 3.14, false);
    const hi = view.getUint32(0, false);
    const lo = view.getUint32(4, false);
    const sign = (hi >>> 31) & 1;
    const exponent = (hi >>> 20) & 0x7ff;
    const mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo >>> 0);

    const report = inspectFloat('3.14', 'binary64', 'value');
    expect(Number(report.signBit)).toBe(sign);
    expect(report.biasedExponent).toBe(exponent);
    expect(report.mantissa).toBe(mantissa);
  });
});

describe('source-attributed fixtures (IEEE 754-2019 special-case definitions, transcribed by hand)', () => {
  // The standard itself is paywalled (see testNotes). These fixtures are the
  // well-known canonical patterns for each special case, cross-checked with
  // a V8 DataView round-trip probe during the plan's cycle-3 hand fix.
  it('the two infinities are +Infinity and -Infinity at the canonical all-ones-exponent, all-zero-mantissa pattern', () => {
    expect(inspectFloat('0x7F800000', 'binary32', 'bits').label).toBe('positive infinity');
    expect(inspectFloat('0xFF800000', 'binary32', 'bits').label).toBe('negative infinity');
    expect(inspectFloat('0x7FF0000000000000', 'binary64', 'bits').label).toBe('positive infinity');
    expect(inspectFloat('0xFFF0000000000000', 'binary64', 'bits').label).toBe('negative infinity');
  });

  it('the two zeros are the all-zero pattern with only the sign bit differing', () => {
    expect(inspectFloat('0x00000000', 'binary32', 'bits').label).toBe('zero');
    expect(inspectFloat('0x80000000', 'binary32', 'bits').label).toBe('negative zero');
  });

  it('an ordinary value whose exponent and mantissa fields are quoted from source: binary32 1.0 is 0x3F800000', () => {
    const report = inspectFloat('0x3F800000', 'binary32', 'bits');
    expect(report.label).toBe('normal');
    expect(report.biasedExponent).toBe(127);
    expect(report.mantissa).toBe(0n);
    expect(report.unbiasedExponent).toBe(0);
  });
});
