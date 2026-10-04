import { IdentifierError, checkCount } from './id-errors';

/**
 * MongoDB ObjectId: 12 bytes written as 24 hexadecimal digits. A 4-byte time in seconds since 1970, a 5-byte random
 * value drawn once per client process and a 3-byte counter that starts at a random value and counts up, most
 * significant byte first. Reference: https://www.mongodb.com/docs/manual/reference/method/ObjectId/
 */

const MAX_SECONDS = 4294967295;
const TIME_MESSAGE = 'The time is outside what an ObjectId can hold (0 to 2^32 - 1 seconds since 1970).';

export interface DecodedObjectId {
  /** Seconds since 1970-01-01T00:00:00Z. */
  timestamp: number;
  iso: string;
  /** The 5 random bytes as 10 lowercase hexadecimal digits. */
  randomHex: string;
  /** The 3-byte counter as a number from 0 to 16777215. */
  counter: number;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // Always the cryptographic source, and only whole bytes of it.
  globalThis.crypto.getRandomValues(out);
  return out;
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

// Drawn once, the first time an id is made in this page load, as the reference describes for a client process.
let processRandom: Uint8Array | null = null;
let counter = 0;

function startProcess(): Uint8Array {
  if (processRandom === null) {
    processRandom = randomBytes(5);
    const start = randomBytes(3);
    counter = (start[0]! << 16) | (start[1]! << 8) | start[2]!;
  }
  return processRandom;
}

/** Makes `count` ObjectIds for the time `now` (milliseconds; the time kept is whole seconds). */
export function generateObjectIds(count: number, now: number = Date.now()): string[] {
  checkCount(count);
  const seconds = Math.floor(now / 1000);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_SECONDS) throw new IdentifierError(TIME_MESSAGE);
  const random = startProcess();
  const out: string[] = [];
  const bytes = new Uint8Array(12);
  bytes[0] = (seconds >>> 24) & 0xff;
  bytes[1] = (seconds >>> 16) & 0xff;
  bytes[2] = (seconds >>> 8) & 0xff;
  bytes[3] = seconds & 0xff;
  bytes.set(random, 4);
  for (let i = 0; i < count; i++) {
    bytes[9] = (counter >>> 16) & 0xff;
    bytes[10] = (counter >>> 8) & 0xff;
    bytes[11] = counter & 0xff;
    counter = (counter + 1) & 0xffffff;
    out.push(hex(bytes));
  }
  return out;
}

const SHAPE = /^[0-9a-fA-F]{24}$/;

/** Reads an ObjectId (any letter case) into its time, random part and counter. */
export function decodeObjectId(text: string): DecodedObjectId {
  const trimmed = text.trim();
  if (trimmed.length !== 24 || !SHAPE.test(trimmed)) {
    throw new IdentifierError('An ObjectId has exactly 24 hexadecimal digits.');
  }
  const timestamp = parseInt(trimmed.slice(0, 8), 16);
  return {
    timestamp,
    iso: new Date(timestamp * 1000).toISOString(),
    randomHex: trimmed.slice(8, 18).toLowerCase(),
    counter: parseInt(trimmed.slice(18), 16),
  };
}
