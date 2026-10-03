/**
 * Hex text for bytes: the colon form of fingerprints and key identifiers, an integer shown without padding, and the capped
 * form for bytes the page does not decode.
 *
 * RULE (as in der.ts): no message from this file may hold a fragment of a pasted value.
 */
import { derHex } from './der';

/** The most bytes of an unknown value that are written out. */
export const MAX_HEX_BYTES = 256;

/** Upper case hex pairs with colons between, the form openssl x509 -fingerprint and key identifiers use. */
export function colonHex(bytes: Uint8Array): string {
  const pieces: string[] = [];
  for (const octet of bytes) pieces.push(octet.toString(16).padStart(2, '0').toUpperCase());
  return pieces.join(':');
}

/**
 * The content bytes of an INTEGER as upper case hex with no separators, leading zero bytes (a sign octet or padding)
 * removed and one byte kept at least: the form openssl x509 -serial prints.
 */
export function integerHex(content: Uint8Array): string {
  let skip = 0;
  while (skip < content.length - 1 && content[skip] === 0) skip++;
  return derHex(content.subarray(skip)).toUpperCase();
}

/** An unsigned big-endian number as a BigInt, exact whatever its size. */
export function bigIntOf(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const octet of bytes) value = (value << 8n) | BigInt(octet);
  return value;
}

/** Lower case hex of the bytes up to 256 of them, then the words that say how many more there were. */
export function cappedHex(bytes: Uint8Array): string {
  if (bytes.length === 0) return '(no bytes)';
  if (bytes.length <= MAX_HEX_BYTES) return derHex(bytes);
  const more = bytes.length - MAX_HEX_BYTES;
  return `${derHex(bytes.subarray(0, MAX_HEX_BYTES))} and ${more} more ${more === 1 ? 'byte' : 'bytes'}`;
}
