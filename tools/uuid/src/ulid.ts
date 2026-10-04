import { IdentifierError, checkCount } from './id-errors';

/**
 * ULID: 128 bits written as 26 characters of Crockford base32. The first 48 bits are the Unix time in milliseconds and
 * the last 80 bits are random. Specification: https://github.com/ulid/spec
 */

/** The alphabet of the specification: Crockford base32 without the letters I, L, O and U. */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const MAX_MS = 281474976710655; // 2^48 - 1
const MAX_RANDOM = (1n << 80n) - 1n;

export interface DecodedUlid {
  /** Milliseconds since 1970-01-01T00:00:00Z. */
  ms: number;
  iso: string;
  /** The 80 random bits as 20 lowercase hexadecimal digits. */
  randomHex: string;
}

const TIME_MESSAGE = 'The time is outside what a ULID can hold (0 to 2^48 - 1 milliseconds).';

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // Always the cryptographic source, and only whole bytes of it.
  globalThis.crypto.getRandomValues(out);
  return out;
}

function randomBits80(): bigint {
  let value = 0n;
  for (const byte of randomBytes(10)) value = (value << 8n) | BigInt(byte);
  return value;
}

function encode(ms: number, random: bigint): string {
  let value = (BigInt(ms) << 80n) | random;
  const chars = new Array<string>(26);
  for (let i = 25; i >= 0; i--) {
    chars[i] = CROCKFORD_ALPHABET.charAt(Number(value & 31n));
    value >>= 5n;
  }
  return chars.join('');
}

// The last millisecond and random part handed out, so ids made in the same millisecond keep counting up, also across calls.
let lastMs = -1;
let lastRandom = 0n;

/**
 * Makes `count` ULIDs for the time `now`. Within one millisecond the random part of each id is the one before plus one,
 * as the specification describes for monotonic order; a new millisecond starts from a fresh random part. If the random
 * part would pass 2^80 - 1 the call is refused.
 */
export function generateUlids(count: number, now: number = Date.now()): string[] {
  checkCount(count);
  if (!Number.isInteger(now) || now < 0 || now > MAX_MS) throw new IdentifierError(TIME_MESSAGE);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let random: bigint;
    if (now === lastMs) {
      random = lastRandom + 1n;
      if (random > MAX_RANDOM) {
        throw new IdentifierError('Too many ULIDs in one millisecond: the 80-bit random part would overflow.');
      }
    } else {
      random = randomBits80();
    }
    lastMs = now;
    lastRandom = random;
    out.push(encode(now, random));
  }
  return out;
}

// Value of each ASCII character in the alphabet, upper and lower case alike; -1 for everything else.
const VALUES = new Int8Array(128).fill(-1);
for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) {
  const code = CROCKFORD_ALPHABET.charCodeAt(i);
  VALUES[code] = i;
  if (code >= 65 && code <= 90) VALUES[code + 32] = i;
}

/** Reads a ULID (any letter case) into its time and random part. */
export function decodeUlid(text: string): DecodedUlid {
  const trimmed = text.trim();
  if (trimmed.length !== 26) throw new IdentifierError('A ULID has exactly 26 characters.');
  let value = 0n;
  let first = 0;
  for (let i = 0; i < 26; i++) {
    const code = trimmed.charCodeAt(i);
    const digit = code < 128 ? VALUES[code]! : -1;
    if (digit < 0)
      throw new IdentifierError('A ULID uses only the characters 0 to 9 and A to Z without I, L, O and U.');
    if (i === 0) first = digit;
    value = (value << 5n) | BigInt(digit);
  }
  // 26 characters hold 130 bits and a ULID holds 128, so the first character can be 0 to 7 and no more.
  if (first > 7) {
    throw new IdentifierError(
      'A ULID cannot start with a character above 7: the largest ULID is 7ZZZZZZZZZZZZZZZZZZZZZZZZZ.',
    );
  }
  const ms = Number(value >> 80n);
  return {
    ms,
    iso: new Date(ms).toISOString(),
    randomHex: (value & MAX_RANDOM).toString(16).padStart(20, '0'),
  };
}
