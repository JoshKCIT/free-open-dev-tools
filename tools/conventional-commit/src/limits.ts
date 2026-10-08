import { ConventionalCommitError } from './errors';

/** The longest paste that is read, in characters (UTF-16 units). Checked before anything else is done with the paste. */
export const MAX_PASTE_CHARACTERS = 200_000;
/** The most messages that are read; later ones are counted and not read. */
export const MAX_MESSAGES = 1_000;
/** The most lines one message may hold. */
export const MAX_LINES_PER_MESSAGE = 2_000;
/** The longest line, in characters. A longer line is refused with its number. */
export const MAX_LINE_CHARACTERS = 10_000;
/** The most footers one message may hold. */
export const MAX_FOOTERS = 100;
/** The longest version text, in characters. The Semantic Versioning expression only ever runs on text this short. */
export const MAX_VERSION_CHARACTERS = 256;
/** The longest separator line, in characters. */
export const MAX_SEPARATOR_CHARACTERS = 100;
/** How many rows (messages or notes) a page shows before it says how many more there are. */
export const MAX_TABLE_ROWS = 500;
/** How many lines of the draft changelog a page shows before it says how many more there are. */
export const MAX_CHANGELOG_LINES = 1_000;
/** How many characters of a header a page shows in a table cell. */
export const MAX_SHOWN_HEADER = 80;
/** How many characters of an entry the draft changelog holds before it is cut. */
export const MAX_ENTRY_CHARACTERS = 500;
/** How many characters of pasted text any note or sentence may show. */
export const MAX_SHOWN_CHARACTERS = 40;

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

/** Refuses a paste over the length limit, before anything else is done with it. */
export function checkPasteLength(text: string): void {
  if (text.length > MAX_PASTE_CHARACTERS) {
    throw new ConventionalCommitError(
      `The paste is ${withCommas(text.length)} characters long and this page reads at most ${withCommas(MAX_PASTE_CHARACTERS)}. Paste fewer messages.`,
      'messages',
    );
  }
}

/** Refuses a line over the length limit, naming its pasted line number. */
export function checkLineLength(line: string, number: number): void {
  if (line.length > MAX_LINE_CHARACTERS) {
    throw new ConventionalCommitError(
      `Line ${number} is ${withCommas(line.length)} characters long and this page reads lines of at most ${withCommas(MAX_LINE_CHARACTERS)}.`,
      'messages',
      number,
    );
  }
}
