/**
 * The one error type of this package for a problem with the settings the caller gave (a period out of range, a counter
 * too large, a secret that is too long or empty).
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from the files of this package may ever contain
 * a fragment of a secret, an otpauth link or any text that was typed as one. Describe the shape of the problem and its
 * position, never the content.
 */
export class TotpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TotpError';
  }
}
