/**
 * One reader for every key a visitor can paste: PEM blocks (PKCS#8, SubjectPublicKeyInfo, PKCS#1, SEC1, OpenSSH private),
 * a JWK or the first key of a JWK set, an OpenSSH public key line, and an RFC 4716 public key file. The size of the paste
 * is checked before anything is parsed. Keys that are protected by a passphrase, certificates, restricted RSA-PSS keys,
 * unsupported curves and a public part that does not belong to its private part are each refused with a plain sentence
 * that names the problem and never repeats any of the pasted text.
 *
 * Every lookup of a label or a type is a Map, so a typed name such as constructor or __proto__ finds nothing.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */
import { DerError } from './der';
import { DOES_NOT_BELONG, readPkcs1Private, readPkcs1Public, readPkcs8, readSec1, readSpki } from './formats';
import { readJwk } from './jwk';
import { KeyConverterError, checkComment, isPrivate, keyWarnings, bytesEqual, type KeyModel } from './model';
import { readRfc4716, readSshPrivateBody, readSshPublicLine, sshPublicBlob } from './openssh';
import { PemError, pemBlocks, type PemBlock } from './pem';

/** The most characters a paste may hold. Larger pastes are not keys, and the limit bounds every later calculation. */
export const MAX_PASTE_CHARS = 65536;

const PASSPHRASE_SENTENCE =
  'This key is protected by a passphrase. This page does not decrypt keys. Remove the passphrase on your own machine first (for example openssl pkey -in key.pem -out plain.pem), then paste the unprotected key.';
const CERTIFICATE_SENTENCE = 'This is a certificate, not a key. Its public key can be read with a certificate decoder.';
const UNKNOWN_BLOCK =
  'This block is not a key this page reads. It reads PRIVATE KEY, PUBLIC KEY, RSA PRIVATE KEY, RSA PUBLIC KEY, EC PRIVATE KEY and OPENSSH PRIVATE KEY blocks.';
const UNKNOWN_TEXT =
  'This is not a key in a form this page reads. It reads PEM blocks (PKCS#8, SubjectPublicKeyInfo, PKCS#1, SEC1 and OpenSSH private keys), JWKs, OpenSSH public key lines and RFC 4716 public key files.';
const COULD_NOT_READ = 'This key could not be read. Check that it is whole and in one of the forms listed above.';

export interface KeyInput {
  key: KeyModel;
  /** What the paste was, for example "PKCS#8 private key". */
  source: string;
  /** A comment found in the paste, when it can be used on an OpenSSH line. */
  comment?: string;
  warnings: string[];
}

/** A number with comma separators, for the size sentence. */
function withCommas(value: number): string {
  const digits = String(value);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return out;
}

interface Found {
  key: KeyModel;
  source: string;
  comment?: string;
  /** Something worth telling the visitor about how the paste was read, for example that a set was cut to its first key. */
  note?: string;
}

type BlockReader = (block: PemBlock) => Found;

const BLOCK_READERS = new Map<string, BlockReader>([
  ['PRIVATE KEY', (block) => ({ key: readPkcs8(block.body), source: 'PKCS#8 private key' })],
  ['PUBLIC KEY', (block) => ({ key: readSpki(block.body), source: 'SubjectPublicKeyInfo public key' })],
  ['RSA PRIVATE KEY', (block) => ({ key: readPkcs1Private(block.body), source: 'PKCS#1 RSA private key' })],
  ['RSA PUBLIC KEY', (block) => ({ key: readPkcs1Public(block.body), source: 'PKCS#1 RSA public key' })],
  ['EC PRIVATE KEY', (block) => ({ key: readSec1(block.body), source: 'SEC1 EC private key' })],
  [
    'OPENSSH PRIVATE KEY',
    (block) => {
      const read = readSshPrivateBody(block.body);
      return { key: read.key, source: 'OpenSSH private key', comment: read.comment };
    },
  ],
]);

const CERTIFICATE_LABELS = new Set(['CERTIFICATE', 'TRUSTED CERTIFICATE', 'X509 CERTIFICATE']);

/** Whether a header line of a legacy PEM block says the body is encrypted (RFC 1421 Proc-Type). */
function isEncryptedHeader(header: string): boolean {
  return header.toUpperCase().includes('ENCRYPTED');
}

function readPem(text: string): Found {
  const blocks = pemBlocks(text, 16);
  const found: Found[] = [];
  for (const block of blocks) {
    if (block.headers.some(isEncryptedHeader) || block.label === 'ENCRYPTED PRIVATE KEY') {
      throw new KeyConverterError(PASSPHRASE_SENTENCE);
    }
    if (CERTIFICATE_LABELS.has(block.label)) throw new KeyConverterError(CERTIFICATE_SENTENCE);
    // openssl ecparam writes the curve as a block of its own in front of the key; the key names its curve anyway.
    if (block.label === 'EC PARAMETERS') continue;
    const reader = BLOCK_READERS.get(block.label);
    if (reader === undefined) throw new KeyConverterError(UNKNOWN_BLOCK);
    found.push(reader(block));
  }
  if (found.length === 0) throw new KeyConverterError(UNKNOWN_TEXT);
  const privateKeys = found.filter((item) => isPrivate(item.key));
  const publicKeys = found.filter((item) => !isPrivate(item.key));
  if (found.length > 2 || privateKeys.length > 1 || publicKeys.length > 1) {
    throw new KeyConverterError(
      'This paste holds more than one key. Paste one key, or one private key with its own public key.',
    );
  }
  const first = found[0]!;
  const second = found[1];
  if (second === undefined) return first;
  // A private key pasted with a public key: the public key must be the one the private key gives.
  if (!bytesEqual(sshPublicBlob(first.key), sshPublicBlob(second.key))) throw new KeyConverterError(DOES_NOT_BELONG);
  return privateKeys[0]!;
}

function readOne(text: string): Found {
  const trimmed = text.trim();
  if (trimmed === '') throw new KeyConverterError('Paste a key first.');
  if (trimmed.startsWith('{')) {
    const read = readJwk(trimmed);
    return read.note === undefined
      ? { key: read.key, source: 'JWK' }
      : { key: read.key, source: 'JWK set (first key)', note: read.note };
  }
  if (trimmed.startsWith('[')) throw new KeyConverterError('A JWK is a JSON object, or a set {"keys": [...]} of them.');
  if (trimmed.startsWith('---- BEGIN SSH2 PUBLIC KEY ----')) {
    const read = readRfc4716(trimmed);
    return { key: read.key, source: 'RFC 4716 public key', comment: read.comment };
  }
  if (text.includes('-----BEGIN ')) return readPem(text);
  if (trimmed.startsWith('ssh-') || trimmed.startsWith('ecdsa-sha2-')) {
    if (trimmed.includes('\n')) {
      const lines = trimmed.split('\n').filter((line) => line.trim() !== '');
      if (lines.length > 1)
        throw new KeyConverterError('This paste holds more than one OpenSSH public key line. Paste one key at a time.');
    }
    const read = readSshPublicLine(trimmed);
    return { key: read.key, source: 'OpenSSH public key line', comment: read.comment };
  }
  throw new KeyConverterError(UNKNOWN_TEXT);
}

/** Maps every error a reader can throw to a KeyConverterError, so nothing but a plain sentence reaches the visitor. */
function asConverterError(err: unknown): KeyConverterError {
  if (err instanceof KeyConverterError) return err;
  if (err instanceof PemError) return new KeyConverterError(err.message, err.position);
  if (err instanceof DerError) return new KeyConverterError(err.message);
  return new KeyConverterError(COULD_NOT_READ);
}

/**
 * Reads a pasted key in any supported form. Throws a KeyConverterError for everything it cannot read, with a plain
 * sentence and, when the problem has a position in the text, that position.
 */
export function readKeyInput(text: string): KeyInput {
  if (text.length > MAX_PASTE_CHARS) {
    throw new KeyConverterError(
      `This paste is ${withCommas(text.length)} characters. The limit is ${withCommas(MAX_PASTE_CHARS)} because larger pastes are not keys.`,
    );
  }
  let found: Found;
  try {
    found = readOne(text);
  } catch (err) {
    throw asConverterError(err);
  }
  const warnings: string[] = [];
  if (found.note !== undefined) warnings.push(found.note);
  let comment: string | undefined;
  if (found.comment !== undefined && found.comment !== '') {
    try {
      checkComment(found.comment);
      comment = found.comment;
    } catch {
      warnings.push(
        'The comment in the pasted key was not used, because it is longer than 256 characters or holds a line break.',
      );
    }
  }
  warnings.push(...keyWarnings(found.key));
  return comment === undefined
    ? { key: found.key, source: found.source, warnings }
    : { key: found.key, source: found.source, comment, warnings };
}
