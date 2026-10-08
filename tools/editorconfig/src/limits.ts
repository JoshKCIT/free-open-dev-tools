/** The most files one paste may hold, the top file and every file that starts with a folder line included. */
export const MAX_FILES = 50;
/** The longest paste that is read, in characters (UTF-16 units). Checked before anything else is done with the paste. */
export const MAX_TOTAL_CHARACTERS = 1_000_000;
/** The most lines the whole paste may hold. */
export const MAX_TOTAL_LINES = 10_000;
/** The longest line, in characters. A longer line is refused with its file and line. */
export const MAX_LINE_CHARACTERS = 8_192;
/** The longest section name, key and value the specification says every core must accept. */
export const MAX_SECTION_NAME = 1_024;
export const MAX_KEY = 1_024;
export const MAX_VALUE = 4_096;
/** The longest file path and the longest folder name, in characters. */
export const MAX_PATH = 1_024;
export const MAX_FOLDER = 1_024;
/**
 * The matching work one resolution may do. Every section that is tried against the path costs its number of instructions
 * times the length of the path, and a number range counts for twelve instructions because it looks at up to eleven
 * characters at each place it can start. A paste that would need more is refused in plain words, so no input can keep the
 * page busy: this takes the place of a timer.
 */
export const WORK_BUDGET = 40_000_000;
/** How many items a list on the page shows before it says how many more there are. */
export const MAX_LISTED = 50;
/** How many characters of pasted text any sentence may show. */
export const MAX_SHOWN_CHARACTERS = 40;
/** How many characters of pasted text a table cell may show. */
export const MAX_SHOWN_CELL = 200;
/** The widest end of a number range, in digits. */
export const MAX_RANGE_DIGITS = 9;

/** A whole number with a comma between thousands, the same in every locale. */
export function withCommas(value: number): string {
  const digits = String(value);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}
