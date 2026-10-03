/**
 * Linear scans for the rule tables.
 *
 * Every rule of this package is a bounded character-class scan over a precomputed table, a limited split on a fixed
 * delimiter, or a fixed-length comparison. There is no regular expression with a nested or ambiguous quantifier and none
 * that is anchored to the end of a line after a repeat: such a pattern costs time in proportion to the square of the line
 * length on hostile input (for example a long run of "=" followed by one other character). Trailing padding is counted
 * by an index loop that walks backwards from the end instead.
 */

/** A table of the 128 ASCII characters: 1 where the character is in the class, 0 where it is not. Built once per class. */
export function classTable(chars: string): Uint8Array {
  const table = new Uint8Array(128);
  for (let i = 0; i < chars.length; i++) {
    const code = chars.charCodeAt(i);
    if (code < 128) table[code] = 1;
  }
  return table;
}

/**
 * True when every character of s from index `from` up to but not including `to` is in the class. One pass, stopping at
 * the first character outside it. An empty range is false: a field that has to be made of these characters is never empty.
 */
export function only(s: string, table: Uint8Array, from = 0, to: number = s.length): boolean {
  if (to <= from || to > s.length) return false;
  for (let i = from; i < to; i++) {
    const code = s.charCodeAt(i);
    if (code > 127 || table[code] !== 1) return false;
  }
  return true;
}

/** How many times the one-character string `ch` ends s: an index loop from the end, never a pattern anchored to the end. */
export function countTrailing(s: string, ch: string): number {
  const code = ch.charCodeAt(0);
  let count = 0;
  for (let i = s.length - 1; i >= 0 && s.charCodeAt(i) === code; i--) count++;
  return count;
}

/** The sentence added to a hexadecimal candidate when the digits are upper case (case does not change a digest's value). */
export function upperNote(line: string): string {
  return !only(line, HEX_LOWER) && only(line, HEX_UPPER)
    ? ' The digits are upper case, which does not change the value.'
    : '';
}

/** The crypt(3) alphabet that libxcrypt writes salts and hashes in: ./0-9A-Za-z (not the RFC 4648 Base64 alphabet). */
export const ITOA = classTable('./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');
export const DIGITS = classTable('0123456789');
export const HEX_LOWER = classTable('0123456789abcdef');
export const HEX_UPPER = classTable('0123456789ABCDEF');
export const HEX = classTable('0123456789abcdefABCDEF');
/** RFC 4648 section 4 alphabet, without the padding character. */
export const BASE64 = classTable('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/');
/** RFC 4648 section 5 alphabet, without the padding character. */
export const BASE64_URL = classTable('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_');
