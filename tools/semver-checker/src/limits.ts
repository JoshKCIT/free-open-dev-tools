import { SemverCheckerError } from './errors';
import { forEachLine } from './lines';

/** The most pasted version text that is read at once. */
export const MAX_INPUT_CHARACTERS = 262_144;
/** The most version lines (blank lines do not count). */
export const MAX_LINES = 20_000;
/** The longest single version: npm's semver package refuses anything longer. */
export const MAX_VERSION_CHARACTERS = 256;
/** The longest range. */
export const MAX_RANGE_CHARACTERS = 1_000;
/** The most alternatives in a range, joined by ||. */
export const MAX_ALTERNATIVES = 500;

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

/** How many alternatives a range has: the parts between || (an empty part counts), found without splitting it. */
function countAlternatives(range: string): number {
  let count = 1;
  let from = 0;
  for (;;) {
    const bars = range.indexOf('||', from);
    if (bars < 0) return count;
    count += 1;
    from = bars + 2;
  }
}

/**
 * Refuses a paste that is too big, before a single version is read or a range is parsed. A refusal names the limit and,
 * for a line, its number; it never holds any of the pasted text.
 */
export function checkSizes(versions: string, range: string): void {
  if (versions.length > MAX_INPUT_CHARACTERS) {
    throw new SemverCheckerError(
      `This paste is ${withCommas(versions.length)} characters. The limit is ${withCommas(MAX_INPUT_CHARACTERS)} because a longer list would make the page slow to answer.`,
    );
  }
  if (range.length > MAX_RANGE_CHARACTERS) {
    throw new SemverCheckerError(
      `The range is ${withCommas(range.length)} characters. The limit is ${withCommas(MAX_RANGE_CHARACTERS)} characters because a longer range would make the page slow to answer.`,
    );
  }
  if (countAlternatives(range) > MAX_ALTERNATIVES) {
    throw new SemverCheckerError(
      `The range has more than ${withCommas(MAX_ALTERNATIVES)} alternatives joined by ||. The limit is ${withCommas(MAX_ALTERNATIVES)} alternatives.`,
    );
  }
  let count = 0;
  forEachLine(versions, (line, number) => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    if (trimmed.length > MAX_VERSION_CHARACTERS) {
      throw new SemverCheckerError(
        `This line is longer than ${MAX_VERSION_CHARACTERS} characters, which is the longest version npm's semver package reads.`,
        number,
      );
    }
    count += 1;
    if (count > MAX_LINES) {
      throw new SemverCheckerError(
        `There are more than ${withCommas(MAX_LINES)} lines of versions (blank lines do not count). Line ${number} is the first one past the limit of ${withCommas(MAX_LINES)}.`,
        number,
      );
    }
  });
}
