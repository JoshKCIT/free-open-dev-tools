import { PkceBuilderError } from './errors';
import { MAX_RANDOM_COUNT, withCommas } from './limits';

/**
 * The only source of randomness: a function that returns `count` random bytes. A page passes
 * `(n) => crypto.getRandomValues(new Uint8Array(n))`; a test passes a seeded or a fixed one. Nothing here reads a global.
 */
export type RandomSource = (count: number) => Uint8Array;

/** The 64 symbols of the base64url alphabet (RFC 4648 section 5), all of them unreserved characters (RFC 7636 section 4.1). */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function checkCount(count: number, what: string): void {
  if (!Number.isInteger(count) || count < 1 || count > MAX_RANDOM_COUNT) {
    throw new PkceBuilderError(`Ask for 1 to ${withCommas(MAX_RANDOM_COUNT)} ${what}.`, 'length');
  }
}

function bytesFrom(random: RandomSource, count: number): Uint8Array {
  const bytes = random(count);
  if (bytes.length !== count) {
    throw new PkceBuilderError('The random source did not give the number of bytes asked for.', 'length');
  }
  return bytes;
}

/**
 * Writes bytes as base64url with no padding (RFC 7636 section 3 and appendix A): 3 bytes make 4 characters, and 1 or 2
 * left-over bytes make 2 or 3 characters. 32 bytes make 43 characters.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out +=
      ALPHABET.charAt((n >> 18) & 63) +
      ALPHABET.charAt((n >> 12) & 63) +
      ALPHABET.charAt((n >> 6) & 63) +
      ALPHABET.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63);
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63) + ALPHABET.charAt((n >> 6) & 63);
  }
  return out;
}

/**
 * `length` characters, one per random byte. Each byte is mapped onto the 64 symbols with `& 63`: 256 is a multiple of
 * 64, so every symbol is equally likely, with no modulo bias and no retry loop. The period and the tilde, which RFC 7636
 * also allows, are never produced.
 */
export function randomUnreserved(length: number, random: RandomSource): string {
  checkCount(length, 'characters');
  const bytes = bytesFrom(random, length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET.charAt((bytes[i] ?? 0) & 63);
  return out;
}

/** `byteCount` random bytes written as base64url: 32 bytes give a 43 character verifier, 16 bytes a 22 character state. */
export function randomBase64Url(byteCount: number, random: RandomSource): string {
  checkCount(byteCount, 'bytes');
  return base64UrlEncode(bytesFrom(random, byteCount));
}
