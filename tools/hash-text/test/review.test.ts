import { it, expect } from 'vitest';
import { digestsMatch } from '../src/index';

// Tests for the findings of the phase 14 code review (part B) against hash-text.

// SHA-256 of "abc" (FIPS 180-4 appendix B.1), written out in each of the three encodings.
const SHA256_HEX = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const SHA256_BASE64 = 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=';
const SHA256_BASE64URL = 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0';

// B-IN-05: the comparison lower-cased everything and stripped hyphens and underscores, which are letters of the Base64
// and Base64url alphabets, so different values "matched".
it('Base64 and Base64url digests are compared case by case and character by character', () => {
  expect(digestsMatch(SHA256_BASE64, SHA256_BASE64)).toBe(true);
  expect(digestsMatch(SHA256_BASE64URL, SHA256_BASE64URL)).toBe(true);
  // Surrounding white space and a wrapped line do not matter.
  expect(digestsMatch(`  ${SHA256_BASE64}\n`, SHA256_BASE64)).toBe(true);
  expect(digestsMatch(`${SHA256_BASE64.slice(0, 20)}\n${SHA256_BASE64.slice(20)}`, SHA256_BASE64)).toBe(true);
  // A different case is a different value.
  expect(digestsMatch(SHA256_BASE64.toLowerCase(), SHA256_BASE64)).toBe(false);
  expect(digestsMatch(SHA256_BASE64.toUpperCase(), SHA256_BASE64)).toBe(false);
  expect(digestsMatch(SHA256_BASE64URL.toLowerCase(), SHA256_BASE64URL)).toBe(false);
  // The hyphen and the underscore are letters of Base64url: dropping them gives another value, not the same one.
  expect(digestsMatch(SHA256_BASE64URL.replaceAll('-', '').replaceAll('_', ''), SHA256_BASE64URL)).toBe(false);
  // (Text made only of hexadecimal digits and separators is read as hex, so these use letters outside a to f.)
  expect(digestsMatch('qr-st', 'qrst')).toBe(false);
  expect(digestsMatch('qr_st', 'qrst')).toBe(false);
  expect(digestsMatch('qr-st', 'qr_st')).toBe(false);
  // The same bytes in the two alphabets are written differently, so they are not the same text.
  expect(digestsMatch(SHA256_BASE64, SHA256_BASE64URL)).toBe(false);
  // A hex digest is not a Base64 one.
  expect(digestsMatch(SHA256_HEX, SHA256_BASE64)).toBe(false);
});

it('hex digests are still compared without regard to case, and separators are still ignored', () => {
  expect(digestsMatch(SHA256_HEX, SHA256_HEX.toUpperCase())).toBe(true);
  expect(digestsMatch(SHA256_HEX.toUpperCase(), SHA256_HEX)).toBe(true);
  expect(digestsMatch(SHA256_HEX.match(/.{2}/g)!.join(':'), SHA256_HEX)).toBe(true);
  expect(digestsMatch(SHA256_HEX.match(/.{8}/g)!.join(' '), SHA256_HEX)).toBe(true);
  expect(digestsMatch(SHA256_HEX.match(/.{8}/g)!.join('-'), SHA256_HEX)).toBe(true);
  expect(digestsMatch(SHA256_HEX.match(/.{8}/g)!.join('_'), SHA256_HEX)).toBe(true);
  expect(digestsMatch(SHA256_HEX, `${SHA256_HEX.slice(0, 63)}e`)).toBe(false);
});
