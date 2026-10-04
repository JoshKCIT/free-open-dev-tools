import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { digestsMatch, expectedDigestLength } from '../src/index';

// Tests for the File Hash comparison of a pasted checksum (clean-up of a finding of the phase 14 code review).

// SHA-256 of "abc" (FIPS 180-4 appendix B.1) in hex. The Base64 and Base64url forms are made from the same bytes by
// Node's own crypto module and Buffer, which is an independent implementation of both alphabets.
const SHA256_HEX = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const DIGEST = createHash('sha256').update('abc').digest();
const SHA256_BASE64 = DIGEST.toString('base64');
const SHA256_BASE64URL = DIGEST.toString('base64url');

/** The text with the letter at `index` written in the other case. */
function flipLetterAt(text: string, index: number): string {
  const ch = text.charAt(index);
  const other = ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase();
  // A digit or a symbol has no other case; the test must name a letter.
  expect(other, `position ${index} of the text is not a letter`).not.toBe(ch);
  return text.slice(0, index) + other + text.slice(index + 1);
}

it('Base64 and Base64url digests compare exactly apart from white space, so wrong case no longer matches', () => {
  // The published value and the two encodings of it are what the test thinks they are.
  expect(DIGEST.toString('hex')).toBe(SHA256_HEX);
  expect(SHA256_BASE64).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  expect(SHA256_BASE64URL).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');

  for (const digest of [SHA256_BASE64, SHA256_BASE64URL]) {
    // The same text matches itself, with white space around it, and with a wrapped line.
    expect(digestsMatch(digest, digest)).toBe(true);
    expect(digestsMatch(`  ${digest}\n`, digest)).toBe(true);
    expect(digestsMatch(`${digest.slice(0, 20)}\n${digest.slice(20)}`, digest)).toBe(true);
    expect(digestsMatch(digest, `${digest.slice(0, 20)} \t${digest.slice(20)}`)).toBe(true);
    // One letter in the other case is a different value, at the start, in the middle and at the end.
    expect(digestsMatch(flipLetterAt(digest, 0), digest)).toBe(false);
    expect(digestsMatch(digest, flipLetterAt(digest, 10))).toBe(false);
    expect(digestsMatch(flipLetterAt(digest, 41), digest)).toBe(false);
    // So is the whole text in one case.
    expect(digestsMatch(digest.toLowerCase(), digest)).toBe(false);
    expect(digestsMatch(digest.toUpperCase(), digest)).toBe(false);
  }

  // The hyphen and the underscore are letters of Base64url: taking them out gives another value.
  expect(digestsMatch(SHA256_BASE64URL.replaceAll('-', '').replaceAll('_', ''), SHA256_BASE64URL)).toBe(false);
  // The same bytes in the two alphabets are different text.
  expect(digestsMatch(SHA256_BASE64, SHA256_BASE64URL)).toBe(false);
  // A hexadecimal checksum is not a Base64 one.
  expect(digestsMatch(SHA256_HEX, SHA256_BASE64)).toBe(false);
  expect(digestsMatch(SHA256_BASE64URL, SHA256_HEX)).toBe(false);
});

it('hex digests still compare without case and without colon, space, underscore and hyphen separators', () => {
  expect(digestsMatch(SHA256_HEX, SHA256_HEX.toUpperCase())).toBe(true);
  expect(digestsMatch(SHA256_HEX.toUpperCase(), SHA256_HEX)).toBe(true);
  expect(digestsMatch(SHA256_HEX.match(/.{2}/g)!.join(':'), SHA256_HEX)).toBe(true);
  expect(digestsMatch(SHA256_HEX.match(/.{2}/g)!.join(':').toUpperCase(), SHA256_HEX)).toBe(true);
  expect(digestsMatch(SHA256_HEX.match(/.{8}/g)!.join(' '), SHA256_HEX)).toBe(true);
  expect(digestsMatch(SHA256_HEX.match(/.{8}/g)!.join('-'), SHA256_HEX)).toBe(true);
  expect(digestsMatch(SHA256_HEX.match(/.{8}/g)!.join('_'), SHA256_HEX)).toBe(true);
  expect(digestsMatch(`  ${SHA256_HEX}\n`, SHA256_HEX)).toBe(true);
  // A different value, or a different length, is still not a match.
  expect(digestsMatch(SHA256_HEX, `${SHA256_HEX.slice(0, 63)}e`)).toBe(false);
  expect(digestsMatch(SHA256_HEX, SHA256_HEX.slice(0, 62))).toBe(false);
});

it('the length hint counts a Base64url checksum with its hyphens and underscores', () => {
  // A Base64url SHA-256 is 43 characters and holds a hyphen and an underscore, which are part of the value.
  expect(SHA256_BASE64URL).toHaveLength(43);
  expect(SHA256_BASE64URL).toContain('-');
  expect(SHA256_BASE64URL).toContain('_');
  expect(expectedDigestLength(SHA256_BASE64URL)).toBe(43);
  // White space is never part of a checksum, so a wrapped or padded paste counts the same.
  expect(expectedDigestLength(`  ${SHA256_BASE64URL}\n`)).toBe(43);
  expect(expectedDigestLength(`${SHA256_BASE64URL.slice(0, 20)}\n${SHA256_BASE64URL.slice(20)}`)).toBe(43);
  // A Base64 SHA-256 is 44 characters with its padding, and its plus sign and slash count.
  expect(expectedDigestLength(SHA256_BASE64)).toBe(44);
  // A hexadecimal checksum does not count the separators people put between its bytes.
  expect(expectedDigestLength(SHA256_HEX)).toBe(64);
  expect(expectedDigestLength(SHA256_HEX.match(/.{2}/g)!.join(':'))).toBe(64);
  expect(expectedDigestLength(SHA256_HEX.match(/.{8}/g)!.join(' '))).toBe(64);
  expect(expectedDigestLength(SHA256_HEX.match(/.{8}/g)!.join('-'))).toBe(64);
  expect(expectedDigestLength(SHA256_HEX.match(/.{8}/g)!.join('_'))).toBe(64);
  // Text with a letter outside a to f is not hexadecimal, so its hyphen counts; made only of hexadecimal digits and
  // hyphens it reads as hexadecimal and its hyphen does not (the ambiguity stated in the tool's notes).
  expect(expectedDigestLength('qr-st')).toBe(5);
  expect(expectedDigestLength('ab-cd')).toBe(4);
  expect(expectedDigestLength('')).toBe(0);
});
