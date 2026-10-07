/** The largest module this package reads; a file over this is refused from its size, before any byte is read. */
export const MAX_MODULE_BYTES = 67_108_864;
/** The longest name (module, field, export, custom section or name section entry) read, in bytes. */
export const MAX_NAME_BYTES = 65_536;
/** The most rows kept for any one list (types, imports, exports, tables, memories, globals, tags, segments, sections). */
export const MAX_ROWS = 2_000;
/** How many function bodies are listed by size, largest first. */
export const MAX_LARGEST_FUNCTIONS = 50;
/** The most pieces of printable text listed from data segments. */
export const MAX_STRINGS = 200;
/** The shortest run of printable bytes that counts as text. */
export const MIN_STRING_LENGTH = 6;
/** The most data segment bytes looked at for printable text, over all segments. */
export const MAX_STRING_SCAN_BYTES = 8_388_608;
/** The most items in the module tree. */
export const MAX_TREE_ITEMS = 2_000;
/** The most findings and notes kept; the rest are counted. */
export const MAX_NOTES = 200;
/** The most characters of a constant expression shown; the rest is counted. */
export const MAX_EXPR_PARTS = 24;
/** The most value types written out in one signature; the rest is counted. */
export const MAX_SIGNATURE_PARTS = 32;
/** The most characters of a name shown in a table cell. */
export const MAX_SHOWN_NAME = 200;
/** The most bytes of a data segment shown as a hex and text preview. */
export const MAX_PREVIEW_BYTES = 16;

/** A whole number with a comma between thousands. */
export function withCommas(value: number): string {
  const digits = String(Math.trunc(value));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0 && digits[i - 1] !== '-') out += ',';
    out += digits[i];
  }
  return out;
}
