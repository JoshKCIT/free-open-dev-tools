import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { shake, SHAKE_MIN_BYTES, SHAKE_MAX_BYTES } from '../src/index';
import { NIST_SHAKE128_EMPTY_200, NIST_SHAKE256_EMPTY_200 } from './fixtures/nist-shake';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const utf8 = (text: string) => new TextEncoder().encode(text);

/** A small seeded generator, so the messages are the same on every run (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
});
afterEach(() => {
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it('SHAKE128 and SHAKE256 of the empty message give the FIPS 202 example values', () => {
  const empty = new Uint8Array(0);
  // The NIST example files for the empty message (FIPS 202 examples): SHAKE128 prints 7F 9C 2B A4 ... EF 26 first, and
  // SHAKE256 prints 46 B9 DD 2B ... C4 BE first.
  expect(hex(shake(empty, 'shake128', 32))).toBe('7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26');
  expect(hex(shake(empty, 'shake256', 64))).toBe(
    '46b9dd2b0ba88d13233b3feb743eeb243fcd52ea62b81b82b50c27646ed5762fd75dc4ddd8c0f200cb05019d67b592f6fc821c49479ab48640292eacb3b7c4be',
  );
  // 200 bytes of each example file cross the rate of each function (168 and 136 bytes), so they test the squeeze too.
  expect(NIST_SHAKE128_EMPTY_200).toHaveLength(400);
  expect(NIST_SHAKE256_EMPTY_200).toHaveLength(400);
  expect(hex(shake(empty, 'shake128', 200))).toBe(NIST_SHAKE128_EMPTY_200);
  expect(hex(shake(empty, 'shake256', 200))).toBe(NIST_SHAKE256_EMPTY_200);
  // The short message abc, from Node's own implementation (OpenSSL) while planning and again here.
  expect(hex(shake(utf8('abc'), 'shake128', 32))).toBe(
    '5881092dd818bf5cf8a3ddb793fbcba74097d5c526a6d35f97b83351940f2cc8',
  );
  expect(hex(shake(utf8('abc'), 'shake128', 32))).toBe(
    createHash('shake128', { outputLength: 32 }).update('abc').digest('hex'),
  );
});

it('SHAKE output equals Node createHash for 234 length and size combinations and shorter outputs are prefixes', () => {
  const lengths = [1, 7, 16, 32, 64, 100, 135, 136, 137, 168, 169, 1000, 4096];
  const sizes = [0, 1, 3, 135, 136, 167, 168, 169, 300];
  const next = seeded(14071);
  let combinations = 0;
  for (const variant of ['shake128', 'shake256'] as const) {
    for (const size of sizes) {
      const message = new Uint8Array(size);
      for (let i = 0; i < size; i++) message[i] = Math.floor(next() * 256);
      const longest = hex(shake(message, variant, SHAKE_MAX_BYTES));
      for (const length of lengths) {
        const mine = hex(shake(message, variant, length));
        const node = createHash(variant, { outputLength: length }).update(message).digest('hex');
        expect(mine, `${variant}, ${size} byte message, ${length} bytes`).toBe(node);
        expect(mine).toHaveLength(length * 2);
        expect(longest.startsWith(mine), `${variant} ${length} bytes is a prefix of 4096`).toBe(true);
        combinations++;
      }
    }
  }
  expect(combinations).toBe(234);
}, 60_000);

it('SHAKE lengths outside 1 to 4096 are refused and both ends are accepted', () => {
  expect(SHAKE_MIN_BYTES).toBe(1);
  expect(SHAKE_MAX_BYTES).toBe(4096);
  const message = utf8('abc');
  expect(shake(message, 'shake128', 1)).toHaveLength(1);
  expect(shake(message, 'shake256', 1)).toHaveLength(1);
  expect(shake(message, 'shake128', 4096)).toHaveLength(4096);
  expect(shake(message, 'shake256', 4096)).toHaveLength(4096);
  // The refusal names the range, for a typed length, a length one past each end, a fraction, a value that is not a
  // number and the large negative number the privacy harness types into every number field.
  const wrong: number[] = [0, -1, 4097, 1.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 1e9, -9999999999, 2 ** 32];
  for (const length of wrong) {
    expect(() => shake(message, 'shake128', length), String(length)).toThrow(
      'SHAKE output length must be a whole number from 1 to 4096.',
    );
    expect(() => shake(message, 'shake256', length), String(length)).toThrow(
      'SHAKE output length must be a whole number from 1 to 4096.',
    );
  }
  // A variant that is not one of the two is refused as well, whatever name it carries.
  for (const name of ['shake512', '__proto__', 'constructor', 'toString', '']) {
    expect(() => shake(message, name as 'shake128', 32), name).toThrow('Unknown SHAKE variant.');
  }
});
