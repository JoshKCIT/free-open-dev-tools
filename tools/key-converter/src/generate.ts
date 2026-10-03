/**
 * Key generation. Every key is made from the browser's own cryptographic generator and from nothing else: RSA by Web
 * Crypto `generateKey`, which picks the primes with the engine's secure random source. No other source of randomness is
 * used anywhere in this package.
 *
 * `crypto.subtle` exists only in a secure context in a browser (https, or localhost); the check is made once at the
 * top of each generator so a missing interface is reported plainly instead of as an undefined property.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */
import { KeyConverterError, RSA_GENERATE_BITS, type RsaBits } from './model';

/** Throws a plain message when the browser cryptography interface is not available. */
export function requireSecureContext(): void {
  const g = globalThis as { crypto?: Crypto };
  if (typeof g.crypto === 'undefined' || typeof g.crypto.subtle === 'undefined') {
    throw new KeyConverterError(
      'The browser cryptography interface (crypto.subtle) is not available here. It requires a secure context: https, or localhost. Load this page over https to use it.',
    );
  }
}

/**
 * Makes an RSA key pair of exactly 2048, 3072 or 4096 bits with public exponent 65537 and returns its PKCS#8 and
 * SubjectPublicKeyInfo bytes. The engine's own export is only carried here: the page reads both and writes every output
 * from the package's own key model.
 */
export async function generateRsa(bits: RsaBits): Promise<{ pkcs8: Uint8Array; spki: Uint8Array }> {
  requireSecureContext();
  if (!RSA_GENERATE_BITS.includes(bits)) {
    throw new KeyConverterError('RSA keys are offered at 2048, 3072 and 4096 bits only.');
  }
  const pair = (await globalThis.crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: bits, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const spki = new Uint8Array(await globalThis.crypto.subtle.exportKey('spki', pair.publicKey));
  return { pkcs8, spki };
}
