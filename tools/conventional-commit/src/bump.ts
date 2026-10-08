import type { ParsedMessage } from './parse';

/** What a set of commits adds up to, by the specification's SemVer lines. */
export type BumpLevel = 'major' | 'minor' | 'patch' | 'none';

export interface BumpResult {
  level: BumpLevel;
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

export function bumpFor(messages: readonly ParsedMessage[]): BumpResult {
  return { level: bumpLevel(messages) };
}
