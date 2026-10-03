/**
 * Key Pair Generator & Converter: makes RSA, ECDSA and Ed25519 key pairs in the browser and writes each in the formats
 * other software asks for. The key model, the DER writers and the OpenSSH blob are this package's own; the browser's
 * Web Crypto generator supplies every secret byte, and @noble/hashes supplies the fingerprint digests.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */
import meta from './meta.json';
import { DerError } from './der';
import { MAX_PASTE_CHARS, readKeyInput } from './detect';
import { sshFingerprints } from './fingerprint';
import { readPkcs8, readSpki, writePkcs1Private, writePkcs1Public, writePkcs8, writeSec1, writeSpki } from './formats';
import { generateEc, generateEd25519, generateRsa } from './generate';
import {
  COMMENT_LIMIT,
  KeyConverterError,
  RSA_GENERATE_BITS,
  bytesEqual,
  checkComment,
  isPrivate,
  keyBits,
  exponentText,
  keyWarnings,
  type Curve,
  type EcKey,
  type Ed25519Key,
  type KeyModel,
  type RsaKey,
} from './model';
import { jwkThumbprint, writeJwk } from './jwk';
import { rfc4716, sshPrivate, sshPublicBlob, sshPublicLine } from './openssh';
import { PemError, bytesToPem } from './pem';

export {
  meta,
  KeyConverterError,
  DerError,
  PemError,
  RSA_GENERATE_BITS,
  COMMENT_LIMIT,
  checkComment,
  generateEc,
  generateEd25519,
  generateRsa,
  readKeyInput,
  MAX_PASTE_CHARS,
};
export type { Curve, EcKey, Ed25519Key, KeyModel, RsaKey };

/** The kinds of key the page offers, in the order of its menu. */
export const KEY_TYPES = [
  { id: 'rsa-2048', label: 'RSA 2048 bits' },
  { id: 'rsa-3072', label: 'RSA 3072 bits' },
  { id: 'rsa-4096', label: 'RSA 4096 bits' },
  { id: 'ecdsa-p256', label: 'ECDSA P-256' },
  { id: 'ecdsa-p384', label: 'ECDSA P-384' },
  { id: 'ecdsa-p521', label: 'ECDSA P-521' },
  { id: 'ed25519', label: 'Ed25519' },
] as const;

export type KeyTypeId = (typeof KEY_TYPES)[number]['id'];

/**
 * Reads the PKCS#8 and SubjectPublicKeyInfo bytes of a generated RSA key into the key model and checks that they belong
 * together: the public modulus and exponent must be the ones inside the private key.
 */
export function keyFromGeneratedRsa(pkcs8: Uint8Array, spki: Uint8Array): RsaKey {
  const privateKey = readPkcs8(pkcs8);
  const publicKey = readSpki(spki);
  if (privateKey.type !== 'rsa' || publicKey.type !== 'rsa') {
    throw new KeyConverterError('This is not an RSA key.');
  }
  if (!bytesEqual(privateKey.n, publicKey.n) || !bytesEqual(privateKey.e, publicKey.e)) {
    throw new KeyConverterError('The public key does not belong to this private key.');
  }
  return privateKey;
}

export interface KeyOutputBlock {
  id: string;
  label: string;
  text: string;
  /** Whether the text is secret material, so the page can say so beside it. */
  private: boolean;
  language?: string;
}

export interface KeyOutputs {
  blocks: KeyOutputBlock[];
  /** Pairs of a short name and the fingerprint text. */
  fingerprints: [string, string][];
  facts: [string, string][];
  warnings: string[];
}

/** The short facts about a key that are not a secret: what it is and how large. */
function keyFacts(key: KeyModel): [string, string][] {
  switch (key.type) {
    case 'rsa':
      return [
        ['Key type', 'RSA'],
        ['Size in bits', String(keyBits(key))],
        ['Public exponent', exponentText(key.e)],
      ];
    case 'ec':
      return [
        ['Key type', 'ECDSA'],
        ['Curve', key.curve],
        ['Size in bits', String(keyBits(key))],
      ];
    case 'ed25519':
      return [
        ['Key type', 'Ed25519'],
        ['Size in bits', String(keyBits(key))],
      ];
  }
}

/** Every output of a key: the PEM blocks, the OpenSSH line, the fingerprints and the facts, all written from the model. */
export function keyOutputs(key: KeyModel, options: { comment: string }): KeyOutputs {
  checkComment(options.comment);
  const priv = isPrivate(key);
  const blocks: KeyOutputBlock[] = [];
  const add = (id: string, label: string, text: string, secret: boolean, language?: string): void => {
    blocks.push(
      language === undefined ? { id, label, text, private: secret } : { id, label, text, private: secret, language },
    );
  };
  // The order is the order of the page: the PKCS#8 and SubjectPublicKeyInfo pair first, then the type-specific PEM forms,
  // then JWK, then the OpenSSH forms and RFC 4716.
  if (priv) add('pkcs8', 'Private key, PKCS#8 (PEM)', bytesToPem('PRIVATE KEY', writePkcs8(key)), true);
  add('spki', 'Public key, SubjectPublicKeyInfo (PEM)', bytesToPem('PUBLIC KEY', writeSpki(key)), false);
  if (key.type === 'rsa') {
    if (priv)
      add(
        'pkcs1-private',
        'RSA private key, PKCS#1 (PEM)',
        bytesToPem('RSA PRIVATE KEY', writePkcs1Private(key)),
        true,
      );
    add('pkcs1-public', 'RSA public key, PKCS#1 (PEM)', bytesToPem('RSA PUBLIC KEY', writePkcs1Public(key)), false);
  }
  if (key.type === 'ec' && priv)
    add('sec1', 'EC private key, SEC1 (PEM)', bytesToPem('EC PRIVATE KEY', writeSec1(key)), true);
  if (priv) add('jwk-private', 'Private key, JWK', writeJwk(key, { private: true }), true, 'json');
  add('jwk-public', 'Public key, JWK', writeJwk(key, { private: false }), false, 'json');
  if (priv) add('ssh-private', 'OpenSSH private key (no passphrase)', sshPrivate(key, options.comment), true);
  add('ssh-public', 'OpenSSH public key', sshPublicLine(key, options.comment), false);
  add('rfc4716', 'Public key, RFC 4716', rfc4716(key, options.comment), false);
  const prints = sshFingerprints(sshPublicBlob(key));
  return {
    blocks,
    fingerprints: [
      ['SHA256', prints.sha256],
      ['MD5', prints.md5],
      ['JWK thumbprint', jwkThumbprint(key)],
    ],
    facts: keyFacts(key),
    warnings: keyWarnings(key),
  };
}
