import type SemVer from 'semver/classes/semver';
import parse from 'semver/functions/parse';
import { MAX_VERSION_CHARACTERS, checkSizes } from './limits';
import { MAX_SHOWN_CHARACTERS, splitVersionLines, visible } from './lines';

export interface SortOptions {
  /** Accept loose forms such as =1.2.3 and 1.2.3beta. */
  loose: boolean;
}

export interface SortedVersion {
  /** The version as it was pasted (trimmed), with control characters escaped. */
  shown: string;
  /** The line it is on in what was pasted, counting blank lines. */
  line: number;
  /** Its build metadata (the part after +, dot separated), or an empty string. It is shown but never ordered by. */
  build: string;
}

export interface InvalidLine {
  line: number;
  /** The line cut at 40 characters, with control characters escaped. */
  shown: string;
}

export interface SortResult {
  /** The valid versions, lowest first, in SemVer 2.0.0 precedence order. */
  sorted: SortedVersion[];
  /** The lines that are not versions, in pasted order. */
  invalid: InvalidLine[];
  /** How many sets of two or more versions are equal in precedence (they differ only in build metadata). */
  equalGroups: number;
}

/**
 * Sorts pasted versions by SemVer 2.0.0 section 11 precedence, lowest first. Each line is checked first, so a line that
 * is not a version is listed with its line number and never stops the sort (npm's own sort throws on one bad line).
 * Build metadata is ignored in precedence, as section 10 says, and the sort is stable, so versions equal in precedence
 * keep their pasted order.
 */
export function sortVersions(versions: string, options: SortOptions): SortResult {
  checkSizes(versions, '');
  const entries: { version: SemVer; line: number; text: string }[] = [];
  const invalid: InvalidLine[] = [];
  for (const { line, text } of splitVersionLines(versions)) {
    const version = parse(text, { loose: options.loose });
    if (version === null) invalid.push({ line, shown: visible(text, MAX_SHOWN_CHARACTERS) });
    else entries.push({ version, line, text });
  }
  // SemVer#compare is semver.compare: major, minor, patch, then pre-release, never build metadata.
  entries.sort((a, b) => a.version.compare(b.version));

  let equalGroups = 0;
  let runLength = 1;
  for (let i = 1; i <= entries.length; i++) {
    const previous = entries[i - 1] as { version: SemVer };
    const current = entries[i];
    if (current !== undefined && previous.version.compare(current.version) === 0) {
      runLength += 1;
    } else {
      if (runLength > 1) equalGroups += 1;
      runLength = 1;
    }
  }

  return {
    sorted: entries.map((entry) => ({
      shown: visible(entry.text, MAX_VERSION_CHARACTERS),
      line: entry.line,
      build: entry.version.build.join('.'),
    })),
    invalid,
    equalGroups,
  };
}
