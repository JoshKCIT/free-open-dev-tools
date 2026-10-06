import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  PkceBuilderError,
  base64UrlEncode,
  buildAuthorizationRequest,
  checkVerifier,
  plainChallenge,
  randomBase64Url,
  randomUnreserved,
  s256Challenge,
} from '../src/index';
import { fields, mulberry32, seeded } from './helpers';

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

it('1,000 generated verifiers have the right length and alphabet and a challenge equal to Node crypto', async () => {
  // Section 4.1: 43 to 128 characters of the unreserved set. Section 4.2: the challenge is the base64url of the SHA-256.
  const source = seeded(20261006);
  const next = mulberry32(7);
  for (let i = 0; i < 1000; i++) {
    const length = 43 + Math.floor(next() * 86);
    const verifier = length === 43 ? randomBase64Url(32, source) : randomUnreserved(length, source);
    expect(verifier).toHaveLength(length);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(checkVerifier(verifier)).toEqual([]);
    const expected = createHash('sha256').update(verifier, 'ascii').digest('base64url');
    expect(await s256Challenge(verifier)).toBe(expected);
  }
});

it('every byte value maps onto the base64url alphabet exactly four times, so there is no modulo bias', () => {
  // RFC 4648 section 5, table 2: the 64 symbols in order. A byte b is written as the symbol at index b & 63.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const sweep = Uint8Array.from({ length: 256 }, (_, i) => i);
  const made = randomUnreserved(256, (count) => {
    expect(count).toBe(256);
    return sweep;
  });
  expect(made).toHaveLength(256);
  const counts = new Map<string, number>();
  for (const symbol of made) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  expect(counts.size).toBe(64);
  for (const symbol of alphabet) expect(counts.get(symbol)).toBe(4);
  // Each byte lands on the symbol its low six bits name, and the period and the tilde are never made.
  for (let b = 0; b < 256; b++) expect(made.charAt(b)).toBe(alphabet.charAt(b & 63));
  expect(made).not.toContain('.');
  expect(made).not.toContain('~');
  // A source that gives the wrong number of bytes is refused, and so is a count outside 1 to 1,024.
  expect(() => randomUnreserved(5, () => new Uint8Array(4))).toThrow(PkceBuilderError);
  expect(() => randomUnreserved(0, () => new Uint8Array(0))).toThrow(PkceBuilderError);
  expect(() => randomBase64Url(1025, () => new Uint8Array(1025))).toThrow(PkceBuilderError);
});

it('two runs with blank fields make different values and a filled verifier gives the same challenge every time', async () => {
  const blank = (seed: number) =>
    buildAuthorizationRequest(fields({ verifier: '', state: '', nonce: '', random: seeded(seed) }));
  const first = await blank(1);
  const second = await blank(2);
  // A verifier, a state and a nonce are made, in that order, and every one differs between the two runs.
  expect(first.made.map((value) => value.name)).toEqual(['verifier', 'state', 'nonce']);
  expect(second.made.map((value) => value.name)).toEqual(['verifier', 'state', 'nonce']);
  for (let i = 0; i < 3; i++) expect(first.made[i]?.value).not.toBe(second.made[i]?.value);
  expect(first.made[0]?.value).toHaveLength(43);
  expect(first.made[1]?.value).toHaveLength(22);
  expect(first.made[2]?.value).toHaveLength(22);
  expect(first.challenge).toBe(
    createHash('sha256')
      .update(first.made[0]?.value ?? '', 'ascii')
      .digest('base64url'),
  );
  expect(first.challenge).not.toBe(second.challenge);
  // The package keeps no state: the same seed gives the same request again, with other runs in between.
  expect(await blank(1)).toStrictEqual(first);
  expect(await blank(2)).toStrictEqual(second);
  expect(await blank(1)).toStrictEqual(first);
  // A chosen length other than 43 makes one character for each random byte.
  const sixty = await buildAuthorizationRequest(fields({ verifier: '', verifierLength: 60, random: seeded(3) }));
  expect(sixty.made.find((value) => value.name === 'verifier')?.value).toHaveLength(60);
  // A filled verifier gives the RFC 7636 appendix B challenge on every run, whatever the random source gives.
  for (const seed of [1, 2, 3, 99]) {
    const filled = await buildAuthorizationRequest(fields({ state: '', nonce: '', random: seeded(seed) }));
    expect(filled.challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(filled.made.map((value) => value.name)).toEqual(['state', 'nonce']);
  }
});

it('base64url without padding writes the same text as Node for every length from 0 to 100', () => {
  const next = mulberry32(42);
  for (let length = 0; length <= 100; length++) {
    const bytes = Uint8Array.from({ length }, () => Math.floor(next() * 256));
    const expected = Buffer.from(bytes).toString('base64url');
    expect(base64UrlEncode(bytes)).toBe(expected);
    expect(expected).not.toContain('=');
  }
});

it('the plain method gives the verifier back with the RFC 7636 and RFC 9700 warning', async () => {
  // Section 4.2: code_challenge = code_verifier for plain.
  const plain = plainChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  expect(plain.challenge).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  expect(plain.warning).toContain('RFC 7636');
  expect(plain.warning).toContain('RFC 9700');
  expect(plain.warning).toContain('S256');
  expect(() => plainChallenge('short')).toThrow(PkceBuilderError);
  const request = await buildAuthorizationRequest(fields({ method: 'plain' }));
  expect(request.url).toContain('code_challenge_method=plain');
  expect(request.url).toContain('code_challenge=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  expect(request.problems.some((problem) => problem.tone === 'warn' && problem.message.includes('plain'))).toBe(true);
});
