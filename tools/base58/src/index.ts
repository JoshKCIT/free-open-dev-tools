import { sha256 } from '@noble/hashes/sha2.js';
import meta from './meta.json';

export { meta };

/**
 * The same 58 characters (Base64 without 0, O, I, l, +, /) in three
 * different orders. Bitcoin's is transcribed from `bitcoin/bitcoin`'s own
 * `base58.cpp`. Ripple's and Flickr's are transcribed from `@scure/base`'s
 * `base58xrp` and `base58flickr` exports -- the alphabet the XRP Ledger's
 * own `ripple-address-codec` library (via `xrpl.js`) and Flickr's short
 * URLs actually use at runtime, an independent second source from
 * Bitcoin's for each. See `meta.json` `testNotes` for the full provenance.
 */
export type Base58Alphabet = 'bitcoin' | 'ripple' | 'flickr';

// bitcoin/bitcoin src/base58.cpp: `static const char* pszBase58 = "..."`.
const BITCOIN_SYMBOLS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// @scure/base `base58xrp` export (used at runtime by xrpl.js's ripple-address-codec).
const RIPPLE_SYMBOLS = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';
// @scure/base `base58flickr` export.
const FLICKR_SYMBOLS = '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

export const ALPHABETS: Record<Base58Alphabet, string> = {
  bitcoin: BITCOIN_SYMBOLS,
  ripple: RIPPLE_SYMBOLS,
  flickr: FLICKR_SYMBOLS,
};

export class Base58Error extends Error {
  /** Index into the input where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'Base58Error';
    this.position = position;
  }
}

export interface EncodeOptions {
  alphabet?: Base58Alphabet;
}

export interface DecodeOptions {
  alphabet?: Base58Alphabet;
}

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

/** Minimal big-endian bytes for a non-negative integer. Zero encodes as no bytes at all. */
function bigIntToBytesBE(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array(0);
  const out: number[] = [];
  let m = n;
  while (m > 0n) {
    out.unshift(Number(m & 0xffn));
    m >>= 8n;
  }
  return new Uint8Array(out);
}

/**
 * Encodes bytes. The integer conversion (via BigInt) cannot by itself
 * recover leading zero bytes, because a leading zero byte does not change
 * the integer's value -- 0x00 0x01 and 0x01 are the same number. Leading
 * zero bytes are therefore counted and prepended as leading
 * zero-value characters as an explicit separate step, both here and in
 * {@link decodeToBytes} below.
 */
export function encodeBytes(bytes: Uint8Array, options: EncodeOptions = {}): string {
  const { alphabet = 'bitcoin' } = options;
  const symbols = ALPHABETS[alphabet];

  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros++;

  let n = bytesToBigIntBE(bytes);
  let digits = '';
  while (n > 0n) {
    const rem = n % 58n;
    digits = symbols[Number(rem)] + digits;
    n /= 58n;
  }

  return symbols[0]!.repeat(leadingZeros) + digits;
}

/** Decodes to bytes. Throws {@link Base58Error} rather than returning garbage. */
export function decodeToBytes(input: string, options: DecodeOptions = {}): Uint8Array {
  const { alphabet = 'bitcoin' } = options;
  const symbols = ALPHABETS[alphabet];
  const zeroChar = symbols[0]!;

  let leadingZeros = 0;
  while (leadingZeros < input.length && input[leadingZeros] === zeroChar) leadingZeros++;

  let n = 0n;
  for (let i = leadingZeros; i < input.length; i++) {
    const ch = input[i]!;
    const idx = symbols.indexOf(ch);
    if (idx === -1) {
      throw new Base58Error(`"${ch}" is not a valid character in the ${alphabet} Base58 alphabet.`, i);
    }
    n = n * 58n + BigInt(idx);
  }

  const body = bigIntToBytesBE(n);
  const out = new Uint8Array(leadingZeros + body.length);
  out.set(body, leadingZeros);
  return out;
}

// -- Base58Check ----------------------------------------------------------

/** Double SHA-256, the digest Base58Check's four-byte checksum is drawn from. */
function doubleSha256(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes));
}

/**
 * Builds a Base58Check string from a version byte and a payload: the
 * checksum is the first four bytes of a double SHA-256 over the version
 * byte and payload together, computed with `@noble/hashes` -- this
 * project's reviewed crypto dependency, never a hand-rolled digest.
 */
export function encodeCheck(version: number, payload: Uint8Array, options: EncodeOptions = {}): string {
  const body = new Uint8Array(1 + payload.length);
  body[0] = version & 0xff;
  body.set(payload, 1);
  const checksum = doubleSha256(body).slice(0, 4);
  const full = new Uint8Array(body.length + 4);
  full.set(body, 0);
  full.set(checksum, body.length);
  return encodeBytes(full, options);
}

export interface CheckedValue {
  version: number;
  payload: Uint8Array;
}

/**
 * Decodes a Base58Check string, returning the version byte and payload
 * separately (never one joined array). Recomputes the double SHA-256 and
 * throws {@link Base58Error} naming the mismatch if the trailing four bytes
 * do not match.
 */
export function decodeCheck(input: string, options: DecodeOptions = {}): CheckedValue {
  const full = decodeToBytes(input, options);
  if (full.length < 5) {
    throw new Base58Error('Too short to contain a version byte, a payload and a four-byte checksum.', 0);
  }
  const body = full.slice(0, full.length - 4);
  const checksum = full.slice(full.length - 4);
  const expected = doubleSha256(body).slice(0, 4);
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expected[i]) {
      throw new Base58Error(
        'The checksum did not match: the last four bytes do not equal the double SHA-256 of the rest.',
      );
    }
  }
  return { version: body[0]!, payload: body.slice(1) };
}
