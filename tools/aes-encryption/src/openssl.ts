/**
 * OpenSSL `enc`-compatible passphrase encryption: PBKDF2 and legacy
 * EVP_BytesToKey key+IV derivation, the `Salted__` framing OpenSSL's `enc`
 * subcommand uses, and a decrypt-command builder that never takes a
 * passphrase parameter (S3 -- a structural guarantee, not a convention).
 *
 * PBKDF2 goes through `crypto.subtle`; AES-CBC/CTR encryption and
 * decryption also go through `crypto.subtle`. `@noble/hashes` is used only
 * for the legacy EVP_BytesToKey derivation's MD5 and SHA-256 rounds, which
 * `crypto.subtle` has no primitive for.
 */
import { md5 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { AesError, requireSubtle, parseBase64, toBase64, toHex } from './codec';

export type OpensslCipherId = 'aes-256-cbc' | 'aes-128-cbc' | 'aes-256-ctr' | 'aes-128-ctr';
export type OpensslKdfId = 'pbkdf2' | 'evp-sha256' | 'evp-md5';

export interface OpensslCipherInfo {
  id: OpensslCipherId;
  label: string;
  keyBytes: 16 | 32;
  mode: 'cbc' | 'ctr';
}

/** aes-256-cbc first: the default. */
export const OPENSSL_CIPHERS: OpensslCipherInfo[] = [
  { id: 'aes-256-cbc', label: 'AES-256-CBC', keyBytes: 32, mode: 'cbc' },
  { id: 'aes-128-cbc', label: 'AES-128-CBC', keyBytes: 16, mode: 'cbc' },
  { id: 'aes-256-ctr', label: 'AES-256-CTR', keyBytes: 32, mode: 'ctr' },
  { id: 'aes-128-ctr', label: 'AES-128-CTR', keyBytes: 16, mode: 'ctr' },
];

export interface OpensslKdfInfo {
  id: OpensslKdfId;
  label: string;
  legacy: boolean;
}

/** pbkdf2 first: the default and the only non-legacy option. */
export const KDFS: OpensslKdfInfo[] = [
  { id: 'pbkdf2', label: 'PBKDF2-HMAC-SHA256 (openssl enc -pbkdf2)', legacy: false },
  { id: 'evp-sha256', label: 'EVP_BytesToKey, SHA-256 (openssl 1.1.0+ without -pbkdf2)', legacy: true },
  { id: 'evp-md5', label: 'EVP_BytesToKey, MD5 (openssl before 1.1.0)', legacy: true },
];

const SALT_BYTES = 8;
const IV_BYTES = 16;
const SALTED_MAGIC = new Uint8Array([0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]); // "Salted__"
export const ITERATION_RANGE = { min: 1, max: 10_000_000, default: 10_000 };

function lookupCipher(id: OpensslCipherId): OpensslCipherInfo {
  const found = OPENSSL_CIPHERS.find((c) => c.id === id);
  if (!found) throw new AesError(`"${id}" is not a supported cipher.`, 'input');
  return found;
}

function lookupKdf(id: OpensslKdfId): OpensslKdfInfo {
  const found = KDFS.find((k) => k.id === id);
  if (!found) throw new AesError(`"${id}" is not a supported key derivation.`, 'input');
  return found;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * OpenSSL's legacy `EVP_BytesToKey` key+IV derivation (one hash per round,
 * no iteration count): `D1 = H(pass ‖ salt)`, `Di = H(D(i-1) ‖ pass ‖
 * salt)`, concatenated until at least `totalLen` bytes are produced, then
 * truncated to exactly `totalLen`.
 */
export function evpBytesToKey(
  pass: Uint8Array,
  salt: Uint8Array,
  hash: 'md5' | 'sha256',
  totalLen: number,
): Uint8Array {
  const hashFn = hash === 'md5' ? md5 : sha256;
  let previous: Uint8Array = new Uint8Array(0);
  let result: Uint8Array = new Uint8Array(0);
  while (result.length < totalLen) {
    previous = hashFn(concatBytes(previous, pass, salt));
    result = concatBytes(result, previous);
  }
  return result.slice(0, totalLen);
}

async function pbkdf2DeriveKeyIv(
  pass: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  totalLen: number,
): Promise<Uint8Array> {
  let key: CryptoKey;
  try {
    key = await globalThis.crypto.subtle.importKey('raw', pass as BufferSource, 'PBKDF2', false, ['deriveBits']);
  } catch {
    throw new AesError('The passphrase could not be prepared for key derivation.', 'input');
  }
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    totalLen * 8,
  );
  return new Uint8Array(bits);
}

async function deriveKeyIv(
  passphraseBytes: Uint8Array,
  salt: Uint8Array,
  kdf: OpensslKdfInfo,
  iterations: number | undefined,
  keyBytes: number,
): Promise<{ key: Uint8Array; iv: Uint8Array }> {
  const totalLen = keyBytes + IV_BYTES;
  const derived =
    kdf.id === 'pbkdf2'
      ? await pbkdf2DeriveKeyIv(passphraseBytes, salt, iterations!, totalLen)
      : evpBytesToKey(passphraseBytes, salt, kdf.id === 'evp-md5' ? 'md5' : 'sha256', totalLen);
  return { key: derived.slice(0, keyBytes), iv: derived.slice(keyBytes) };
}

async function importCbcCtrKey(key: Uint8Array, mode: 'cbc' | 'ctr', usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const name = mode === 'cbc' ? 'AES-CBC' : 'AES-CTR';
  try {
    return await globalThis.crypto.subtle.importKey('raw', key as BufferSource, { name }, false, [usage]);
  } catch {
    throw new AesError('This passphrase-derived key could not be used for AES encryption.', 'input');
  }
}

function validateIterations(kdf: OpensslKdfInfo, iterations: number | undefined): number | undefined {
  if (kdf.id !== 'pbkdf2') return undefined;
  const value = iterations ?? ITERATION_RANGE.default;
  if (!Number.isInteger(value) || value < ITERATION_RANGE.min || value > ITERATION_RANGE.max) {
    throw new AesError(
      `Iterations must be a whole number from ${ITERATION_RANGE.min} to ${ITERATION_RANGE.max.toLocaleString('en-US')}.`,
      'input',
    );
  }
  return value;
}

export interface PassphraseOptions {
  cipher?: OpensslCipherId;
  kdf?: OpensslKdfId;
  iterations?: number;
  /** Exactly 8 bytes. Encrypt only; omit for a fresh random salt. */
  salt?: Uint8Array;
}

export interface EncryptPassphraseResult {
  /** One line: Base64 of "Salted__" + salt + ciphertext. */
  base64: string;
  saltHex: string;
  /** The exact `openssl enc -d ...` command that decrypts `base64`. Never contains the passphrase. */
  command: string;
  warnings: string[];
}

export async function encryptWithPassphrase(
  plaintext: Uint8Array,
  passphrase: string,
  opts: PassphraseOptions = {},
): Promise<EncryptPassphraseResult> {
  requireSubtle();
  if (passphrase === '') throw new AesError('Enter a passphrase.', 'input');
  const cipher = lookupCipher(opts.cipher ?? 'aes-256-cbc');
  const kdf = lookupKdf(opts.kdf ?? 'pbkdf2');
  const iterations = validateIterations(kdf, opts.iterations);
  const warnings: string[] = [];

  let salt: Uint8Array;
  if (opts.salt) {
    if (opts.salt.length !== SALT_BYTES) {
      throw new AesError(`A fixed salt must be exactly ${SALT_BYTES} bytes (${SALT_BYTES * 2} hex digits).`, 'input');
    }
    salt = opts.salt;
    warnings.push(
      'A fixed salt is for reproducible tests only. Reusing it with the same passphrase for more than one encryption weakens the key derivation; leave it blank normally so a fresh random salt is used every time.',
    );
  } else {
    salt = new Uint8Array(SALT_BYTES);
    globalThis.crypto.getRandomValues(salt);
  }

  if (kdf.legacy) {
    warnings.push(
      'EVP_BytesToKey is a single fast hash with no iteration count and is easy to brute-force. It is offered only for interoperability with older systems; prefer PBKDF2 for anything new.',
    );
  }

  const passphraseBytes = new TextEncoder().encode(passphrase);
  const { key, iv } = await deriveKeyIv(passphraseBytes, salt, kdf, iterations, cipher.keyBytes);
  const cryptoKey = await importCbcCtrKey(key, cipher.mode, 'encrypt');

  let ciphertext: Uint8Array;
  try {
    if (cipher.mode === 'cbc') {
      ciphertext = new Uint8Array(
        await globalThis.crypto.subtle.encrypt(
          { name: 'AES-CBC', iv: iv as BufferSource },
          cryptoKey,
          plaintext as BufferSource,
        ),
      );
    } else {
      warnings.push(
        'AES-CTR has no integrity check: decrypting this later with the wrong passphrase will produce wrong bytes, not an error.',
      );
      ciphertext = new Uint8Array(
        await globalThis.crypto.subtle.encrypt(
          { name: 'AES-CTR', counter: iv as BufferSource, length: 128 },
          cryptoKey,
          plaintext as BufferSource,
        ),
      );
    }
  } catch {
    throw new AesError('This could not be encrypted.', 'input');
  }

  const combined = concatBytes(SALTED_MAGIC, salt, ciphertext);
  return {
    base64: toBase64(combined),
    saltHex: toHex(salt),
    command: opensslDecryptCommand({ cipher: cipher.id, kdf: kdf.id, iterations }),
    warnings,
  };
}

export interface DecryptPassphraseResult {
  plaintext: Uint8Array;
  saltHex: string;
  warnings: string[];
}

const NOT_OPENSSL_MESSAGE =
  'This is not OpenSSL enc output: it must start with Salted__ followed by an 8-byte salt. Data made with ' +
  '-nosalt, or with an explicit -S salt in OpenSSL 3 (which leaves that header out), cannot be read here.';

const WRONG_PASSPHRASE_MESSAGE = 'Could not decrypt: wrong passphrase, wrong options, or damaged data.';

export async function decryptWithPassphrase(
  base64Text: string,
  passphrase: string,
  opts: PassphraseOptions = {},
): Promise<DecryptPassphraseResult> {
  requireSubtle();
  if (passphrase === '') throw new AesError('Enter a passphrase.', 'input');
  const cipher = lookupCipher(opts.cipher ?? 'aes-256-cbc');
  const kdf = lookupKdf(opts.kdf ?? 'pbkdf2');
  const iterations = validateIterations(kdf, opts.iterations);
  const warnings: string[] = [];

  const raw = parseBase64(base64Text, 'ciphertext');
  if (raw.length < SALT_BYTES + SALTED_MAGIC.length) {
    throw new AesError(NOT_OPENSSL_MESSAGE, 'input');
  }
  for (let i = 0; i < SALTED_MAGIC.length; i++) {
    if (raw[i] !== SALTED_MAGIC[i]) throw new AesError(NOT_OPENSSL_MESSAGE, 'input');
  }
  const salt = raw.slice(SALTED_MAGIC.length, SALTED_MAGIC.length + SALT_BYTES);
  const ciphertext = raw.slice(SALTED_MAGIC.length + SALT_BYTES);

  const passphraseBytes = new TextEncoder().encode(passphrase);
  const { key, iv } = await deriveKeyIv(passphraseBytes, salt, kdf, iterations, cipher.keyBytes);
  const cryptoKey = await importCbcCtrKey(key, cipher.mode, 'decrypt');

  if (cipher.mode === 'cbc') {
    if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
      throw new AesError(
        'The ciphertext is not a whole number of 16-byte blocks, so it is truncated or damaged.',
        'input',
      );
    }
    try {
      const plaintext = new Uint8Array(
        await globalThis.crypto.subtle.decrypt(
          { name: 'AES-CBC', iv: iv as BufferSource },
          cryptoKey,
          ciphertext as BufferSource,
        ),
      );
      return { plaintext, saltHex: toHex(salt), warnings };
    } catch {
      throw new AesError(WRONG_PASSPHRASE_MESSAGE, 'decrypt');
    }
  }

  warnings.push(
    'AES-CTR has no integrity check: if the passphrase is wrong, this will produce wrong bytes rather than an error.',
  );
  const plaintext = new Uint8Array(
    await globalThis.crypto.subtle.decrypt(
      { name: 'AES-CTR', counter: iv as BufferSource, length: 128 },
      cryptoKey,
      ciphertext as BufferSource,
    ),
  );
  return { plaintext, saltHex: toHex(salt), warnings };
}

/**
 * The exact `openssl enc -d ...` command that decrypts output made with
 * these options. Takes no passphrase parameter at all -- a structural
 * guarantee (S3) that this function cannot leak one -- and always emits
 * `-pass env:PASS`, never `-pass pass:...` or any form that writes the
 * passphrase into a command line, shell history, or a process list.
 */
export function opensslDecryptCommand(opts: PassphraseOptions = {}): string {
  const cipher = lookupCipher(opts.cipher ?? 'aes-256-cbc');
  const kdf = lookupKdf(opts.kdf ?? 'pbkdf2');
  if (kdf.id === 'pbkdf2') {
    const iterations = validateIterations(kdf, opts.iterations);
    return `openssl enc -d -${cipher.id} -pbkdf2 -iter ${iterations} -md sha256 -a -A -in encrypted.txt -pass env:PASS`;
  }
  const md = kdf.id === 'evp-md5' ? 'md5' : 'sha256';
  return `openssl enc -d -${cipher.id} -md ${md} -a -A -in encrypted.txt -pass env:PASS`;
}
