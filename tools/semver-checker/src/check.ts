import Range from 'semver/classes/range';
import parse from 'semver/functions/parse';
import maxSatisfying from 'semver/ranges/max-satisfying';
import minVersion from 'semver/ranges/min-version';
import { SemverCheckerError } from './errors';
import { MAX_VERSION_CHARACTERS, checkSizes } from './limits';
import { MAX_SHOWN_CHARACTERS, splitVersionLines, visible } from './lines';

/** The two options npm's semver package has for reading versions and ranges. */
export interface CheckOptions {
  /** Accept loose forms such as =1.2.3 and 1.2.3beta, and throw out parts of a range that cannot be read. */
  loose: boolean;
  /** Judge a pre-release version like any other version instead of by the pre-release rule. */
  includePrerelease: boolean;
}

export type CheckResultText = 'satisfies' | 'does not satisfy' | 'not a valid version';

export interface CheckRow {
  /** The line the version is on in what was pasted, counting blank lines. */
  line: number;
  /** The line as it is shown: control characters escaped, a line that is not a version cut at 40 characters. */
  shown: string;
  result: CheckResultText;
}

export interface CheckResult {
  /** The range as npm normalises it (npm prints nothing for a range of any version; `*` is shown instead). */
  normalized: string;
  rows: CheckRow[];
  /** The highest pasted version that satisfies the range, as it was pasted, or null when none does. */
  maxSatisfying: string | null;
  /** The lowest version the range allows, whether or not it was pasted, or null when the range allows none. */
  minVersion: string | null;
}

const UNREADABLE =
  'has a part that is not a version, a comparator such as >=1.2.3, a caret range such as ^1.2.3, a tilde range such as ~1.2.3, an x-range such as 1.x or a hyphen range such as 1.2.3 - 2.3.4';
const TOO_BIG = 'has a version number that is larger than npm can read';
const TOO_LONG = `has a version longer than ${MAX_VERSION_CHARACTERS} characters`;

/** Why one alternative cannot be read, in words that hold none of its text; undefined when it can be read. */
function reasonFor(alternative: string, options: CheckOptions): string | undefined {
  try {
    new Range(alternative, options);
    return undefined;
  } catch (error) {
    const library = error instanceof Error ? error.message : '';
    if (
      library.startsWith('Invalid major version') ||
      library.startsWith('Invalid minor version') ||
      library.startsWith('Invalid patch version')
    ) {
      return TOO_BIG;
    }
    if (library.includes('longer than')) return TOO_LONG;
    return UNREADABLE;
  }
}

/**
 * The fixed sentence for a range that cannot be read. It says which alternative (counting from 1) cannot be read and
 * why, and never repeats what was typed.
 */
function unreadableRange(range: string, options: CheckOptions): SemverCheckerError {
  const parts = range.split('||');
  if (parts.length > 1) {
    for (let i = 0; i < parts.length; i++) {
      const reason = reasonFor(parts[i] as string, options);
      if (reason !== undefined) {
        return new SemverCheckerError(
          `This is not a valid range: alternative ${i + 1} (the parts of a range are separated by ||, counting from 1) ${reason}.`,
        );
      }
    }
  } else {
    const reason = reasonFor(range, options);
    if (reason !== undefined) return new SemverCheckerError(`This is not a valid range: it ${reason}.`);
  }
  return new SemverCheckerError('This is not a valid range: it could not be read.');
}

/**
 * Reads a range once with npm's own Range class. Any error the library throws (its messages repeat the text) becomes a
 * SemverCheckerError with a fixed sentence. The size limits are checked by the callers before this runs.
 */
export function readRange(range: string, options: CheckOptions): Range {
  try {
    return new Range(range, { loose: options.loose, includePrerelease: options.includePrerelease });
  } catch {
    throw unreadableRange(range, options);
  }
}

/** The range as npm normalises it, with `*` for the empty range npm prints for any version. */
export function normalizedRange(range: Range): string {
  return range.range === '' ? '*' : range.range;
}

/**
 * Checks each pasted version against a range, exactly as npm's semver package decides: one row per non-blank line, the
 * range as npm normalises it, the highest pasted version that satisfies it and the lowest version it allows. A paste or
 * a range over the limits is refused before anything is parsed. An empty range is read as npm reads it, as any
 * version; a page decides for itself whether to show anything for one.
 */
export function checkVersions(versions: string, range: string, options: CheckOptions): CheckResult {
  checkSizes(versions, range);
  const parsedRange = readRange(range, options);
  const rows: CheckRow[] = [];
  const satisfying: string[] = [];
  for (const { line, text } of splitVersionLines(versions)) {
    const version = parse(text, { loose: options.loose });
    if (version === null) {
      rows.push({ line, shown: visible(text, MAX_SHOWN_CHARACTERS), result: 'not a valid version' });
    } else if (parsedRange.test(version)) {
      rows.push({ line, shown: visible(text, MAX_VERSION_CHARACTERS), result: 'satisfies' });
      satisfying.push(text);
    } else {
      rows.push({ line, shown: visible(text, MAX_VERSION_CHARACTERS), result: 'does not satisfy' });
    }
  }
  const highest = satisfying.length > 0 ? maxSatisfying(satisfying, parsedRange, parsedRange.options) : null;
  const lowest = minVersion(parsedRange, parsedRange.options);
  return {
    normalized: normalizedRange(parsedRange),
    rows,
    maxSatisfying: highest === null ? null : visible(highest, MAX_VERSION_CHARACTERS),
    minVersion: lowest === null ? null : lowest.version,
  };
}
