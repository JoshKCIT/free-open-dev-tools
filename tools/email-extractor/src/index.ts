import meta from './meta.json';

export { meta };

export type PatternKind = 'email' | 'url' | 'ipv4' | 'ipv6' | 'phone';

/** The five kinds this tool looks for, in the order results are reported when they tie on position. */
export const PATTERN_KINDS: PatternKind[] = ['email', 'url', 'ipv4', 'ipv6', 'phone'];

export interface Extracted {
  kind: PatternKind;
  value: string;
  index: number;
  count: number;
}

export interface ExtractOptions {
  /** Which kinds to look for. Default: all five. */
  kinds?: PatternKind[];
  /** Collapse repeated identical (kind, value) pairs into one entry with a count. Default true. */
  dedupe?: boolean;
}

/**
 * RED-phase stub (TDD): intentionally finds nothing, so the tests below fail
 * on the real behaviour they assert, not on a missing export. Task 2 of
 * .planning/phases/03-text-time-and-reference-tables/03-03-PLAN.md replaces
 * this with the real pattern extraction.
 */
export function extractPatterns(_text: string, _options: ExtractOptions = {}): Extracted[] {
  return [];
}

/** RED-phase stub: real validation lands with the GREEN commit. */
export function isIPv4(_text: string): boolean {
  return false;
}

/** RED-phase stub: real validation lands with the GREEN commit. */
export function isIPv6(_text: string): boolean {
  return false;
}
