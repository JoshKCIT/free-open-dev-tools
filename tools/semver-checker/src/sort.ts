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
  /** How many sets of two or more versions are equal in precedence. */
  equalGroups: number;
  /**
   * How many of those sets differ only in build metadata: the pasted text of each, without its build, is the same, and the
   * builds are not all the same. A repeated version, a leading v, or a loose leading equals sign makes a set that is equal
   * in precedence but is not that. Left out when there is no equal set.
   */
  buildOnlyGroups?: number;
  /** A sentence about the equal sets that says only what is true of them, or left out when there is none. */
  equalNote?: string;
}

/** The text of a pasted version up to its build metadata (the part after the first plus sign). */
function withoutBuild(text: string): string {
  const plus = text.indexOf('+');
  return plus < 0 ? text : text.slice(0, plus);
}

function sets(count: number): string {
  return count === 1 ? '1 set of versions is' : `${count} sets of versions are`;
}

/** What to say about the sets of versions that are equal in precedence, and only what is true of them. */
function noteFor(equalGroups: number, buildOnlyGroups: number): string {
  const kept = 'Each set keeps the order you pasted it in.';
  if (buildOnlyGroups === equalGroups) {
    return `${sets(equalGroups)} equal in precedence: they differ only in build metadata (the part after +), which SemVer 2.0.0 ignores when ordering. ${kept}`;
  }
  if (buildOnlyGroups === 0) {
    return `${sets(equalGroups)} equal in precedence: SemVer 2.0.0 gives them the same place in the order, whether the same version is pasted twice or written two ways. ${kept}`;
  }
  return `${sets(equalGroups)} equal in precedence, and ${buildOnlyGroups} of them differ only in build metadata (the part after +), which SemVer 2.0.0 ignores when ordering. ${kept}`;
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
  let buildOnlyGroups = 0;
  let runStart = 0;
  for (let i = 1; i <= entries.length; i++) {
    const previous = entries[i - 1] as { version: SemVer };
    const current = entries[i];
    if (current !== undefined && previous.version.compare(current.version) === 0) continue;
    if (i - runStart > 1) {
      equalGroups += 1;
      const run = entries.slice(runStart, i);
      const texts = new Set(run.map((entry) => withoutBuild(entry.text)));
      const builds = new Set(run.map((entry) => entry.version.build.join('.')));
      if (texts.size === 1 && builds.size > 1) buildOnlyGroups += 1;
    }
    runStart = i;
  }
  const equal = equalGroups > 0 ? { buildOnlyGroups, equalNote: noteFor(equalGroups, buildOnlyGroups) } : {};

  return {
    sorted: entries.map((entry) => ({
      shown: visible(entry.text, MAX_VERSION_CHARACTERS),
      line: entry.line,
      build: entry.version.build.join('.'),
    })),
    invalid,
    equalGroups,
    ...equal,
  };
}
