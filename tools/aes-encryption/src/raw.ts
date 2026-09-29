/**
 * Raw-key AES-GCM, AES-CBC and AES-CTR over the platform's own
 * `crypto.subtle`. No AES arithmetic is written here; this file only shapes
 * bytes into what `crypto.subtle` needs and reports what went wrong with a
 * fixed message that never repeats the key back (S2).
 */
import { AesError, requireSubtle } from './codec';

export interface RawModeInfo {
  id: 'gcm' | 'cbc' | 'ctr';
  label: string;
}

/** GCM first (the default, the only mode with integrity); then CBC, then CTR. */
export const RAW_MODES: RawModeInfo[] = [
  { id: 'gcm', label: 'AES-GCM' },
  { id: 'cbc', label: 'AES-CBC' },
  { id: 'ctr', label: 'AES-CTR' },
];

export type RawMode = RawModeInfo['id'];

const GCM_TAG_BYTES = 16;
const GCM_DEFAULT_IV_BYTES = 12;
const CBC_CTR_IV_BYTES = 16;

function validateKeyLength(key: Uint8Array): void {
  if (key.length === 24) {
    throw new AesError(
      "A 24-byte key is AES-192, which this tool does not offer: Chromium's Web Crypto refuses 192-bit AES keys. Use a 16-byte (AES-128) or 32-byte (AES-256) key.",
      'input',
    );
  }
  if (key.length !== 16 && key.length !== 32) {
    throw new AesError(
      `An AES key must be 16 bytes (AES-128) or 32 bytes (AES-256); this key is ${key.length} bytes.`,
      'input',
    );
  }
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
 * Imports raw key bytes for one specific AES mode. Web Crypto ties an
 * imported key's algorithm name to what it can later be used with -- a key
 * imported as "AES-CBC" cannot be handed to an "AES-CTR" operation, even
 * though the underlying bytes are identical -- so the algorithm name given
 * here must match the one `encrypt`/`decrypt` will use.
 */
async function importAesKeyForMode(key: Uint8Array, mode: RawMode, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const name = mode === 'gcm' ? 'AES-GCM' : mode === 'cbc' ? 'AES-CBC' : 'AES-CTR';
  try {
    return await globalThis.crypto.subtle.importKey('raw', key as BufferSource, { name }, false, [usage]);
  } catch {
    throw new AesError('This key could not be used for AES encryption.', 'input');
  }
}

export interface EncryptRawOptions {
  mode?: RawMode;
  /** Empty/undefined on encrypt means random: 12 bytes for GCM, 16 bytes for CBC/CTR. */
  iv?: Uint8Array;
  /** GCM only. */
  aad?: Uint8Array;
}

export interface EncryptRawResult {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  /** Present for GCM only. */
  tag?: Uint8Array;
  /** IV ‖ ciphertext ‖ tag (tag only for GCM). */
  combined: Uint8Array;
  warnings: string[];
}

export async function encryptRaw(
  plaintext: Uint8Array,
  key: Uint8Array,
  opts: EncryptRawOptions = {},
): Promise<EncryptRawResult> {
  requireSubtle();
  const mode = opts.mode ?? 'gcm';
  validateKeyLength(key);
  const warnings: string[] = [];

  if (mode === 'gcm') {
    let iv = opts.iv;
    if (!iv || iv.length === 0) {
      iv = new Uint8Array(GCM_DEFAULT_IV_BYTES);
      globalThis.crypto.getRandomValues(iv);
    } else {
      if (iv.length < 1 || iv.length > 128) {
        throw new AesError('The IV must be between 1 and 128 bytes.', 'input');
      }
      if (iv.length !== GCM_DEFAULT_IV_BYTES) {
        warnings.push(
          `This IV is ${iv.length} bytes, not the usual 12. GCM accepts any length here, but 12 bytes is the standard choice and the only length "IV is prepended" can assume on decrypt.`,
        );
      }
      warnings.push(
        'Never reuse an IV with the same key for AES-GCM: doing so breaks both confidentiality and integrity. Leave the IV blank to get a fresh random one.',
      );
    }
    const cryptoKey = await importAesKeyForMode(key, 'gcm', 'encrypt');
    const aad = opts.aad ?? new Uint8Array(0);
    let combinedCiphertext: Uint8Array;
    try {
      combinedCiphertext = new Uint8Array(
        await globalThis.crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
          cryptoKey,
          plaintext as BufferSource,
        ),
      );
    } catch {
      throw new AesError('This could not be encrypted with the supplied key.', 'input');
    }
    const ciphertext = combinedCiphertext.slice(0, combinedCiphertext.length - GCM_TAG_BYTES);
    const tag = combinedCiphertext.slice(combinedCiphertext.length - GCM_TAG_BYTES);
    return { iv, ciphertext, tag, combined: concatBytes(iv, combinedCiphertext), warnings };
  }

  // CBC / CTR
  let iv = opts.iv;
  if (!iv || iv.length === 0) {
    iv = new Uint8Array(CBC_CTR_IV_BYTES);
    globalThis.crypto.getRandomValues(iv);
  } else if (iv.length !== CBC_CTR_IV_BYTES) {
    throw new AesError(`An AES-CBC or AES-CTR IV must be exactly 16 bytes; this one is ${iv.length} bytes.`, 'input');
  }
  if (mode === 'ctr') {
    warnings.push(
      'AES-CTR has no integrity check: if the wrong key is used to decrypt this later, the result will be wrong bytes, not an error.',
    );
  }

  const cryptoKey = await importAesKeyForMode(key, mode, 'encrypt');
  let ciphertext: Uint8Array;
  try {
    if (mode === 'cbc') {
      ciphertext = new Uint8Array(
        await globalThis.crypto.subtle.encrypt(
          { name: 'AES-CBC', iv: iv as BufferSource },
          cryptoKey,
          plaintext as BufferSource,
        ),
      );
    } else {
      ciphertext = new Uint8Array(
        await globalThis.crypto.subtle.encrypt(
          { name: 'AES-CTR', counter: iv as BufferSource, length: 128 },
          cryptoKey,
          plaintext as BufferSource,
        ),
      );
    }
  } catch {
    throw new AesError('This could not be encrypted with the supplied key.', 'input');
  }
  return { iv, ciphertext, combined: concatBytes(iv, ciphertext), warnings };
}

export interface DecryptRawOptions {
  mode?: RawMode;
  iv?: Uint8Array;
  /** When true, `data` starts with the IV (12 bytes for GCM, 16 bytes for CBC/CTR). */
  ivPrepended?: boolean;
  /** GCM only: a tag given separately from `data`, instead of appended to it. */
  tag?: Uint8Array;
  /** GCM only. */
  aad?: Uint8Array;
}

export interface DecryptRawResult {
  plaintext: Uint8Array;
  warnings: string[];
}

export async function decryptRaw(
  data: Uint8Array,
  key: Uint8Array,
  opts: DecryptRawOptions = {},
): Promise<DecryptRawResult> {
  requireSubtle();
  const mode = opts.mode ?? 'gcm';
  validateKeyLength(key);
  const warnings: string[] = [];

  const ivLength = mode === 'gcm' ? GCM_DEFAULT_IV_BYTES : CBC_CTR_IV_BYTES;
  let iv: Uint8Array;
  let body: Uint8Array;
  if (opts.ivPrepended) {
    if (data.length < ivLength) {
      throw new AesError('The data is shorter than the IV this mode expects, so no IV can be prepended.', 'input');
    }
    iv = data.slice(0, ivLength);
    body = data.slice(ivLength);
  } else if (opts.iv && opts.iv.length > 0) {
    iv = opts.iv;
    body = data;
  } else {
    throw new AesError(
      'Decrypting needs the IV: enter it, or tick "IV is prepended" if the ciphertext starts with it.',
      'input',
    );
  }

  if (mode !== 'gcm' && iv.length !== CBC_CTR_IV_BYTES) {
    throw new AesError(`An AES-CBC or AES-CTR IV must be exactly 16 bytes; this one is ${iv.length} bytes.`, 'input');
  }
  if (mode === 'gcm' && (iv.length < 1 || iv.length > 128)) {
    throw new AesError('The IV must be between 1 and 128 bytes.', 'input');
  }

  if (mode === 'gcm') {
    const cryptoKey = await importAesKeyForMode(key, 'gcm', 'decrypt');
    const aad = opts.aad ?? new Uint8Array(0);
    let combinedCiphertext: Uint8Array;
    if (opts.tag) {
      if (opts.tag.length !== GCM_TAG_BYTES) {
        throw new AesError('A separate GCM tag must be exactly 16 bytes.', 'input');
      }
      combinedCiphertext = concatBytes(body, opts.tag);
    } else {
      if (body.length < GCM_TAG_BYTES) {
        throw new AesError('The data is too short to contain a 16-byte GCM tag.', 'input');
      }
      combinedCiphertext = body;
    }
    try {
      const plaintext = new Uint8Array(
        await globalThis.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
          cryptoKey,
          combinedCiphertext as BufferSource,
        ),
      );
      return { plaintext, warnings };
    } catch {
      throw new AesError(
        'Could not decrypt: wrong key, wrong IV, wrong additional data, or the ciphertext or tag was changed.',
        'decrypt',
      );
    }
  }

  // CBC / CTR
  if (mode === 'cbc' && (body.length === 0 || body.length % 16 !== 0)) {
    throw new AesError(
      'The ciphertext is not a whole number of 16-byte blocks, so it is truncated or damaged.',
      'input',
    );
  }
  if (mode === 'ctr') {
    warnings.push(
      'AES-CTR has no integrity check: if the key is wrong, this will produce wrong bytes rather than an error.',
    );
  }
  const cryptoKey = await importAesKeyForMode(key, mode, 'decrypt');
  try {
    if (mode === 'cbc') {
      const plaintext = new Uint8Array(
        await globalThis.crypto.subtle.decrypt(
          { name: 'AES-CBC', iv: iv as BufferSource },
          cryptoKey,
          body as BufferSource,
        ),
      );
      return { plaintext, warnings };
    }
    const plaintext = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: 'AES-CTR', counter: iv as BufferSource, length: 128 },
        cryptoKey,
        body as BufferSource,
      ),
    );
    return { plaintext, warnings };
  } catch {
    throw new AesError('Could not decrypt: wrong key, wrong IV, or damaged data.', 'decrypt');
  }
}

/** A fresh random AES key of the requested size, from `crypto.getRandomValues` only. */
export function generateKey(bits: 128 | 256): Uint8Array {
  const key = new Uint8Array(bits / 8);
  globalThis.crypto.getRandomValues(key);
  return key;
}
