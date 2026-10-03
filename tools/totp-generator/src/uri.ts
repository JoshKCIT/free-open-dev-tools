/**
 * The otpauth link an authenticator app reads, written as the Key Uri Format describes it:
 * `otpauth://totp/ISSUER:ACCOUNT?secret=BASE32&issuer=ISSUER` and, for settings that are not the defaults, `algorithm`,
 * `digits`, `counter` (always for HOTP) and `period`. Parts are written in the order pyotp writes them, with every
 * character outside RFC 3986's unreserved set (letters, digits, `-`, `_`, `.` and `~`) written as the percent form of its
 * UTF-8 bytes, so a space is `%20` and never `+`.
 *
 * RULE, stated once and enforced by a test: no message thrown from this file may contain a fragment of a secret or of the
 * link. Describe the shape of the problem, never the content. (The link itself holds the secret by design: it is shown
 * only where the visitor asked for it and is never put in a message, a note or a stat.)
 */
import { encodeBase32 } from './base32';
import { TotpError } from './errors';
import type { OtpAlgorithm } from './otp';

export interface UriOptions {
  type: 'totp' | 'hotp';
  secret: Uint8Array;
  issuer: string;
  account: string;
  algorithm: OtpAlgorithm;
  digits: 6 | 7 | 8;
  /** Seconds per step; written only for TOTP and only when it is not 30. */
  period: number;
  /** The starting counter; written always for HOTP and never for TOTP. */
  counter: number | bigint;
}

/** `encodeURIComponent` leaves `! ' ( ) *` as they are; they are written as percent forms here too. */
function encodePart(text: string): string {
  let encoded: string;
  try {
    encoded = encodeURIComponent(text);
  } catch {
    // Only a lone half of a surrogate pair is refused by the encoder.
    throw new TotpError('The issuer or account name holds a character that cannot be written in a link.');
  }
  return encoded.replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function otpauthUri(options: UriOptions): string {
  const { type, issuer, account, algorithm, digits, period, counter } = options;
  if (account === '') throw new TotpError('An account name is needed to make a link.');
  if (type === 'hotp') {
    const valid =
      typeof counter === 'bigint'
        ? counter >= 0n && counter < 0x10000000000000000n
        : Number.isSafeInteger(counter) && counter >= 0;
    if (!valid) throw new TotpError('Counter must be a whole number from 0 to 9007199254740991.');
  }
  const label = issuer === '' ? encodePart(account) : `${encodePart(issuer)}:${encodePart(account)}`;
  const parts = [`secret=${encodeBase32(options.secret, false)}`];
  if (issuer !== '') parts.push(`issuer=${encodePart(issuer)}`);
  if (type === 'hotp') parts.push(`counter=${String(counter)}`);
  if (algorithm !== 'SHA1') parts.push(`algorithm=${algorithm}`);
  if (digits !== 6) parts.push(`digits=${digits}`);
  if (type === 'totp' && period !== 30) parts.push(`period=${period}`);
  return `otpauth://${type}/${label}?${parts.join('&')}`;
}
