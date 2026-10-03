import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Base32Error, decodeBase32, encodeBase32, secretHints } from '../src/base32';

/**
 * Expected values come from RFC 4648 section 10 (the seven published Base32 vectors) and from its section 6 (the
 * alphabet and the padding rule), never from the code under test.
 */

const spies = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};
beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockImplementation(() => undefined);
});
afterEach(() => {
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  for (const spy of Object.values(spies)) spy.mockReset();
});

/** RFC 4648 section 10, "Test Vectors": BASE32("f") = "MY======" and so on. */
const RFC4648_VECTORS: [string, string][] = [
  ['', ''],
  ['f', 'MY======'],
  ['fo', 'MZXQ===='],
  ['foo', 'MZXW6==='],
  ['foob', 'MZXW6YQ='],
  ['fooba', 'MZXW6YTB'],
  ['foobar', 'MZXW6YTBOI======'],
];

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (ch) => ch.charCodeAt(0));
const text = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

/** Puts a space after every fourth character and a hyphen after every fifth group, as secrets are often shown. */
function grouped(encoded: string): string {
  let out = '';
  for (let i = 0; i < encoded.length; i++) {
    if (i > 0 && i % 4 === 0) out += i % 8 === 0 ? '-' : ' ';
    out += encoded[i];
  }
  return out;
}

it('RFC 4648 section 10 Base32 vectors decode and encode, and lower case, spaces, hyphens and missing padding are accepted', () => {
  for (const [plain, encoded] of RFC4648_VECTORS) {
    expect(encodeBase32(ascii(plain)), `encode ${plain}`).toBe(encoded);
    expect(encodeBase32(ascii(plain), false), `encode unpadded ${plain}`).toBe(encoded.replace(/=+$/, ''));
    expect(text(decodeBase32(encoded)), `decode ${encoded}`).toBe(plain);
    expect(text(decodeBase32(encoded.replace(/=+$/, ''))), `decode unpadded ${encoded}`).toBe(plain);
    expect(text(decodeBase32(encoded.toLowerCase())), `decode lower case ${encoded}`).toBe(plain);
    expect(text(decodeBase32(grouped(encoded))), `decode grouped ${encoded}`).toBe(plain);
    expect(text(decodeBase32(`  ${encoded}\n`)), `decode padded with white space ${encoded}`).toBe(plain);
  }
  // Every 5 bit value 0 to 31 is one character of the section 6 alphabet A to Z then 2 to 7.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  expect(
    encodeBase32(
      Uint8Array.of(
        0x00,
        0x44,
        0x32,
        0x14,
        0xc7,
        0x42,
        0x54,
        0xb6,
        0x35,
        0xcf,
        0x84,
        0x65,
        0x3a,
        0x56,
        0xd7,
        0xc6,
        0x75,
        0xbe,
        0x77,
        0xdf,
      ),
    ),
    'the 32 symbols',
  ).toBe(alphabet);
  expect(Array.from(decodeBase32(alphabet)).length).toBe(20);
});

it('a bad Base32 character is refused with its position and never the character', () => {
  // The four digits RFC 4648 section 6 leaves out, a symbol, a letter with an accent and a stray padding sign.
  for (const bad of ['0', '1', '8', '9', '!', 'é', '=', '١']) {
    const input = `ABCDE${bad}GHIJKLMNOP`;
    let caught: unknown;
    try {
      decodeBase32(input);
    } catch (err) {
      caught = err;
    }
    expect(caught, `a ${bad.charCodeAt(0)} was accepted`).toBeInstanceOf(Base32Error);
    const error = caught as Base32Error;
    expect(error.position, 'the position is the index in what was typed').toBe(5);
    expect(error.message).toContain('character 6');
    expect(error.message.includes(bad), `the message repeats the character ${bad.charCodeAt(0)}`).toBe(false);
    expect(error.message.includes('ABCDE'), 'the message repeats the text before it').toBe(false);
    expect(error.message.includes('GHIJ'), 'the message repeats the text after it').toBe(false);
  }
  // The position counts what was typed, including the spaces and hyphens that are skipped.
  expect(() => decodeBase32('ABCD EFGH-IJ1L')).toThrowError(/character 13/);
  try {
    decodeBase32('ABCD EFGH-IJ1L');
  } catch (err) {
    expect((err as Base32Error).position).toBe(12);
  }
});

it('a short final group, bad padding and an empty secret are refused with a plain message', () => {
  // A final group of 1, 3 or 6 characters cannot hold whole bytes (RFC 4648 section 6: groups of 2, 4, 5 or 7 are used).
  for (const short of ['M', 'MZX', 'MZXW6Y', 'MZXW6YTBM', 'MZXW6YTBMZX', 'MZXW6YTBMZXW6Y']) {
    expect(() => decodeBase32(short), short).toThrowError(Base32Error);
  }
  // Padding must be exactly what section 6 writes for the length, and may only end the text.
  for (const wrong of ['MY=', 'MY=====', 'MY=======', 'MZXQ==', 'MZXW6=', 'MZ=XQ===', '======', 'MY======MY======']) {
    expect(() => decodeBase32(wrong), wrong).toThrowError(Base32Error);
  }
  expect(Array.from(decodeBase32('MY======'))).toEqual([0x66]);
  expect(Array.from(decodeBase32('MZXW6YTBOI======'))).toEqual(Array.from(ascii('foobar')));
});

it('the unused bits after the last whole byte are not checked and every message is plain', () => {
  // RFC 4648 section 3.5 lets a decoder reject non-zero pad bits; this one does not, so MZ (one byte, three spare bits) is read.
  expect(Array.from(decodeBase32('MZ'))).toEqual([0x66]);
  expect(Array.from(decodeBase32('MY'))).toEqual([0x66]);
  for (const input of ['M', 'ABCDE1GH', 'MY=', '\u0000ABC']) {
    try {
      decodeBase32(input);
      throw new Error('accepted');
    } catch (err) {
      expect(err).toBeInstanceOf(Base32Error);
      expect((err as Base32Error).message).toMatch(/^[A-Z][^]*\.$/);
    }
  }
});

it('secret hints say hexadecimal or Base64 only for text that looks like them and say nothing about the text', () => {
  expect(secretHints('3132333435363738393031323334353637383930').join(' ')).toMatch(/hexadecimal/);
  expect(secretHints('3132 3334 3536 3738 3930 3132 3334 3536').join(' ')).toMatch(/hexadecimal/);
  expect(secretHints('SGVsbG8rV29ybGQvMTIzNDU2Nzg5MA==').join(' ')).toMatch(/Base64/);
  expect(secretHints('abc+def/ghi').join(' ')).toMatch(/Base64/);
  expect(secretHints('JBSWY3DPEHPK3PXP')).toEqual([]);
  expect(secretHints('')).toEqual([]);
  for (const hint of secretHints('3132333435363738393031323334353637383930')) {
    expect(hint.includes('3132'), 'a hint repeats the text').toBe(false);
  }
});

it('random bytes survive an encode and a decode in both the padded and the unpadded form', () => {
  // A small seeded generator (mulberry32), never an unseeded random source.
  let state = 0x9e3779b9;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let round = 0; round < 300; round++) {
    const length = 1 + Math.floor(next() * 80);
    const bytes = Uint8Array.from({ length }, () => Math.floor(next() * 256));
    const padded = encodeBase32(bytes);
    expect(padded.length % 8).toBe(0);
    expect(Array.from(decodeBase32(padded))).toEqual(Array.from(bytes));
    expect(Array.from(decodeBase32(encodeBase32(bytes, false).toLowerCase()))).toEqual(Array.from(bytes));
  }
});
