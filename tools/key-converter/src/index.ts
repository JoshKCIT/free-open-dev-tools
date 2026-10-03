/**
 * Key Pair Generator & Converter: makes RSA, ECDSA and Ed25519 key pairs in the browser and writes each in the formats
 * other software asks for. The key model, the DER writers and the OpenSSH blob are this package's own; the browser's
 * Web Crypto generator supplies every secret byte, and @noble/hashes supplies the fingerprint digests.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */
import meta from './meta.json';
import { DerError, derHex } from './der';
import { MAX_PASTE_CHARS, readKeyInput } from './detect';
import { sshFingerprints } from './fingerprint';
import { readPkcs8, readSpki, writePkcs8, writeSpki } from './formats';
import { generateEc, generateEd25519, generateRsa } from './generate';
import {
  COMMENT_LIMIT,
  KeyConverterError,
  RSA_GENERATE_BITS,
  bytesEqual,
  checkComment,
  isPrivate,
  keyBits,
  keyWarnings,
  type Curve,
  type EcKey,
  type Ed25519Key,
  type KeyModel,
  type RsaKey,
} from './model';
import { sshPublicBlob, sshPublicLine } from './openssh';
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

function exponentText(key: RsaKey): string {
  return BigInt('0x' + (derHex(key.e) || '0')).toString();
}

/** The short facts about a key that are not a secret: what it is and how large. */
function keyFacts(key: KeyModel): [string, string][] {
  switch (key.type) {
    case 'rsa':
      return [
        ['Key type', 'RSA'],
        ['Size in bits', String(keyBits(key))],
        ['Public exponent', exponentText(key)],
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
  const blocks: KeyOutputBlock[] = [];
  if (isPrivate(key)) {
    blocks.push({
      id: 'pkcs8',
      label: 'Private key, PKCS#8 (PEM)',
      text: bytesToPem('PRIVATE KEY', writePkcs8(key)),
      private: true,
    });
  }
  blocks.push({
    id: 'spki',
    label: 'Public key, SubjectPublicKeyInfo (PEM)',
    text: bytesToPem('PUBLIC KEY', writeSpki(key)),
    private: false,
  });
  blocks.push({
    id: 'ssh-public',
    label: 'OpenSSH public key',
    text: sshPublicLine(key, options.comment),
    private: false,
  });
  const prints = sshFingerprints(sshPublicBlob(key));
  return {
    blocks,
    fingerprints: [
      ['SHA256', prints.sha256],
      ['MD5', prints.md5],
    ],
    facts: keyFacts(key),
    warnings: keyWarnings(key),
  };
}
