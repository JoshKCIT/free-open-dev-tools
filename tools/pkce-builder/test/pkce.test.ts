import { expect, it } from 'vitest';
import { PkceBuilderError, base64UrlEncode, checkVerifier, randomBase64Url, s256Challenge } from '../src/index';

// Every literal below is retyped from RFC 7636 (September 2015). The section is named beside it.

// Appendix B: the 32 octets the client's random number generator gave.
const APPENDIX_B_OCTETS = [
  116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91,
  88, 5, 88, 83, 132, 141, 121,
];
// Appendix B: the base64url of those octets is the code_verifier.
const APPENDIX_B_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
// Appendix B: the SHA-256 of the verifier, as octets.
const APPENDIX_B_DIGEST = [
  19, 211, 30, 150, 26, 26, 216, 236, 47, 22, 177, 12, 76, 152, 46, 8, 118, 168, 120, 173, 109, 241, 68, 86, 110, 225,
  137, 74, 203, 112, 249, 195,
];
// Appendix B: the base64url of the digest is the code_challenge.
const APPENDIX_B_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

it('the RFC 7636 Appendix B verifier gives the Appendix B S256 challenge', async () => {
  // The octet route: the 32 octets give the verifier, 43 characters with no padding.
  const octets = Uint8Array.from(APPENDIX_B_OCTETS);
  const made = randomBase64Url(32, (n) => {
    expect(n).toBe(32);
    return octets;
  });
  expect(made).toBe(APPENDIX_B_VERIFIER);
  expect(made).toHaveLength(43);
  expect(await s256Challenge(made)).toBe(APPENDIX_B_CHALLENGE);
  // The digest octets of Appendix B write the same challenge.
  expect(base64UrlEncode(Uint8Array.from(APPENDIX_B_DIGEST))).toBe(APPENDIX_B_CHALLENGE);
  // The text route: the verifier as typed.
  expect(await s256Challenge(APPENDIX_B_VERIFIER)).toBe(APPENDIX_B_CHALLENGE);
  expect(checkVerifier(APPENDIX_B_VERIFIER)).toEqual([]);
  // Section 4.2: the challenge is 43 characters, base64url, with no padding.
  expect(APPENDIX_B_CHALLENGE).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

it('verifiers of 42 and 129 characters and a disallowed character are refused by rule, never echoed', async () => {
  // Section 4.1: code-verifier = 43*128unreserved, unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~".
  const pattern = 'Zq3-_';
  const make = (length: number): string => pattern.repeat(Math.ceil(length / pattern.length)).slice(0, length);
  const short = make(42);
  const tooShort = checkVerifier(short);
  expect(tooShort.map((problem) => problem.rule)).toEqual(['too-short']);
  expect(tooShort[0]?.message).toContain('42');
  expect(tooShort[0]?.message).toContain('43');
  expect(tooShort[0]?.message).not.toContain(short.slice(0, 6));

  expect(checkVerifier(make(43))).toEqual([]);
  expect(checkVerifier(make(128))).toEqual([]);

  const long = make(129);
  const tooLong = checkVerifier(long);
  expect(tooLong.map((problem) => problem.rule)).toEqual(['too-long']);
  expect(tooLong[0]?.message).toContain('129');
  expect(tooLong[0]?.message).toContain('128');
  expect(tooLong[0]?.message).not.toContain(long.slice(0, 6));

  // A space inside a verifier of a good length is named by its code point and its position, not shown.
  const withSpace = make(20) + ' ' + make(22);
  expect(withSpace).toHaveLength(43);
  const spaced = checkVerifier(withSpace);
  expect(spaced.map((problem) => problem.rule)).toEqual(['character']);
  expect(spaced[0]?.message).toContain('U+0020');
  expect(spaced[0]?.message).toContain('21');
  expect(spaced[0]?.message).not.toContain(withSpace.slice(0, 6));

  // Only the first disallowed character is named, and a character beyond the basic plane keeps its whole code point.
  const emoji = make(30) + String.fromCodePoint(0x1f600) + '!' + make(30);
  const named = checkVerifier(emoji);
  expect(named).toHaveLength(1);
  expect(named[0]?.message).toContain('U+1F600');
  expect(named[0]?.message).not.toContain('U+0021');

  // The period and the tilde are allowed (section 4.1), and an empty verifier is too short.
  expect(checkVerifier('.'.repeat(20) + '~'.repeat(23))).toEqual([]);
  expect(checkVerifier('').map((problem) => problem.rule)).toEqual(['too-short']);

  // The challenge is never made for a verifier that breaks a rule, and the refusal never holds the verifier.
  for (const bad of [short, long, withSpace]) {
    let thrown: unknown = null;
    try {
      await s256Challenge(bad);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PkceBuilderError);
    expect((thrown as PkceBuilderError).part).toBe('verifier');
    expect((thrown as PkceBuilderError).message).not.toContain(bad.slice(0, 6));
  }
});
