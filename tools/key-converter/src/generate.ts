/**
 * Key generation. Every key is made from the browser's own cryptographic generator and from nothing else: RSA and
 * ECDSA by Web Crypto `generateKey`, which draws on the engine's secure random source, and Ed25519 from 32 bytes of
 * `crypto.getRandomValues` (the pinned WebKit has no Ed25519 in Web Crypto, so @noble/curves does the arithmetic for
 * every browser, with the seed always supplied here). No other source of randomness is used anywhere in this package.
 *
 * `crypto.subtle` exists only in a secure context in a browser (https, or localhost); the check is made once at the
 * top of each generator so a missing interface is reported plainly instead of as an undefined property.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { readPkcs8, readSpki } from './formats';
import {
  CURVES,
  KeyConverterError,
  RSA_GENERATE_BITS,
  bytesEqual,
  type Curve,
  type EcKey,
  type Ed25519Key,
  type RsaBits,
} from './model';

/** `count` bytes from the browser's cryptographic generator, which is the only source of randomness in this package. */
export function browserRandom(count: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(count));
}

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

/**
 * Makes an Ed25519 key from 32 bytes of `crypto.getRandomValues`. The seed is the private key of RFC 8032 and the
 * public key is computed from it by @noble/curves; the library is never asked to make randomness of its own.
 */
export function generateEd25519(): Ed25519Key {
  requireSecureContext();
  const seed = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return { type: 'ed25519', pub: Uint8Array.from(ed25519.getPublicKey(seed)), seed };
}

/**
 * Makes an ECDSA key pair with Web Crypto on P-256, P-384 or P-521. Only `generateKey` and `exportKey` are used (never
 * `importKey`, which Firefox refuses for an EC private key that has no public part). The private key is read from the
 * engine's PKCS#8 export, where its public point is recomputed with @noble/curves; the engine's own public key is read
 * as well, and a key whose two public parts differ is refused.
 */
export async function generateEc(curve: Curve): Promise<EcKey> {
  requireSecureContext();
  if (!CURVES.has(curve)) {
    throw new KeyConverterError('Elliptic curve keys are offered on P-256, P-384 and P-521 only.');
  }
  const pair = (await globalThis.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const spki = new Uint8Array(await globalThis.crypto.subtle.exportKey('spki', pair.publicKey));
  const key = readPkcs8(pkcs8);
  const published = readSpki(spki);
  if (key.type !== 'ec' || published.type !== 'ec' || key.curve !== curve || !bytesEqual(key.point, published.point)) {
    throw new KeyConverterError('The public key does not belong to this private key.');
  }
  return key;
}
