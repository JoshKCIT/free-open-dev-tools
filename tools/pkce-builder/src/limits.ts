import { PkceBuilderError, type PkceBuilderPart } from './errors';

/** The most characters in an address (the endpoint, the redirect address) and in any other single field. */
export const MAX_URL_CHARACTERS = 16_384;
/** The most characters in a pasted redirect. */
export const MAX_PASTE_CHARACTERS = 65_536;
/** The most characters in a scope. */
export const MAX_SCOPE_CHARACTERS = 2_048;
/** The most parameters in a built request (an existing query counts) or in a pasted redirect. */
export const MAX_PARAMETERS = 200;
/** Random bytes behind a made verifier: 32 bytes are written as 43 characters (RFC 7636 section 4.1). */
export const DEFAULT_VERIFIER_BYTES = 32;
/** Random bytes behind a made state or nonce: 16 bytes are 128 bits. */
export const DEFAULT_STATE_BYTES = 16;
/** The fewest characters in a code verifier (RFC 7636 section 4.1). */
export const MIN_VERIFIER_CHARACTERS = 43;
/** The most characters in a code verifier (RFC 7636 section 4.1). */
export const MAX_VERIFIER_CHARACTERS = 128;
/** The most random characters or bytes one call may ask for. */
export const MAX_RANDOM_COUNT = 1_024;

/** A whole number with a comma between thousands, the same in every locale. */
export function withCommas(value: number): string {
  const digits = String(value);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/** Refuses a text that is too long, before any work. The message names the part and the limit, never the text. */
export function checkLength(text: string, limit: number, part: PkceBuilderPart, label: string): void {
  if (text.length > limit) {
    throw new PkceBuilderError(
      `The ${label} is ${withCommas(text.length)} characters. The limit is ${withCommas(limit)}.`,
      part,
    );
  }
}
