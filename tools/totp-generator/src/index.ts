/**
 * One-time codes from a Base32 secret: HOTP (RFC 4226) and TOTP (RFC 6238). The package never reads the clock: the caller
 * passes whole Unix seconds (from its own clock or from `parseTimeInput`).
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment of a
 * secret. Describe the shape of the problem and its position, never the content.
 */
import meta from './meta.json';
import { decodeBase32 } from './base32';
import { TotpError } from './errors';
import { PERIOD_MAX, PERIOD_MIN, SECONDS_MAX, secondsLeft, totpWindow, type OtpAlgorithm, type WindowRow } from './otp';

export { meta };
export { Base32Error, decodeBase32, encodeBase32, secretHints } from './base32';
export { TotpError } from './errors';
export { hotp, secondsLeft, totpStep, totpWindow, COUNTER_MAX, PERIOD_MAX, PERIOD_MIN } from './otp';
export type { OtpAlgorithm, WindowLabel, WindowRow } from './otp';
export { MAX_TIME_CHARS, TimeError, formatUtc, parseTimeInput } from './time';

/** The longest secret text read. Real secrets are 16 to 128 characters; this leaves room for spaces between groups. */
export const MAX_SECRET_CHARS = 1024;

export interface ComputeOptions {
  mode: 'totp';
  /** The secret as Base32 text. */
  secret: string;
  algorithm: OtpAlgorithm;
  digits: number;
  /** Seconds per step. */
  period?: number;
  /** Whole Unix seconds the caller read from its clock or from `parseTimeInput`. */
  seconds?: number;
}

export interface ComputeResult {
  mode: 'totp';
  /** The previous, current, next and following step. */
  window: WindowRow[];
  /** Whole seconds that were left in the current step at `seconds`. */
  secondsLeft?: number;
  /** The size of the secret in bits. */
  secretBits: number;
  /** Things to look at before relying on the codes. */
  warnings: string[];
  /** Plain facts about the settings. */
  notes: string[];
}

function checkWholeNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new TotpError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

/**
 * The window of codes for a secret, or the settings problem as a `TotpError` (or the secret problem as a `Base32Error`).
 * Every field is checked before any is used.
 */
export function computeCodes(options: ComputeOptions): ComputeResult {
  const { mode, secret, algorithm } = options;
  if (mode !== 'totp') throw new TotpError('Mode must be TOTP.');
  if (secret.length > MAX_SECRET_CHARS) {
    throw new TotpError(
      `This secret is ${secret.length} characters. The limit is 1,024 because real secrets are far shorter.`,
    );
  }
  if (algorithm !== 'SHA1' && algorithm !== 'SHA256' && algorithm !== 'SHA512') {
    throw new TotpError('Algorithm must be SHA1, SHA256 or SHA512.');
  }
  const digits = checkWholeNumber(options.digits, 'Digits', 6, 8) as 6 | 7 | 8;
  const bytes = decodeBase32(secret);
  if (bytes.length === 0) {
    throw new TotpError('The secret is empty once spaces, hyphens and padding are taken away. Type a Base32 secret.');
  }
  const secretBits = bytes.length * 8;
  const warnings: string[] = [];
  const notes: string[] = [];
  if (secretBits < 128) {
    warnings.push(`This secret is ${secretBits} bits. RFC 4226 requires at least 128 bits and recommends 160.`);
  }

  const period = checkWholeNumber(options.period, 'Period', PERIOD_MIN, PERIOD_MAX);
  const seconds = checkWholeNumber(options.seconds, 'Time', 0, SECONDS_MAX);
  const window = totpWindow(bytes, { seconds, period, digits, algorithm });
  return { mode, window, secondsLeft: secondsLeft(seconds, period), secretBits, warnings, notes };
}
