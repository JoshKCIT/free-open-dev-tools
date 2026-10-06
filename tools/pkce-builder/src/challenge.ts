import { PkceBuilderError } from './errors';
import { base64UrlEncode } from './random';
import { requireVerifier } from './verifier';

/** The warning that goes with the plain method (RFC 7636 section 4.2, RFC 9700 section 2.1.1). */
export const PLAIN_WARNING =
  'The plain method sends the verifier itself as the challenge, so anyone who can read the authorization request can read the verifier and the protection is gone. RFC 7636 section 4.2 allows plain only when S256 cannot be supported, and RFC 9700 section 2.1.1 says clients should use a method that does not expose the verifier: S256 is the only such method.';

/**
 * The S256 code challenge (RFC 7636 section 4.2): the base64url, without padding, of the SHA-256 of the ASCII verifier,
 * made with the browser's Web Crypto digest. A verifier that breaks a rule of section 4.1 is refused first.
 */
export async function s256Challenge(verifier: string): Promise<string> {
  requireVerifier(verifier);
  if (typeof crypto === 'undefined' || typeof crypto.subtle === 'undefined') {
    throw new PkceBuilderError('This browser has no SHA-256 digest available on this page.', 'verifier');
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return base64UrlEncode(digest);
}

/** The plain method: the challenge is the verifier. Always carries the warning. */
export function plainChallenge(verifier: string): { challenge: string; warning: string } {
  requireVerifier(verifier);
  return { challenge: verifier, warning: PLAIN_WARNING };
}
