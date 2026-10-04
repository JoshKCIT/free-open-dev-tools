import meta from './meta.json';
import { gitignoreRows, type GitignoreRow } from './gitignore';
import { globRows, type GlobRegex, type GlobRow } from './glob';
import { checkInput } from './limits';

export { meta };
export { GlobTesterError } from './errors';
export {
  MAX_ALSO_LINES,
  MAX_PATH_CHARACTERS,
  MAX_PATH_LINES,
  MAX_PATH_PASTE_CHARACTERS,
  MAX_PATTERN_CHARACTERS,
  MAX_PATTERN_LINES,
  MAX_PATTERN_LINE_CHARACTERS,
  MAX_REGEX_SHOWN,
  checkInput,
  withCommas,
} from './limits';
export { checkPath, forEachLine, isBlank, parsePaths, splitLines } from './lines';
export { MAX_SHOWN_PATH, MAX_SHOWN_PATTERN, visible } from './visible';
export { globRows, gitignoreRows };
export type { DecidedBy, GitignoreRow } from './gitignore';
export type { GlobRegex, GlobRow } from './glob';

/** What to test: the mode, the two pasted texts, and (glob mode only) the dot and ignore-case options. */
export interface TestJob {
  mode: 'glob' | 'gitignore';
  patterns: string;
  paths: string;
  dot: boolean;
  nocase: boolean;
}

export type TestResult =
  | { mode: 'glob'; rows: GlobRow[]; regexes: GlobRegex[] }
  | { mode: 'gitignore'; rows: GitignoreRow[]; regexes: GlobRegex[] };

/**
 * Tests every pasted path against the pasted patterns. The size of the paste is checked first, so a paste that is too
 * big is refused before anything is compiled or matched. In .gitignore mode the dot and ignore-case options are never
 * read: .gitignore matching here is always case-sensitive and the options belong to glob mode.
 */
export function testPatterns(job: TestJob): TestResult {
  checkInput(job.patterns, job.paths);
  if (job.mode === 'glob') {
    const { rows, regexes } = globRows(job.patterns, job.paths, { dot: job.dot, nocase: job.nocase });
    return { mode: 'glob', rows, regexes };
  }
  return { mode: 'gitignore', rows: gitignoreRows(job.patterns, job.paths), regexes: [] };
}
