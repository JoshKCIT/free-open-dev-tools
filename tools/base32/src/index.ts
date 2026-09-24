import meta from './meta.json';

export { meta };

/**
 * Three distinct alphabets. `base32` and `base32hex` are the two RFC 4648
 * alphabets (sections 6 and 7); `crockford` is Douglas Crockford's own
 * alphabet, which is not an RFC and encodes a NUMBER rather than a raw byte
 * stream by definition. See {@link CrockfordMode} for why byte mode exists
 * here anyway.
 */
export type Base32Alphabet = 'base32' | 'base32hex' | 'crockford';

/**
 * Crockford's own definition encodes an unsigned integer: five bits at a
 * time from the low end, most significant digit first, with no leading
 * zero digits beyond a single `0` for the value zero. That is `number`
 * mode. `byte` mode instead treats the input the way the two RFC alphabets
 * do -- packing raw bytes five bits at a time, zero-extending the final
 * group on the right -- which is useful when the payload is not naturally
 * a single integer. The two modes produce different strings for the same
 * bytes; this is a deliberate, documented choice (see `meta.json`
 * `ambiguities`), not a bug.
 */
export type CrockfordMode = 'byte' | 'number';

interface AlphabetInfo {
  /** The alphabet's own symbol string, index = value. */
  symbols: string;
  /** Whether RFC-style `=` padding and length validation apply. */
  padded: boolean;
}

// RFC 4648 section 6, Table 3.
const BASE32_SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// RFC 4648 section 7, Table 4.
const BASE32HEX_SYMBOLS = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
// Crockford's own data alphabet (https://www.crockford.com/base32.html):
// 10 digits plus 22 letters, excluding I, L, O and U (each confusable or,
// for U, "accidental obscenity" in Crockford's own words).
const CROCKFORD_SYMBOLS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// Crockford's five EXTRA symbols used only for the check symbol, covering
// values 32 to 36. Note that 'U' -- excluded from the data alphabet above
// -- is deliberately reused here as the symbol for value 36. This is why
// two separate tables exist: a single shared "valid character" set would
// either wrongly accept 'U' in a data position or wrongly reject it in a
// checksum position.
const CROCKFORD_CHECKSUM_EXTRA = '*~$=U';
const CROCKFORD_CHECKSUM_SYMBOLS = CROCKFORD_SYMBOLS + CROCKFORD_CHECKSUM_EXTRA; // 37 symbols, values 0-36

export const ALPHABETS: Record<Base32Alphabet, AlphabetInfo> = {
  base32: { symbols: BASE32_SYMBOLS, padded: true },
  base32hex: { symbols: BASE32HEX_SYMBOLS, padded: true },
  crockford: { symbols: CROCKFORD_SYMBOLS, padded: false },
};

/** Data-alphabet lookup: case-insensitive, with the three published decoding aliases. */
function crockfordDataValue(ch: string): number {
  const c = ch.toUpperCase();
  if (c === 'O') return 0;
  if (c === 'I' || c === 'L') return 1;
  return CROCKFORD_SYMBOLS.indexOf(c);
}

/**
 * Check-symbol lookup: the same data aliases apply, extended with the five
 * checksum-only symbols covering values 32-36. `U`/`u` (value 36) is valid
 * ONLY here, never as a data character -- see the comment on
 * {@link CROCKFORD_CHECKSUM_EXTRA}.
 */
function crockfordCheckCharValue(ch: string): number {
  const c = ch.toUpperCase();
  if (c === 'O') return 0;
  if (c === 'I' || c === 'L') return 1;
  const dataIdx = CROCKFORD_SYMBOLS.indexOf(c);
  if (dataIdx !== -1) return dataIdx;
  const extIdx = CROCKFORD_CHECKSUM_EXTRA.indexOf(c);
  return extIdx === -1 ? -1 : 32 + extIdx;
}

export class Base32Error extends Error {
  /** Index into the input where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'Base32Error';
    this.position = position;
  }
}

export interface EncodeOptions {
  alphabet?: Base32Alphabet;
  /** RFC alphabets only. Default true. Ignored for `crockford`, which has no padding character. */
  padding?: boolean;
  /** `crockford` only. Default `'byte'`. */
  crockfordMode?: CrockfordMode;
  /** `crockford` only. Appends a modulo-37 check symbol. Default false. */
  crockfordChecksum?: boolean;
}

export interface DecodeOptions {
  alphabet?: Base32Alphabet;
  /** `crockford` only. Must match how the value was encoded. Default `'byte'`. */
  crockfordMode?: CrockfordMode;
  /** `crockford` only. Expects and verifies a trailing check symbol. Default false. */
  crockfordChecksum?: boolean;
}

/** Packs bytes five bits at a time into `symbols`, zero-extending the final group. No padding. */
function packBits5(bytes: Uint8Array, symbols: string): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += symbols[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += symbols[(value << (5 - bits)) & 31];
  return out;
}

/** Inverse of {@link packBits5}: unpacks a sequence of 5-bit values into bytes. */
function unpackValues5(values: number[]): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const v of values) {
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

/** Minimal big-endian bytes for a non-negative integer. Zero encodes as a single zero byte. */
function bigIntToBytesBE(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array([0]);
  const out: number[] = [];
  let m = n;
  while (m > 0n) {
    out.unshift(Number(m & 0xffn));
    m >>= 8n;
  }
  return new Uint8Array(out);
}

function valuesToBigInt(values: number[], base: bigint): bigint {
  let n = 0n;
  for (const v of values) n = n * base + BigInt(v);
  return n;
}

function padTo8(raw: string): string {
  const padLen = (8 - (raw.length % 8)) % 8;
  return raw + '='.repeat(padLen);
}

// -- RFC alphabets (base32, base32hex) --------------------------------------

function encodeRfc(bytes: Uint8Array, alphabet: 'base32' | 'base32hex', padding: boolean): string {
  const raw = packBits5(bytes, ALPHABETS[alphabet].symbols);
  return padding ? padTo8(raw) : raw;
}

// A valid (post-padding-removal) body length, mod 8, is one of these, mapping
// to how many trailing bytes that final partial group represents. Anything
// else is not a length RFC 4648 base32 can produce.
const RFC_REMAINDER_TO_BYTES: Record<number, number> = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4 };

function decodeRfc(input: string, alphabet: 'base32' | 'base32hex'): Uint8Array {
  const symbols = ALPHABETS[alphabet].symbols;

  // Padding, when present, must be a contiguous run of '=' at the end only.
  let body = input;
  while (body.endsWith('=')) {
    body = body.slice(0, -1);
  }
  if (body.includes('=')) {
    throw new Base32Error('Padding ("=") appears before the end of the input.', body.indexOf('='));
  }

  const remainder = body.length % 8;
  if (!(remainder in RFC_REMAINDER_TO_BYTES)) {
    throw new Base32Error(
      `Invalid length: a ${alphabet === 'base32' ? 'Base32' : 'Base32hex'} string (after removing padding) must be a multiple of 8 characters, or end with 2, 4, 5 or 7 extra characters. Found ${body.length} character${body.length === 1 ? '' : 's'} (remainder ${remainder}).`,
      input.length,
    );
  }

  const values: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    const idx = symbols.indexOf(ch);
    if (idx === -1) {
      throw new Base32Error(`"${ch}" is not a valid ${alphabet === 'base32' ? 'Base32' : 'Base32hex'} character.`, i);
    }
    values.push(idx);
  }

  const fullGroups = Math.floor(body.length / 8);
  const tailBytes = RFC_REMAINDER_TO_BYTES[remainder]!;
  const expectedByteLength = fullGroups * 5 + tailBytes;
  const bytes = unpackValues5(values);
  return bytes.slice(0, expectedByteLength);
}

// -- Crockford ----------------------------------------------------------------

/**
 * The check symbol encodes, modulo 37, the numeric value of the payload's
 * own digit string (its base-32 positional value), mapped through the
 * 37-symbol extended alphabet. This is well defined for both Crockford
 * modes, because after encoding, the payload is always a base-32 digit
 * string with a positional value regardless of how it was produced.
 *
 * Worked example: the byte 0x01 in byte mode packs to the two symbols "0"
 * and "4" (00000 00100 in bits). Their positional value is 0*32 + 4 = 4.
 * 4 mod 37 = 4, and the extended alphabet's symbol at index 4 is "4" (data
 * symbols occupy indices 0-31), so the checksummed string is "044".
 */
function crockfordChecksumSymbol(payloadValues: number[]): string {
  const n = valuesToBigInt(payloadValues, 32n);
  return CROCKFORD_CHECKSUM_SYMBOLS[Number(n % 37n)]!;
}

function encodeCrockford(bytes: Uint8Array, mode: CrockfordMode, checksum: boolean): string {
  let payload: string;
  let payloadValues: number[];
  if (mode === 'number') {
    const n = bytesToBigIntBE(bytes);
    if (n === 0n) {
      payload = '0';
      payloadValues = [0];
    } else {
      payloadValues = [];
      let m = n;
      while (m > 0n) {
        payloadValues.unshift(Number(m % 32n));
        m /= 32n;
      }
      payload = payloadValues.map((v) => CROCKFORD_SYMBOLS[v]).join('');
    }
  } else {
    payload = packBits5(bytes, CROCKFORD_SYMBOLS);
    payloadValues = [...payload].map((ch) => CROCKFORD_SYMBOLS.indexOf(ch));
  }
  return checksum ? payload + crockfordChecksumSymbol(payloadValues) : payload;
}

function decodeCrockford(input: string, mode: CrockfordMode, checksum: boolean): Uint8Array {
  // Hyphens are visual separators only and are ignored entirely.
  const stripped = input.replace(/-/g, '');

  let body = stripped;
  let checkChar: string | undefined;
  if (checksum) {
    if (body.length === 0) throw new Base32Error('Missing Crockford check symbol.', 0);
    checkChar = body[body.length - 1];
    body = body.slice(0, -1);
  }

  const values: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    const v = crockfordDataValue(ch);
    if (v === -1) {
      throw new Base32Error(`"${ch}" is not a valid Crockford Base32 character in a data position.`, i);
    }
    values.push(v);
  }

  if (checksum && checkChar !== undefined) {
    const expected = Number(valuesToBigInt(values, 32n) % 37n);
    const actual = crockfordCheckCharValue(checkChar);
    if (actual !== expected) {
      throw new Base32Error(
        `Crockford checksum did not match: expected the check symbol for value ${expected}, found "${checkChar}".`,
        stripped.length - 1,
      );
    }
  }

  if (mode === 'number') {
    return bigIntToBytesBE(valuesToBigInt(values, 32n));
  }
  return unpackValues5(values);
}

// -- Public API ---------------------------------------------------------------

/** Encodes bytes. This is the primitive; the text helpers wrap it. */
export function encodeBytes(bytes: Uint8Array, options: EncodeOptions = {}): string {
  const { alphabet = 'base32', padding = true, crockfordMode = 'byte', crockfordChecksum = false } = options;
  if (alphabet === 'crockford') return encodeCrockford(bytes, crockfordMode, crockfordChecksum);
  return encodeRfc(bytes, alphabet, padding);
}

/** Decodes to bytes. Throws {@link Base32Error} rather than returning garbage. */
export function decodeToBytes(input: string, options: DecodeOptions = {}): Uint8Array {
  const { alphabet = 'base32', crockfordMode = 'byte', crockfordChecksum = false } = options;
  if (alphabet === 'crockford') return decodeCrockford(input, crockfordMode, crockfordChecksum);
  return decodeRfc(input, alphabet);
}

/** Encodes text as UTF-8, then Base32 (of whichever alphabet is selected). */
export function encodeText(text: string, options: EncodeOptions = {}): string {
  return encodeBytes(new TextEncoder().encode(text), options);
}

/** Decodes and interprets the bytes as UTF-8. */
export function decodeToText(input: string, options: DecodeOptions = {}): string {
  return new TextDecoder().decode(decodeToBytes(input, options));
}
