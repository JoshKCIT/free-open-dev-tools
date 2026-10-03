/**
 * The key model every output is written from, and the package's error type.
 *
 * Nothing is converted from one format straight to another: a key is read into this model, and every format is written
 * from it, so no pair of formats can disagree. All numbers are unsigned big-endian magnitudes with no leading zero
 * bytes (a zero is one zero byte); an elliptic curve private number is padded to the size of the curve when it is
 * written.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */

export class KeyConverterError extends Error {
  /** Index into the relevant text where the problem was found, when known. */
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'KeyConverterError';
    this.position = position;
  }
}

/** The RSA sizes the generator offers. The public exponent is always 65537. */
export const RSA_GENERATE_BITS = [2048, 3072, 4096] as const;

export type RsaBits = (typeof RSA_GENERATE_BITS)[number];

/** The largest RSA modulus a key may have when it is read, so a hostile number cannot size a large calculation. */
export const RSA_MAX_BITS = 16384;

/** The largest modulus whose prime factors are tested for primality when a private key is read. */
export const RSA_PRIME_TEST_MAX_BITS = 4096;

/** The warning shown for a private RSA key above that size, whose prime factors are not tested. */
export const UNTESTED_PRIMES_WARNING =
  'This RSA key is larger than 4096 bits, so its prime factors were not tested for primality.';

/** The longest comment the OpenSSH line carries. */
export const COMMENT_LIMIT = 256;

/** The warning shown for an RSA key under 2048 bits. */
export const SHORT_RSA_WARNING = 'This RSA key is shorter than 2048 bits, which is too short for new use.';

export type Curve = 'P-256' | 'P-384' | 'P-521';

export interface RsaKey {
  type: 'rsa';
  n: Uint8Array;
  e: Uint8Array;
  d?: Uint8Array;
  p?: Uint8Array;
  q?: Uint8Array;
  dp?: Uint8Array;
  dq?: Uint8Array;
  qi?: Uint8Array;
}

export interface EcKey {
  type: 'ec';
  curve: Curve;
  /** The public point, uncompressed: 04, then x and y each as wide as the curve. */
  point: Uint8Array;
  /** The private number, as wide as the curve. */
  d?: Uint8Array;
}

export interface Ed25519Key {
  type: 'ed25519';
  /** The 32 byte public key of RFC 8032. */
  pub: Uint8Array;
  /** The 32 byte seed, which is the private key of RFC 8032. */
  seed?: Uint8Array;
}

export type KeyModel = RsaKey | EcKey | Ed25519Key;

export interface CurveInfo {
  /** The object identifier of the curve (RFC 5480 and SEC 2). */
  oid: string;
  /** Bytes in a coordinate and in the private number (66 for P-521). */
  size: number;
  /** Bits in the order of the curve. */
  bits: number;
  /** The identifier OpenSSH writes inside the key (RFC 5656 section 6.1). */
  ssh: 'nistp256' | 'nistp384' | 'nistp521';
}

/** Looked up by curve name with a Map, so a typed name such as __proto__ or constructor finds nothing. */
export const CURVES: ReadonlyMap<Curve, CurveInfo> = new Map<Curve, CurveInfo>([
  ['P-256', { oid: '1.2.840.10045.3.1.7', size: 32, bits: 256, ssh: 'nistp256' }],
  ['P-384', { oid: '1.3.132.0.34', size: 48, bits: 384, ssh: 'nistp384' }],
  ['P-521', { oid: '1.3.132.0.35', size: 66, bits: 521, ssh: 'nistp521' }],
]);

/** Whether the key carries its private part. */
export function isPrivate(key: KeyModel): boolean {
  switch (key.type) {
    case 'rsa':
      return (
        key.d !== undefined &&
        key.p !== undefined &&
        key.q !== undefined &&
        key.dp !== undefined &&
        key.dq !== undefined &&
        key.qi !== undefined
      );
    case 'ec':
      return key.d !== undefined;
    case 'ed25519':
      return key.seed !== undefined;
  }
}

/** The size of the key in bits: the RSA modulus, the order of the curve, or 256 for Ed25519. */
export function keyBits(key: KeyModel): number {
  switch (key.type) {
    case 'rsa': {
      const top = key.n[0] ?? 0;
      return key.n.length * 8 - (Math.clz32(top) - 24);
    }
    case 'ec':
      return CURVES.get(key.curve)?.bits ?? 0;
    case 'ed25519':
      return 256;
  }
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

/**
 * Refuses a comment that is too long, holds a line break or holds any other control character (C0, DEL or C1: NUL and ESC
 * among them), before any work is done for it. The comment is written into an OpenSSH line and an RFC 4716 header, which
 * are text files that other software reads, and a control character in them is never wanted.
 */
export function checkComment(comment: string): void {
  if (comment.length > COMMENT_LIMIT) {
    throw new KeyConverterError(
      `The comment is ${comment.length} characters. The limit is ${COMMENT_LIMIT} because the public key is written as a single line.`,
    );
  }
  for (let i = 0; i < comment.length; i++) {
    const code = comment.charCodeAt(i);
    if (code === 10 || code === 13) {
      throw new KeyConverterError(
        `The comment has a line break at character ${i + 1}. A comment is written on a single line, so remove the break.`,
        i,
      );
    }
  }
}

/**
 * A public exponent as text: a decimal number up to 8 bytes (20 digits), and a longer one by its size in bits, because an
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      throw new KeyConverterError(
        `The comment has a control character at character ${i + 1}. A comment is written as plain text on one line, so remove it.`,
        i,
      );
    }
 * exponent of thousands of digits is not a number anyone reads and would fill the page.
 */
export function exponentText(e: Uint8Array): string {
  let skip = 0;
  while (skip < e.length - 1 && e[skip] === 0) skip++;
  const bytes = e.subarray(skip);
  if (bytes.length <= 8) {
    let value = 0n;
    for (const octet of bytes) value = (value << 8n) | BigInt(octet);
    return value.toString();
  }
  return `a number of ${bytes.length * 8 - (Math.clz32(bytes[0]!) - 24)} bits`;
}

/** Whether the public exponent is 3 or 65537, the two values RSA keys are made with. */
function isCommonExponent(e: Uint8Array): boolean {
  let skip = 0;
  while (skip < e.length - 1 && e[skip] === 0) skip++;
  const bytes = e.subarray(skip);
  return (
    (bytes.length === 1 && bytes[0] === 3) || (bytes.length === 3 && bytes[0] === 1 && bytes[1] === 0 && bytes[2] === 1)
  );
}

/**
 * What is worth saying about a key itself, apart from how it was read: an RSA key under 2048 bits, and an RSA key whose
 * public exponent is neither 3 nor 65537.
 */
export function keyWarnings(key: KeyModel): string[] {
  const warnings: string[] = [];
  if (key.type === 'rsa') {
    if (keyBits(key) < 2048) warnings.push(SHORT_RSA_WARNING);
    if (key.p !== undefined && key.q !== undefined && keyBits(key) > RSA_PRIME_TEST_MAX_BITS) {
      warnings.push(UNTESTED_PRIMES_WARNING);
    }
    if (!isCommonExponent(key.e)) {
      warnings.push(
        `This RSA key has a public exponent of ${exponentText(key.e)}. Nearly every RSA key uses 65537, and software that expects it may refuse this key.`,
      );
    }
  }
  return warnings;
}
