import { shake128, shake256 } from '@noble/hashes/sha3.js';

/** The shortest SHAKE output the page offers, in bytes. */
export const SHAKE_MIN_BYTES = 1;
/** The longest SHAKE output the page offers, in bytes. Longer outputs would make the page slow for no benefit. */
export const SHAKE_MAX_BYTES = 4096;

export type ShakeVariant = 'shake128' | 'shake256';

/** The refusal for a length outside the range. It is the sentence the page shows. */
export const SHAKE_LENGTH_MESSAGE = `SHAKE output length must be a whole number from ${SHAKE_MIN_BYTES} to ${SHAKE_MAX_BYTES}.`;

/**
 * SHAKE128 or SHAKE256 (FIPS 202) of `bytes`, `lengthBytes` long. The length is checked before anything is allocated, and
 * is always handed to the library: its defaults (16 and 32 bytes) would otherwise be a silent surprise.
 */
export function shake(bytes: Uint8Array, variant: ShakeVariant, lengthBytes: number): Uint8Array {
  if (!Number.isInteger(lengthBytes) || lengthBytes < SHAKE_MIN_BYTES || lengthBytes > SHAKE_MAX_BYTES) {
    throw new RangeError(SHAKE_LENGTH_MESSAGE);
  }
  switch (variant) {
    case 'shake128':
      return shake128(bytes, { dkLen: lengthBytes });
    case 'shake256':
      return shake256(bytes, { dkLen: lengthBytes });
    default:
      throw new RangeError('Unknown SHAKE variant.');
  }
}
