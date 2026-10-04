import { IdentifierError, checkCount } from './id-errors';

/**
 * KSUID: 20 bytes, a 4-byte big-endian time in seconds since 2014-05-13T16:53:20Z followed by 16 random bytes, written
 * as 27 characters of base62 (0-9, A-Z, a-z in that order, so the text sorts by time).
 * Reference implementation: https://github.com/segmentio/ksuid
 */

/** 1400000000, the KSUID epoch (2014-05-13T16:53:20Z). */
export const KSUID_EPOCH_SECONDS = 1_400_000_000;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const MAX_VALUE = (1n << 160n) - 1n;
const MAX_TIMESTAMP = 4294967295;

export interface DecodedKsuid {
  /** The stored time: seconds since the KSUID epoch. */
  timestamp: number;
  iso: string;
  /** The 16 random bytes as 32 uppercase hexadecimal digits. */
  payloadHex: string;
}

const TIME_MESSAGE = 'The time is outside what a KSUID can hold (2014-05-13T16:53:20Z plus up to 2^32 - 1 seconds).';

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // Always the cryptographic source, and only whole bytes of it.
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** The 27 character text of 20 raw bytes. */
export function encodeKsuid(raw: Uint8Array): string {
  if (raw.length !== 20) throw new IdentifierError('A KSUID is made from exactly 20 bytes.');
  let value = 0n;
  for (const byte of raw) value = (value << 8n) | BigInt(byte);
  const chars = new Array<string>(27);
  for (let i = 26; i >= 0; i--) {
    chars[i] = BASE62.charAt(Number(value % 62n));
    value /= 62n;
  }
  return chars.join('');
}

/** Makes `count` KSUIDs for the time `now` (milliseconds; the time kept is whole seconds). */
export function generateKsuids(count: number, now: number = Date.now()): string[] {
  checkCount(count);
  const timestamp = Math.floor(now / 1000) - KSUID_EPOCH_SECONDS;
  if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp > MAX_TIMESTAMP) {
    throw new IdentifierError(TIME_MESSAGE);
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = new Uint8Array(20);
    raw[0] = (timestamp >>> 24) & 0xff;
    raw[1] = (timestamp >>> 16) & 0xff;
    raw[2] = (timestamp >>> 8) & 0xff;
    raw[3] = timestamp & 0xff;
    raw.set(randomBytes(16), 4);
    out.push(encodeKsuid(raw));
  }
  return out;
}

// Value of each ASCII character of the base62 alphabet; -1 for everything else. Letter case matters in base62.
const VALUES = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE62.length; i++) VALUES[BASE62.charCodeAt(i)] = i;

/** Reads a KSUID into its stored time and random payload. */
export function decodeKsuid(text: string): DecodedKsuid {
  const trimmed = text.trim();
  if (trimmed.length !== 27) throw new IdentifierError('A KSUID has exactly 27 characters.');
  let value = 0n;
  for (let i = 0; i < 27; i++) {
    const code = trimmed.charCodeAt(i);
    const digit = code < 128 ? VALUES[code]! : -1;
    if (digit < 0) throw new IdentifierError('A KSUID uses only the characters 0 to 9, A to Z and a to z.');
    value = value * 62n + BigInt(digit);
  }
  // 27 base62 characters can hold more than 160 bits; the reference implementation refuses anything past aWgEPTl1tmebfsQzFP4bxwgy80V.
  if (value > MAX_VALUE) throw new IdentifierError('A KSUID cannot be larger than aWgEPTl1tmebfsQzFP4bxwgy80V.');
  const timestamp = Number(value >> 128n);
  return {
    timestamp,
    iso: new Date((KSUID_EPOCH_SECONDS + timestamp) * 1000).toISOString(),
    payloadHex: (value & ((1n << 128n) - 1n)).toString(16).toUpperCase().padStart(32, '0'),
  };
}
