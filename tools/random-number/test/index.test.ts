import { it, expect } from 'vitest';
import { generate, RandomNumberError } from '../src/index';

// The eight titles below are the contract the plan's `<verify>` step reads
// back from the machine-readable test report. Do not rename, remove, or wrap
// them in a `describe` block -- a title change here breaks that check even
// if the behaviour it names still holds.

it('rejection sampling discards a draw in the incomplete final block and uses the next byte', () => {
  // Range 0-2 is three values, so span = 3. A single byte covers it
  // (256 >= 3): the largest multiple of 3 that fits in a byte is 85*3 = 255,
  // so the complete blocks cover values 0-254 and the only incomplete-block
  // value is 255 itself. Supplying [255, 7] forces the first draw into that
  // incomplete block; a correct implementation discards it and reads the
  // next byte, 7, whose value 7 % 3 = 1 lands inside the range, giving 0 + 1.
  const result = generate({ mode: 'integer', min: 0, max: 2, count: 1, byteSource: [255, 7] });
  expect(result.values).toEqual(['1']);
});

it('a modulo of the same first byte would have returned a different value', () => {
  const result = generate({ mode: 'integer', min: 0, max: 2, count: 1, byteSource: [255, 7] });
  // A modulo-of-the-first-byte implementation would have used 255 directly:
  // 255 % 3 = 0, not the 1 that rejection sampling correctly returns above.
  const naiveModuloAnswer = String(255 % 3);
  expect(naiveModuloAnswer).toBe('0');
  expect(result.values[0]).not.toBe(naiveModuloAnswer);
});

it('ten integers between 1 and 6 are all inside the inclusive range', () => {
  const result = generate({ mode: 'integer', min: 1, max: 6, count: 10 });
  expect(result.values).toHaveLength(10);
  for (const v of result.values) {
    expect(v).toMatch(/^-?\d+$/);
    const n = Number(v);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(6);
  }
});

it('a lower bound above the upper bound is rejected naming both bounds', () => {
  expect(() => generate({ mode: 'integer', min: 10, max: 3, count: 1 })).toThrow(RandomNumberError);
  try {
    generate({ mode: 'integer', min: 10, max: 3, count: 1 });
    throw new Error('generate() did not throw');
  } catch (err) {
    expect(err).toBeInstanceOf(RandomNumberError);
    const message = (err as Error).message;
    expect(message).toContain('10');
    expect(message).toContain('3');
  }
});

it('more unique integers than the range holds is rejected rather than looping', () => {
  expect(() => generate({ mode: 'integer', min: 1, max: 3, count: 5, unique: true })).toThrow(RandomNumberError);
});

it('decimals have exactly the requested number of places and are inside the range', () => {
  const result = generate({ mode: 'decimal', min: 0, max: 1, places: 3, count: 5 });
  expect(result.values).toHaveLength(5);
  for (const v of result.values) {
    expect(v).toMatch(/^\d\.\d{3}$/);
    const n = Number(v);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(1);
  }
});

it('a decimal range with no representable value at the requested precision is rejected', () => {
  // Rounding to two places can only land on 0.00 or 0.01, and neither is
  // inside [0.004, 0.006], so the representable set is empty.
  expect(() => generate({ mode: 'decimal', min: 0.004, max: 0.006, places: 2, count: 1 })).toThrow(RandomNumberError);
  try {
    generate({ mode: 'decimal', min: 0.004, max: 0.006, places: 2, count: 1 });
    throw new Error('generate() did not throw');
  } catch (err) {
    expect(err).toBeInstanceOf(RandomNumberError);
    const message = (err as Error).message;
    expect(message).toContain('0.004');
    expect(message).toContain('0.006');
    expect(message).toContain('2');
  }
});

it('the result names the source of randomness that produced it', () => {
  const cryptoResult = generate({ mode: 'integer', min: 1, max: 6, count: 1 });
  expect(cryptoResult.source).toBe('crypto');

  const mathResult = generate({ mode: 'integer', min: 1, max: 6, count: 1, source: 'math' });
  expect(mathResult.source).toBe('math');
});

// Additional coverage, beyond the eight required titles above.

it('a lower bound equal to the upper bound returns that bound every time', () => {
  const result = generate({ mode: 'integer', min: 4, max: 4, count: 5 });
  expect(result.values).toEqual(['4', '4', '4', '4', '4']);
});

it('every value in a three-value range appears across a large sample', () => {
  const result = generate({ mode: 'integer', min: 0, max: 2, count: 500 });
  const seen = new Set(result.values);
  expect(seen).toEqual(new Set(['0', '1', '2']));
});

it('the non-cryptographic source still returns values inside the range', () => {
  const result = generate({ mode: 'integer', min: 1, max: 6, count: 20, source: 'math' });
  for (const v of result.values) {
    const n = Number(v);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(6);
  }
});

it('unique integers within a request never repeat', () => {
  const result = generate({ mode: 'integer', min: 1, max: 20, count: 15, unique: true });
  expect(new Set(result.values).size).toBe(15);
});

it('a non-finite bound is rejected', () => {
  expect(() => generate({ mode: 'integer', min: Number.NaN, max: 10, count: 1 })).toThrow(RandomNumberError);
  expect(() => generate({ mode: 'integer', min: 1, max: Number.POSITIVE_INFINITY, count: 1 })).toThrow(
    RandomNumberError,
  );
});

it('a count below one is rejected', () => {
  expect(() => generate({ mode: 'integer', min: 1, max: 6, count: 0 })).toThrow(RandomNumberError);
});
