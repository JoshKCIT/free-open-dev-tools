/**
 * The arithmetic an RSA key needs, done with BigInt from the first byte to the last so no key number ever passes through a
 * JavaScript number: the product check n = p * q, the exponents dp = d mod (p - 1) and dq = d mod (q - 1), and the
 * coefficient qi = q^-1 mod p (RFC 8017 appendix A.1.2). An OpenSSH key and a JWK may leave dp, dq and qi out, and
 * PKCS#1 and PKCS#8 need them, so they are worked out here and, when given, checked against the worked-out value.
 *
 * Every number is an unsigned big-endian magnitude with no leading zero byte; zero is one zero byte.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */
import { KeyConverterError, RSA_MAX_BITS, type RsaKey } from './model';

const NO_PRIMES = 'This JWK has no prime factors (p and q), so it cannot be written as PKCS#1, PKCS#8 or OpenSSH.';
const DO_NOT_AGREE = 'The numbers of this RSA key do not agree.';

/** The bytes of a magnitude without its leading zeros (a zero is one zero byte). */
export function trimZeros(bytes: Uint8Array): Uint8Array {
  let skip = 0;
  while (skip < bytes.length - 1 && bytes[skip] === 0) skip++;
  return bytes.subarray(skip);
}

/** The number of bits in a magnitude: 0 for zero, 1 for one, 8 for 255. */
export function bitLength(bytes: Uint8Array): number {
  let skip = 0;
  while (skip < bytes.length && bytes[skip] === 0) skip++;
  if (skip === bytes.length) return 0;
  return (bytes.length - skip) * 8 - (Math.clz32(bytes[skip]!) - 24);
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  if (bytes.length === 0) return 0n;
  // One pass over a hex string: linear, where shifting a growing number once per byte would be quadratic.
  const digits = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) digits[i] = (bytes[i]! + 256).toString(16).slice(1);
  return BigInt('0x' + digits.join(''));
}

export function bigIntToBytes(value: bigint): Uint8Array {
  if (value < 0n) throw new KeyConverterError('A key number cannot be negative.');
  let text = value.toString(16);
  if (text.length % 2 === 1) text = '0' + text;
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The inverse of `a` modulo `m` (extended Euclid on BigInt). Refused when the two are not coprime. */
export function modInverse(a: Uint8Array, m: Uint8Array): Uint8Array {
  const modulus = bytesToBigInt(m);
  if (modulus <= 1n) throw new KeyConverterError(DO_NOT_AGREE);
  let previousR = modulus;
  let r = bytesToBigInt(a) % modulus;
  let previousT = 0n;
  let t = 1n;
  while (r !== 0n) {
    const quotient = previousR / r;
    [previousR, r] = [r, previousR - quotient * r];
    [previousT, t] = [t, previousT - quotient * t];
  }
  if (previousR !== 1n) throw new KeyConverterError(DO_NOT_AGREE);
  return bigIntToBytes(((previousT % modulus) + modulus) % modulus);
}

/** Refuses a modulus larger than the page reads, so a hostile number never sizes a large calculation. */
export function checkRsaModulus(n: Uint8Array): void {
  if (bitLength(n) > RSA_MAX_BITS) {
    throw new KeyConverterError(`This RSA key is larger than ${RSA_MAX_BITS} bits, which is the most this page reads.`);
  }
}

/**
 * Checks the numbers of an RSA key and fills in the ones that are missing. A key with no private numbers is returned as
 * it is. A private key needs d, p and q; its modulus must be p * q and d must undo e modulo p - 1 and q - 1; dp, dq and qi
 * are computed when absent and must equal the computed value when present.
 */
export function completeRsa(key: RsaKey): RsaKey {
  checkRsaModulus(key.n);
  const { d, p, q, dp, dq, qi } = key;
  if (
    d === undefined &&
    p === undefined &&
    q === undefined &&
    dp === undefined &&
    dq === undefined &&
    qi === undefined
  ) {
    return key;
  }
  if (p === undefined || q === undefined) throw new KeyConverterError(NO_PRIMES);
  if (d === undefined) throw new KeyConverterError('This RSA key lists prime factors but no private exponent (d).');
  // No private number can be larger than the modulus: this bounds every calculation below by the size of n.
  const limit = key.n.length;
  for (const value of [key.e, d, p, q, dp, dq, qi]) {
    if (value !== undefined && trimZeros(value).length > limit) throw new KeyConverterError(DO_NOT_AGREE);
  }
  const n = bytesToBigInt(key.n);
  const e = bytesToBigInt(key.e);
  const bigD = bytesToBigInt(d);
  const bigP = bytesToBigInt(p);
  const bigQ = bytesToBigInt(q);
  if (bigP < 3n || bigQ < 3n || bigP * bigQ !== n) throw new KeyConverterError(DO_NOT_AGREE);
  const pMinus = bigP - 1n;
  const qMinus = bigQ - 1n;
  // d is the inverse of e modulo both p - 1 and q - 1 (RFC 8017 section 3.2), which every real RSA key satisfies.
  const product = e * bigD;
  if (product % pMinus !== 1n || product % qMinus !== 1n) throw new KeyConverterError(DO_NOT_AGREE);
  const wantDp = bigIntToBytes(bigD % pMinus);
  const wantDq = bigIntToBytes(bigD % qMinus);
  const wantQi = modInverse(q, p);
  const same = (given: Uint8Array | undefined, want: Uint8Array): boolean =>
    given === undefined || bytesToBigInt(given) === bytesToBigInt(want);
  if (!same(dp, wantDp) || !same(dq, wantDq) || !same(qi, wantQi)) throw new KeyConverterError(DO_NOT_AGREE);
  return {
    type: 'rsa',
    n: trimZeros(key.n),
    e: trimZeros(key.e),
    d: trimZeros(d),
    p: trimZeros(p),
    q: trimZeros(q),
    dp: wantDp,
    dq: wantDq,
    qi: wantQi,
  };
}
