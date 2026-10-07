/*
 * Every cap of the reader in one place. They are checked before the work they bound, so a hostile input costs a bounded
 * amount of time and memory (a paste or file is refused by size before it is read; a count or length read from the data is
 * compared with the bytes that remain before anything is sliced or sized).
 */

/** Most characters of pasted text that are read (5 MiB). */
export const MAX_PASTE_CHARS = 5_242_880;
/** Most bytes of an opened file that are read (10 MiB). */
export const MAX_FILE_BYTES = 10_485_760;
/** Most levels of nesting that are read. This is the level cap of the page's tree block, so every element read can be drawn. */
export const MAX_DEPTH = 40;
/** Most elements read; reading stops there and says how many bytes were left. */
export const MAX_NODES = 100_000;
/** Most length octets of a long-form length (X.690 8.1.3.5 allows 126; 8 octets reach 2 to the 64). */
export const MAX_LENGTH_OCTETS = 8;
/** Most octets of a high tag number (35 bits). */
export const MAX_TAG_OCTETS = 5;
/** Longest object identifier read, in content bytes. */
export const MAX_OID_BYTES = 512;
/** Longest INTEGER written out in decimal, in content bytes; a longer one is shown as its size and the start of its hex. */
export const MAX_DECIMAL_BYTES = 64;
/** Most bytes of a value shown as hex. */
export const MAX_HEX_SHOWN = 64;
/** Most characters of a string value shown. */
export const MAX_TEXT_SHOWN = 200;
/** Most bytes tried as nested ASN.1 inside OCTET STRING and BIT STRING contents, summed over all attempts. */
export const INSIDE_BUDGET_BYTES = 33_554_432;
/** Most findings and notes kept; the rest are counted. */
export const MAX_NOTES = 200;
/** Most rows of the flat element table. */
export const MAX_FLAT_ROWS = 5_000;
/** Most PEM blocks read from one paste. */
export const MAX_PEM_BLOCKS = 100;
/** Most elements the tree draws before it says so (the block's own cap); Copy always gives every element read. */
export const TREE_DRAWN_NODES = 5_000;

/** A count with a comma between each group of three digits, with no locale involved. */
export function withCommas(n: number): string {
  const digits = String(Math.trunc(n));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0 && digits[i - 1] !== '-') out += ',';
    out += digits[i];
  }
  return out;
}
