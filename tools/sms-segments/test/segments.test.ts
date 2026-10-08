import { expect, it } from 'vitest';
import { analyseMessage } from '../src/index';

// 3GPP TS 23.040 clause 9.2.3.24.1: "the maximum length of the short message within the TPUD field is 153 (160-7)
// characters" for uncompressed GSM 7-bit default alphabet data, and a message that fits in one is 160 septets.
it('161 plain letters need 2 segments of 153 and 8 septets', () => {
  const one = analyseMessage('a'.repeat(160));
  expect(one.encoding).toBe('gsm7');
  expect(one.units).toBe(160);
  expect(one.segments.map((s) => s.used)).toEqual([160]);
  expect(one.segments.map((s) => s.capacity)).toEqual([160]);

  const two = analyseMessage('a'.repeat(161));
  expect(two.encoding).toBe('gsm7');
  expect(two.characters).toBe(161);
  expect(two.units).toBe(161);
  expect(two.single).toBe(160);
  expect(two.part).toBe(153);
  expect(two.segments.map((s) => s.used)).toEqual([153, 8]);
  expect(two.segments.map((s) => s.capacity)).toEqual([153, 153]);
  const last = two.segments[two.segments.length - 1]!;
  expect(last.capacity - last.used).toBe(145);
});
