import { GlobTesterError } from './errors';
import { forEachLine, isBlank } from './lines';

/** The most pattern text that is checked at once: every pattern is tried against every path. */
export const MAX_PATTERN_CHARACTERS = 64_000;
/** The most pattern lines (blank lines do not count). */
export const MAX_PATTERN_LINES = 1_000;
/** The longest single pattern line. */
export const MAX_PATTERN_LINE_CHARACTERS = 1_000;
/** The most paths (blank lines do not count). */
export const MAX_PATH_LINES = 5_000;
/** The longest single path. */
export const MAX_PATH_CHARACTERS = 1_024;
/** The most path text: 5,000 paths of 1,024 characters and their line ends. Bounds the work before any line is read. */
export const MAX_PATH_PASTE_CHARACTERS = 5_130_000;
/** A regular expression longer than this is cut when it is shown. */
export const MAX_REGEX_SHOWN = 2_000;
/** How many other matching lines a glob row names; the rest are counted. */
export const MAX_ALSO_LINES = 20;

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

function checkLines(text: string, part: 'patterns' | 'paths', maxLines: number, maxLineCharacters: number): void {
  const noun = part === 'patterns' ? 'pattern lines' : 'paths';
  let count = 0;
  forEachLine(text, (line, number) => {
    if (line.length > maxLineCharacters) {
      throw new GlobTesterError(
        `Line ${number} of the ${part} is longer than ${withCommas(maxLineCharacters)} characters.`,
        part,
        number,
      );
    }
    if (isBlank(line)) return;
    count += 1;
    if (count > maxLines) {
      throw new GlobTesterError(
        `There are more than ${withCommas(maxLines)} ${noun} (blank lines do not count). Line ${number} is the first one past the limit of ${withCommas(maxLines)}.`,
        part,
        number,
      );
    }
  });
}

/**
 * Refuses a paste that is too big, before a single pattern is compiled or a single path is matched. A refusal names the
 * limit and, for a line, its number; it never holds any of the pasted text.
 */
export function checkInput(patterns: string, paths: string): void {
  if (patterns.length > MAX_PATTERN_CHARACTERS) {
    throw new GlobTesterError(
      `This paste is ${withCommas(patterns.length)} characters. The limit is ${withCommas(MAX_PATTERN_CHARACTERS)} because every pattern is tried against every path, and a long list of patterns can take too long.`,
      'patterns',
    );
  }
  if (paths.length > MAX_PATH_PASTE_CHARACTERS) {
    throw new GlobTesterError(
      `This paste is ${withCommas(paths.length)} characters. The limit is ${withCommas(MAX_PATH_PASTE_CHARACTERS)} because that is the most that ${withCommas(MAX_PATH_LINES)} paths of up to ${withCommas(MAX_PATH_CHARACTERS)} characters can fill.`,
      'paths',
    );
  }
  checkLines(patterns, 'patterns', MAX_PATTERN_LINES, MAX_PATTERN_LINE_CHARACTERS);
  checkLines(paths, 'paths', MAX_PATH_LINES, MAX_PATH_CHARACTERS);
}
