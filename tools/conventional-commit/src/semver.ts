import { ConventionalCommitError } from './errors';
import { MAX_VERSION_CHARACTERS, withCommas } from './limits';

/** What a set of commits adds up to, by the specification's SemVer lines. */
export type BumpLevel = 'major' | 'minor' | 'patch' | 'none';

/** A Semantic Versioning 2.0.0 version. The three numbers are BigInt, so a number of any length is exact. */
export interface Version {
  major: bigint;
  minor: bigint;
  patch: bigint;
  /** The dot separated identifiers after the first hyphen; empty when there is none. */
  prerelease: string[];
  /** The dot separated identifiers after the plus sign; empty when there is none. */
  build: string[];
}

/**
 * The official regular expression of Semantic Versioning 2.0.0 (semver.org, CC BY 3.0), with its numbered groups: 1 major,
 * 2 minor, 3 patch, 4 pre-release, 5 build. It only ever runs on text of at most MAX_VERSION_CHARACTERS characters.
 */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const NOT_A_VERSION =
  'Current version is not a Semantic Versioning 2.0.0 version. Write it as major.minor.patch, for example 1.4.2, with an optional -pre-release and +build part.';

/**
 * Reads a version. The length is checked first (over 256 characters is refused before the expression runs), then white
 * space around the version is dropped, then the official expression decides. A refusal names the field, "Current version",
 * and never repeats the text.
 */
export function parseVersion(text: string): Version {
  if (text.length > MAX_VERSION_CHARACTERS) {
    throw new ConventionalCommitError(
      `Current version is ${withCommas(text.length)} characters long and this page reads at most ${MAX_VERSION_CHARACTERS}.`,
      'currentVersion',
    );
  }
  const trimmed = text.trim();
  const match = SEMVER.exec(trimmed);
  if (match === null) {
    const first = trimmed.charCodeAt(0);
    const second = trimmed.charCodeAt(1);
    const leadingV = (first === 118 || first === 86) && second >= 48 && second <= 57;
    throw new ConventionalCommitError(
      leadingV ? `${NOT_A_VERSION} A leading v is not part of a version.` : NOT_A_VERSION,
      'currentVersion',
    );
  }
  return {
    major: BigInt(match[1] as string),
    minor: BigInt(match[2] as string),
    patch: BigInt(match[3] as string),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
    build: match[5] === undefined ? [] : match[5].split('.'),
  };
}

/** The version as text: major.minor.patch, then -pre-release and +build when there are any. */
export function formatVersion(version: Version): string {
  let out = `${version.major}.${version.minor}.${version.patch}`;
  if (version.prerelease.length > 0) out += `-${version.prerelease.join('.')}`;
  if (version.build.length > 0) out += `+${version.build.join('.')}`;
  return out;
}

/**
 * Raises a version by a level, as Semantic Versioning 2.0.0 items 6, 7 and 8 say: a patch raise adds one to the patch
 * number, a minor raise adds one to the minor number and resets the patch to 0, a major raise adds one to the major number
 * and resets the other two. With `zeroMajor`, a major raise of a version whose major number is 0 raises the minor number
 * instead (item 4 lets anything change below 1.0.0, so this is the caller's choice).
 *
 * A version with a pre-release tag comes before the release with the same numbers (items 9 and 11: 2.0.0-rc.1 is lower
 * than 2.0.0), so that release is still to come and is where the next release goes when it covers the change. The
 * specification does not say how to raise such a version; this is the usual rule: the tag is dropped, and a number is
 * raised only when the release does not already cover the level. Major: the numbers are kept when minor and patch are 0
 * (2.0.0-rc.1 gives 2.0.0), otherwise major is raised. Minor: kept when patch is 0 (1.5.0-rc.1 gives 1.5.0), otherwise
 * minor is raised. Patch: always kept (1.5.2-rc.1 gives 1.5.2). The zero major option reads a breaking change as a minor
 * raise in the same way. Build text alone is no pre-release (item 10): it is dropped and the version is raised as usual.
 */
export function increment(version: Version, level: BumpLevel, options: { zeroMajor?: boolean } = {}): Version {
  const { major, minor, patch } = version;
  const pre = version.prerelease.length > 0;
  const minorRaise = (): [bigint, bigint, bigint] =>
    pre && patch === 0n ? [major, minor, 0n] : [major, minor + 1n, 0n];
  let next: [bigint, bigint, bigint];
  if (level === 'major') {
    if (options.zeroMajor === true && major === 0n) next = minorRaise();
    else next = pre && minor === 0n && patch === 0n ? [major, 0n, 0n] : [major + 1n, 0n, 0n];
  } else if (level === 'minor') {
    next = minorRaise();
  } else if (level === 'patch') {
    next = pre ? [major, minor, patch] : [major, minor, patch + 1n];
  } else {
    next = [major, minor, patch];
  }
  return { major: next[0], minor: next[1], patch: next[2], prerelease: [], build: [] };
}
