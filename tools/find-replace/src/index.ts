import meta from './meta.json';

export { meta };

export class FindReplaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FindReplaceError';
  }
}

export interface FindReplaceOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  multiline?: boolean;
}

export interface FindReplaceResult {
  output: string;
  count: number;
}

/**
 * RED-phase stub (TDD): intentionally naive so the tests below fail on the
 * real behaviour they assert, not on a missing export. Task 2 of
 * .planning/phases/03-text-time-and-reference-tables/03-01-PLAN.md replaces
 * this with the real literal find-and-replace implementation.
 */
export function findReplace(
  input: string,
  _find: string,
  _replacement: string,
  _options: FindReplaceOptions = {},
): FindReplaceResult {
  return { output: input, count: 0 };
}
