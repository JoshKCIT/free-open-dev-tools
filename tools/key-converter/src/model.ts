/**
 * The key model every output is written from, and the package's error type.
 *
 * Nothing is converted from one format straight to another: a key is read into this model, and every format is written
 * from it, so no pair of formats can disagree. All numbers are unsigned big-endian magnitudes with no leading zero
 * bytes (a zero is one zero byte).
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

export type KeyModel = RsaKey;

/** Whether the key carries its private part. */
export function isPrivate(key: KeyModel): boolean {
  return (
    key.d !== undefined &&
    key.p !== undefined &&
    key.q !== undefined &&
    key.dp !== undefined &&
    key.dq !== undefined &&
    key.qi !== undefined
  );
}

/** The size of the key in bits: the length of the RSA modulus. */
export function keyBits(key: KeyModel): number {
  const top = key.n[0] ?? 0;
  return key.n.length * 8 - (Math.clz32(top) - 24);
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}
