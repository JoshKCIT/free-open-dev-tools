import { MAX_VERSION_CHARACTERS } from './limits';
import type { ParsedMessage } from './parse';
import { formatVersion, increment, parseVersion, type BumpLevel, type Version } from './semver';

export type { BumpLevel } from './semver';

export interface BumpOptions {
  /** The current version, as text. Empty or absent means no current version. */
  currentVersion?: string;
  /** Raise the minor number for a breaking change while the major number is 0. */
  zeroMajor?: boolean;
}

export interface BumpResult {
  level: BumpLevel;
  /** The next version, when a current version was given and the level is not 'none'. */
  next?: string;
}

/**
 * Adds up the bump over the valid messages: any breaking change gives major; otherwise any feat gives minor; otherwise
 * any fix gives patch; otherwise there is no release. Types are not case-sensitive (rule 15). A message that is not valid
 * adds nothing. Conventional Commits 1.0.0, Summary: fix correlates with PATCH, feat with MINOR, a breaking change with
 * MAJOR; other types "have no implicit effect in Semantic Versioning (unless they include a BREAKING CHANGE)".
 */
export function bumpLevel(messages: readonly ParsedMessage[]): BumpLevel {
  let level: BumpLevel = 'none';
  for (const message of messages) {
    if (!message.valid) continue;
    if (message.breaking) return 'major';
    const type = message.type === null ? '' : message.type.toLowerCase();
    if (type === 'feat') level = 'minor';
    else if (type === 'fix' && level === 'none') level = 'patch';
  }
  return level;
}

/**
 * Reads the current version text of the options: undefined when it is empty or only white space, a refusal naming "Current
 * version" when it is not a Semantic Versioning version or is over 256 characters.
 */
export function currentVersionOf(text: string | undefined): Version | undefined {
  if (text === undefined) return undefined;
  if (text.length <= MAX_VERSION_CHARACTERS && text.trim() === '') return undefined;
  return parseVersion(text);
}

/** The bump of a set of messages and, with a current version, the version it leads to. */
export function bumpFor(messages: readonly ParsedMessage[], options: BumpOptions = {}): BumpResult {
  const current = currentVersionOf(options.currentVersion);
  const level = bumpLevel(messages);
  if (current === undefined || level === 'none') return { level };
  return { level, next: formatVersion(increment(current, level, { zeroMajor: options.zeroMajor === true })) };
}
