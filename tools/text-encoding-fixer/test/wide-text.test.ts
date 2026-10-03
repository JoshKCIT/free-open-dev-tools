import { expect, it } from 'vitest';
import { MAX_INPUT_BYTES, looksLikeWideText } from '../src/index';

/*
 * A file in UTF-16 or UTF-32 with no byte order mark writes a line feed as 0A 00 (UTF-16LE), 00 0A (UTF-16BE) or three
 * zero bytes beside the 0A (UTF-32), and a carriage return the same way with 0D (Unicode Standard section 2.5, encoding
 * forms: every code unit is two or four bytes, and U+000A is the code unit 000A). Converting such a file one byte at a
 * time would change the 0A or 0D and leave the 00 beside it, which is not a line ending in that encoding (found by the
 * phase 13 review). The bytes below are written out by hand from those rules.
 */

const bytes = (...values: number[]) => Uint8Array.from(values);

it('says a file looks wide when most of its line endings sit next to a zero byte', () => {
  // UTF-16LE "a\nb\r\n": 61 00 0A 00 62 00 0D 00 0A 00
  expect(looksLikeWideText(bytes(0x61, 0, 0x0a, 0, 0x62, 0, 0x0d, 0, 0x0a, 0))).toBe(true);
  // UTF-16BE "a\nb": 00 61 00 0A 00 62
  expect(looksLikeWideText(bytes(0, 0x61, 0, 0x0a, 0, 0x62))).toBe(true);
  // UTF-32LE "a\nb": 61 00 00 00 0A 00 00 00 62 00 00 00
  expect(looksLikeWideText(bytes(0x61, 0, 0, 0, 0x0a, 0, 0, 0, 0x62, 0, 0, 0))).toBe(true);
  // UTF-32BE "a\n": 00 00 00 61 00 00 00 0A
  expect(looksLikeWideText(bytes(0, 0, 0, 0x61, 0, 0, 0, 0x0a))).toBe(true);
});

it('says nothing about a file of single byte text, one with no line endings, or one with an odd zero byte', () => {
  const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  expect(looksLikeWideText(text('a\r\nb\nc\rd'))).toBe(false);
  expect(looksLikeWideText(new Uint8Array(0))).toBe(false);
  // Zero bytes but no line ending: nothing to corrupt.
  expect(looksLikeWideText(bytes(0x61, 0, 0x62, 0))).toBe(false);
  // One line ending beside a zero byte among a hundred ordinary ones is an odd byte, not a wide encoding.
  const mixed = Uint8Array.from([...text('x\n'.repeat(100)), 0x0a, 0]);
  expect(looksLikeWideText(mixed)).toBe(false);
  // The UTF-8 mark and ordinary accents do not matter.
  expect(looksLikeWideText(bytes(0xef, 0xbb, 0xbf, 0x61, 0x0a, 0xc3, 0xa9, 0x0a))).toBe(false);
});

it('reads the largest input in one pass', () => {
  const big = new Uint8Array(MAX_INPUT_BYTES);
  for (let i = 0; i < big.length; i += 4) big[i] = 0x0a;
  const started = performance.now();
  expect(looksLikeWideText(big)).toBe(true);
  expect(performance.now() - started).toBeLessThan(2000);
});
