/**
 * HOTP (RFC 4226) and TOTP (RFC 6238) over HMAC-SHA-1, HMAC-SHA-256 and HMAC-SHA-512, with the HMAC from the audited
 * @noble/hashes library. Nothing here reads the clock: the caller passes whole Unix seconds, so a result never depends on
 * when it was asked for.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment of a
 * secret. Describe the shape of the problem, never the content.
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { TotpError } from './errors';

export type OtpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export const PERIOD_MIN = 1;
export const PERIOD_MAX = 86400;
/** The largest counter the page accepts: 2^53 - 1, the largest whole number a number field holds exactly. */
export const COUNTER_MAX = 9007199254740991;
/** The largest Unix time read, 9999-12-31T23:59:59Z. */
export const SECONDS_MAX = 253402300799;
/** RFC 4226 section 5.1: the counter is 8 bytes. */
const COUNTER_LIMIT = 0x10000000000000000n;

function hashOf(algorithm: OtpAlgorithm): typeof sha1 {
  switch (algorithm) {
    case 'SHA1':
      return sha1;
    case 'SHA256':
      return sha256 as typeof sha1;
    case 'SHA512':
      return sha512 as typeof sha1;
    default:
      throw new TotpError('Algorithm must be SHA1, SHA256 or SHA512.');
  }
}

/**
 * One HOTP value: HMAC over the 8 byte big-endian counter (RFC 4226 section 5.1), dynamic truncation (section 5.3) and the
 * last `digits` decimal digits with leading zeros kept (section 5.3, step 3).
 */
export function hotp(secret: Uint8Array, counter: bigint, digits: 6 | 7 | 8, algorithm: OtpAlgorithm): string {
  if (counter < 0n || counter >= COUNTER_LIMIT) throw new TotpError('The counter must fit in 8 bytes.');
  if (digits !== 6 && digits !== 7 && digits !== 8) throw new TotpError('Digits must be 6, 7 or 8.');
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, counter);
  const mac = hmac(hashOf(algorithm), secret, message);
  const offset = (mac[mac.length - 1] ?? 0) & 15;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

function checkSeconds(seconds: number): void {
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new TotpError('The time must be whole seconds, 0 or more.');
}

function checkPeriod(period: number): void {
  if (!Number.isSafeInteger(period) || period < PERIOD_MIN || period > PERIOD_MAX) {
    throw new TotpError(`Period must be a whole number from ${PERIOD_MIN} to ${PERIOD_MAX}.`);
  }
}

/** The time step number T of RFC 6238 section 4.2: whole seconds since the epoch (T0 is 0) divided by the period, rounded down. */
export function totpStep(seconds: number, period: number): bigint {
  checkSeconds(seconds);
  checkPeriod(period);
  return BigInt(Math.floor(seconds / period));
}

/** Whole seconds left in the step that `seconds` falls in: second 59 of a 30 second period has 1 left, second 60 has 30. */
export function secondsLeft(seconds: number, period: number): number {
  checkSeconds(seconds);
  checkPeriod(period);
  return period - (seconds % period);
}

export type WindowLabel = 'previous' | 'current' | 'next' | 'after next';

export interface WindowRow {
  label: WindowLabel;
  step: bigint;
  code: string;
  /** The Unix second the step starts at. */
  startSeconds: number;
  /** The last whole Unix second the step covers: the next step starts one second later. */
  endSeconds: number;
}

export interface WindowOptions {
  seconds: number;
  period: number;
  digits: 6 | 7 | 8;
  algorithm: OtpAlgorithm;
}

/**
 * The previous, current, next and following step for the given second; there is no previous row at step 0, and no row for a
 * step that starts after SECONDS_MAX.
 */
export function totpWindow(secret: Uint8Array, options: WindowOptions): WindowRow[] {
  const { seconds, period, digits, algorithm } = options;
  const current = totpStep(seconds, period);
  const labels: [bigint, WindowLabel][] = [
    [-1n, 'previous'],
    [0n, 'current'],
    [1n, 'next'],
    [2n, 'after next'],
  ];
  const rows: WindowRow[] = [];
  for (const [offset, label] of labels) {
    const step = current + offset;
    if (step < 0n) continue;
    const startSeconds = Number(step) * period;
    // A step that starts after the last time this package reads (9999-12-31) has no date to print, so it is left out; the last
    // step that does start inside the range is cut at that last second.
    if (startSeconds > SECONDS_MAX) continue;
    rows.push({
      label,
      step,
      code: hotp(secret, step, digits, algorithm),
      startSeconds,
      endSeconds: Math.min(startSeconds + period - 1, SECONDS_MAX),
    });
  }
  return rows;
}
