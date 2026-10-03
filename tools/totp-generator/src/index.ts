/**
 * One-time codes from a Base32 secret: HOTP (RFC 4226) and TOTP (RFC 6238), the otpauth link and the QR code for it. The
 * package never reads the clock: the caller passes whole Unix seconds (from its own clock or from `parseTimeInput`).
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment of a
 * secret. Describe the shape of the problem and its position, never the content.
 */
import meta from './meta.json';
import { decodeBase32 } from './base32';
import { TotpError } from './errors';
import {
  COUNTER_MAX,
  PERIOD_MAX,
  PERIOD_MIN,
  SECONDS_MAX,
  hotp,
  secondsLeft,
  totpWindow,
  type OtpAlgorithm,
  type WindowRow,
} from './otp';
import { otpauthUri } from './uri';

export { meta };
export { Base32Error, decodeBase32, encodeBase32, secretHints } from './base32';
export { TotpError } from './errors';
export { hotp, secondsLeft, totpStep, totpWindow, COUNTER_MAX, PERIOD_MAX, PERIOD_MIN } from './otp';
export type { OtpAlgorithm, WindowLabel, WindowRow } from './otp';
export { MAX_TIME_CHARS, TimeError, formatUtc, parseTimeInput } from './time';
export { otpauthUri, type UriOptions } from './uri';
export { qrSvg } from './qr';
export { countdownHtml } from './countdown';

/** The longest secret text read. Real secrets are 16 to 128 characters; this leaves room for spaces between groups. */
export const MAX_SECRET_CHARS = 1024;
/** The longest issuer or account name, so the link always fits in a QR code. */
export const MAX_LABEL_CHARS = 256;
/** How many counters HOTP mode lists, starting at the one asked for. */
const COUNTER_ROWS = 5;

const SEVEN_DIGITS_NOTE = 'Many authenticator apps do not accept 7-digit codes.';
const OTHER_SETTINGS_NOTE =
  'SHA-1, 6 digits and a 30-second period work in every authenticator app. Other settings are written into the link, but some apps ignore them and show wrong codes; check against the codes shown here before relying on it.';

export interface ComputeOptions {
  mode: 'totp' | 'hotp';
  /** The secret as Base32 text. */
  secret: string;
  algorithm: OtpAlgorithm;
  digits: number;
  /** Seconds per step. Read only in TOTP mode. */
  period?: number;
  /** Whole Unix seconds the caller read from its clock or from `parseTimeInput`. Read only in TOTP mode. */
  seconds?: number;
  /** The first counter listed. Read only in HOTP mode. */
  counter?: number;
  /** The name of the service, written into the link when an account name is given. */
  issuer?: string;
  /** The account name; the link is made only when this is not empty. */
  account?: string;
}

export interface CounterRow {
  counter: bigint;
  code: string;
}

export interface ComputeResult {
  mode: 'totp' | 'hotp';
  /** The previous, current, next and following step (TOTP mode; empty in HOTP mode). */
  window: WindowRow[];
  /** The code for the counter asked for and the four after it (HOTP mode; empty in TOTP mode). */
  counters: CounterRow[];
  /** Whole seconds that were left in the current step at `seconds` (TOTP mode). */
  secondsLeft?: number;
  /** The size of the secret in bits. */
  secretBits: number;
  /** Things to look at before relying on the codes. */
  warnings: string[];
  /** Plain facts about the settings. */
  notes: string[];
  /** The otpauth link, made only when an account name was given. It holds the secret. */
  uri?: string;
}

function checkWholeNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new TotpError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function checkLabel(text: string | undefined, label: string): string {
  const trimmed = (text ?? '').trim();
  if (trimmed.length > MAX_LABEL_CHARS) {
    throw new TotpError(
      `${label} is ${trimmed.length} characters. The limit is ${MAX_LABEL_CHARS} because the link has to fit in a QR code.`,
    );
  }
  return trimmed;
}

/**
 * The codes for a secret, or the settings problem as a `TotpError` (or the secret problem as a `Base32Error`). Every field
 * of the chosen mode is checked before any is used, and the fields of the other mode are not read.
 */
export function computeCodes(options: ComputeOptions): ComputeResult {
  const { mode, secret, algorithm } = options;
  if (mode !== 'totp' && mode !== 'hotp') throw new TotpError('Mode must be TOTP or HOTP.');
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

  let period = 30;
  let seconds = 0;
  let counter = 0;
  if (mode === 'totp') {
    period = checkWholeNumber(options.period, 'Period', PERIOD_MIN, PERIOD_MAX);
    seconds = checkWholeNumber(options.seconds, 'Time', 0, SECONDS_MAX);
  } else {
    counter = checkWholeNumber(options.counter, 'Counter', 0, COUNTER_MAX);
  }
  const issuer = checkLabel(options.issuer, 'Issuer');
  const account = checkLabel(options.account, 'Account');

  if (digits === 7) notes.push(SEVEN_DIGITS_NOTE);
  if (algorithm !== 'SHA1' || digits !== 6 || (mode === 'totp' && period !== 30)) notes.push(OTHER_SETTINGS_NOTE);

  const result: ComputeResult = { mode, window: [], counters: [], secretBits, warnings, notes };
  if (mode === 'totp') {
    result.window = totpWindow(bytes, { seconds, period, digits, algorithm });
    result.secondsLeft = secondsLeft(seconds, period);
  } else {
    for (let i = 0; i < COUNTER_ROWS; i++) {
      const at = BigInt(counter) + BigInt(i);
      result.counters.push({ counter: at, code: hotp(bytes, at, digits, algorithm) });
    }
  }
  if (account !== '') {
    result.uri = otpauthUri({
      type: mode,
      secret: bytes,
      issuer,
      account,
      algorithm,
      digits,
      period,
      counter: BigInt(counter),
    });
  }
  return result;
}
