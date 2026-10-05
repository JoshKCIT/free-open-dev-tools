import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { digestsMatch, expectedDigestLength } from '../src/index';

// The comparison of a pasted checksum is decided by the format of the digest the tool computed (the output format that
// was chosen), not by what the pasted text happens to look like. Base64 and Base64url are compared exactly; the
// hexadecimal formats ignore case and the separators colon, space, underscore and hyphen.

// SHA-256 of "abc" (FIPS 180-4 appendix B.1), and the same bytes in Base64 and Base64url made by Node's own crypto module.
const DIGEST = createHash('sha256').update('abc').digest();
const SHA256_HEX = DIGEST.toString('hex');
const SHA256_BASE64 = DIGEST.toString('base64');
const SHA256_BASE64URL = DIGEST.toString('base64url');

it('a short Base64url checksum made only of hexadecimal digits, hyphens and underscores is still compared exactly', () => {
  // The bytes edc000fc (a CRC-32 value) are 7cAA_A in Base64url: only hexadecimal digits, letters a to f and an underscore.
  const crc = Buffer.from('edc000fc', 'hex');
  expect(crc.toString('base64url')).toBe('7cAA_A');
  // 7caa_a is a different value (it is the bytes edc69afd), so it must not match.
  expect(Buffer.from('7caa_a', 'base64url').toString('hex')).toBe('edc69afd');
  expect(digestsMatch('7cAA_A', '7caa_a', 'base64url')).toBe(false);
  expect(digestsMatch('7caa_a', '7cAA_A', 'base64url')).toBe(false);
  expect(digestsMatch('7cAA_A', '7cAA_A', 'base64url')).toBe(true);
  expect(digestsMatch('7cAA_A', ' 7cAA_A\n', 'base64url')).toBe(true);
  // The underscore and the hyphen are letters of the value: dropped, moved or swapped, the text is another value.
  expect(digestsMatch('7cAA_A', '7cAAA', 'base64url')).toBe(false);
  expect(digestsMatch('7cAA_A', '7cA_AA', 'base64url')).toBe(false);
  expect(digestsMatch('7cAA_A', '7cAA-A', 'base64url')).toBe(false);
  expect(digestsMatch('7cAA_A', '_7cAAA', 'base64url')).toBe(false);
  // Hyphen in the computed text, moved in the pasted text.
  expect(digestsMatch('ab-cde', 'abc-de', 'base64url')).toBe(false);
  expect(digestsMatch('ab-cde', 'abcde-', 'base64url')).toBe(false);
  expect(digestsMatch('ab-cde', 'abcde', 'base64url')).toBe(false);
  expect(digestsMatch('ab-cde', 'AB-CDE', 'base64url')).toBe(false);
  expect(digestsMatch('ab-cde', 'ab-cde', 'base64url')).toBe(true);
  // Plain Base64 is exact too, even when its text happens to be hexadecimal digits only (such as cafeba).
  expect(digestsMatch('cafeba', 'CAFEBA', 'base64')).toBe(false);
  expect(digestsMatch('cafeba', 'cafeba', 'base64')).toBe(true);
  expect(digestsMatch('cafeba', 'cafeba', 'base64url')).toBe(true);
  expect(digestsMatch('cafeba', 'CAFEBA', 'base64url')).toBe(false);
});

it('every four-byte value in Base64url matches only its own text, whatever it looks like', () => {
  // A seeded run over 20,000 four-byte values (CRC-32 sized): the value matches itself and nothing written differently.
  let state = 20261004;
  const next = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state;
  };
  let looksHex = 0;
  for (let round = 0; round < 20_000; round++) {
    const bytes = Buffer.from([next() >>> 24, next() >>> 24, next() >>> 24, next() >>> 24]);
    const text = bytes.toString('base64url');
    expect(digestsMatch(text, text, 'base64url')).toBe(true);
    if (/^[0-9a-fA-F_-]+$/.test(text)) looksHex++;
    const swapped = text.replace(/[a-zA-Z]/g, (ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()));
    if (swapped !== text) expect(digestsMatch(text, swapped, 'base64url'), text).toBe(false);
    const bare = text.replaceAll('-', '').replaceAll('_', '');
    if (bare !== text) expect(digestsMatch(text, bare, 'base64url'), text).toBe(false);
  }
  // The look-alike case was reached in this run (about 0.06 percent of values), so the loop was not empty of it.
  expect(looksHex).toBeGreaterThan(0);
}, 60_000);

it('Base64 and Base64url SHA-256 checksums compare exactly with the format named, and the older checks still hold', () => {
  for (const [digest, format] of [
    [SHA256_BASE64, 'base64'],
    [SHA256_BASE64URL, 'base64url'],
  ] as const) {
    expect(digestsMatch(digest, digest, format)).toBe(true);
    expect(digestsMatch(`${digest.slice(0, 20)}\n${digest.slice(20)}`, digest, format)).toBe(true);
    expect(digestsMatch(digest.toLowerCase(), digest, format)).toBe(false);
    expect(digestsMatch(digest.toUpperCase(), digest, format)).toBe(false);
  }
  expect(digestsMatch(SHA256_BASE64URL, SHA256_BASE64URL.replaceAll('-', '').replaceAll('_', ''), 'base64url')).toBe(
    false,
  );
  expect(digestsMatch(SHA256_BASE64, SHA256_BASE64URL, 'base64')).toBe(false);
  expect(digestsMatch(SHA256_BASE64, SHA256_HEX, 'base64')).toBe(false);
  expect(digestsMatch(SHA256_BASE64URL, SHA256_HEX, 'base64url')).toBe(false);
});

it('the two hexadecimal formats still ignore case and the separators people put between bytes', () => {
  for (const format of ['hex', 'HEX'] as const) {
    const digest = format === 'hex' ? SHA256_HEX : SHA256_HEX.toUpperCase();
    expect(digestsMatch(digest, SHA256_HEX, format)).toBe(true);
    expect(digestsMatch(digest, SHA256_HEX.toUpperCase(), format)).toBe(true);
    expect(digestsMatch(digest, SHA256_HEX.match(/.{2}/g)!.join(':'), format)).toBe(true);
    expect(digestsMatch(digest, SHA256_HEX.match(/.{2}/g)!.join(':').toUpperCase(), format)).toBe(true);
    expect(digestsMatch(digest, SHA256_HEX.match(/.{8}/g)!.join(' '), format)).toBe(true);
    expect(digestsMatch(digest, SHA256_HEX.match(/.{8}/g)!.join('-'), format)).toBe(true);
    expect(digestsMatch(digest, SHA256_HEX.match(/.{8}/g)!.join('_'), format)).toBe(true);
    expect(digestsMatch(digest, `  ${SHA256_HEX}\n`, format)).toBe(true);
    expect(digestsMatch(digest, `${SHA256_HEX.slice(0, 63)}e`, format)).toBe(false);
    expect(digestsMatch(digest, SHA256_HEX.slice(0, 62), format)).toBe(false);
    // A Base64 checksum is not a hexadecimal one.
    expect(digestsMatch(digest, SHA256_BASE64, format)).toBe(false);
    expect(digestsMatch(digest, SHA256_BASE64URL, format)).toBe(false);
  }
  // A short hexadecimal digest (CRC-32) with its separators.
  expect(digestsMatch('edc000fc', 'ED:C0:00:FC', 'hex')).toBe(true);
  expect(digestsMatch('edc000fc', 'edc0_00fc', 'hex')).toBe(true);
  expect(digestsMatch('edc000fc', 'edc0-00fd', 'hex')).toBe(false);
  // Without a format the earlier rule is kept for callers that do not pass one: both texts looking hexadecimal.
  expect(digestsMatch('ABC123', 'abc123')).toBe(true);
  expect(digestsMatch('ab_c1-23', 'ABC123')).toBe(true);
});

it('the length hint counts separators by the output format, so a Base64url checksum keeps its hyphens and underscores', () => {
  expect(expectedDigestLength('7cAA_A', 'base64url')).toBe(6);
  expect(expectedDigestLength('7cAA_A', 'base64')).toBe(6);
  expect(expectedDigestLength('ab-cd', 'base64url')).toBe(5);
  expect(expectedDigestLength('ab-cd', 'hex')).toBe(4);
  expect(expectedDigestLength('ab_cd', 'HEX')).toBe(4);
  expect(expectedDigestLength(SHA256_BASE64URL, 'base64url')).toBe(43);
  expect(expectedDigestLength(SHA256_BASE64, 'base64')).toBe(44);
  expect(expectedDigestLength(SHA256_HEX.match(/.{8}/g)!.join('-'), 'hex')).toBe(64);
  // Text with a letter outside a to f in the hexadecimal formats counts its hyphen, as it did.
  expect(expectedDigestLength('qr-st', 'hex')).toBe(5);
  // The earlier one-argument form is unchanged.
  expect(expectedDigestLength('ab-cd')).toBe(4);
  expect(expectedDigestLength('qr-st')).toBe(5);
});
