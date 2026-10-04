import { normalizedRange, readRange, type CheckOptions } from './check';
import { checkSizes } from './limits';

export interface ExplainedComparator {
  /** npm writes a bare version and =version both as an empty operator. */
  operator: '' | '<' | '<=' | '>' | '>=' | '=';
  /** The version the comparator names, without build metadata. */
  version: string;
  /** The comparator in plain words. */
  words: string;
}

export interface ExplainedAlternative {
  /** Every comparator here must hold for a version to satisfy this alternative. */
  comparators: ExplainedComparator[];
  /** The comparators in plain words, joined with and; any version when there are none. */
  words: string;
}

export interface RangeExplanation {
  /** The range as npm normalises it. */
  normalized: string;
  /** A version satisfies the range when it satisfies any one of these. */
  alternatives: ExplainedAlternative[];
  /** The pre-release rule in words, or null when Include pre-releases is on and no rule applies. */
  prereleaseNote: string | null;
}

const NO_VERSION = 'no version at all';
const ANY_VERSION = 'any version';

const PRERELEASE_NOTE =
  'A pre-release version such as 1.3.0-beta.1 satisfies this range only when a comparator in the same alternative names the same major, minor and patch with a pre-release (for example >=1.3.0-beta.1). Tick Include pre-releases to judge pre-releases like any other version.';

interface NamedVersion {
  version: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly (string | number)[];
}

/**
 * One comparator in words. A bound written with a trailing -0 is the way npm says "below the next release, pre-releases
 * of it included" (the upper bound of ^1.2.3 is <2.0.0-0) or "from the first pre-release of this version" (a lower
 * bound when Include pre-releases is on), so those two forms read as that.
 */
function sentence(operator: string, named: NamedVersion): string {
  const core = `${named.major}.${named.minor}.${named.patch}`;
  const lowestPrerelease = named.prerelease.length === 1 && named.prerelease[0] === 0;
  switch (operator) {
    case '>=':
      return lowestPrerelease ? `${core} or higher, including its pre-releases` : `${named.version} or higher`;
    case '>':
      return `higher than ${named.version}`;
    case '<=':
      return `${named.version} or lower`;
    case '<':
      if (lowestPrerelease) {
        return core === '0.0.0' ? NO_VERSION : `lower than ${core}, with no ${core} pre-release`;
      }
      return `lower than ${named.version}`;
    default:
      return `exactly ${named.version}`;
  }
}

/**
 * Reads a range in plain words, alternative by alternative: walks the parsed range, where each alternative is a list of
 * comparators that must all hold, and says each one. The range is parsed once by npm's own Range class; the words are
 * this package's own, and the tests check that they agree with npm at and around every boundary they name.
 */
export function explainRange(range: string, options: CheckOptions): RangeExplanation {
  checkSizes('', range);
  const parsed = readRange(range, options);
  const alternatives: ExplainedAlternative[] = parsed.set.map((set) => {
    const comparators: ExplainedComparator[] = [];
    for (const comparator of set) {
      // A comparator with no version (an empty range or a bare *) holds for every version and says nothing.
      if (typeof (comparator.semver as unknown) !== 'object') continue;
      const named = comparator.semver;
      comparators.push({
        operator: comparator.operator,
        version: named.version,
        words: sentence(comparator.operator, named),
      });
    }
    return {
      comparators,
      words: comparators.length === 0 ? ANY_VERSION : comparators.map((c) => c.words).join(', and '),
    };
  });
  return {
    normalized: normalizedRange(parsed),
    alternatives,
    prereleaseNote: options.includePrerelease ? null : PRERELEASE_NOTE,
  };
}
