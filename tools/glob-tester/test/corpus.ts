import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads the two corpora recorded with git's own commands (see fixtures/README.md and fixtures/record-git-corpus.mjs).
 * The tests never run git: they read what git answered when the corpora were recorded.
 */

export interface GitCase {
  id: string;
  /** The text of the .gitignore file, byte order mark and CR included. */
  text: string;
  /** One number per path: 0 no rule matched, n ignored by line n, -n a negation on line n matched (not ignored). */
  r: string;
  /** The pattern text git printed for each deciding line. */
  printed: Record<string, string>;
}

export interface GitCorpus {
  gitVersion: string;
  recordedAt: string;
  config: Record<string, string>;
  commands: string[];
  /** A trailing slash marks a directory. */
  paths: string[];
  cases: GitCase[];
}

export interface PathspecCorpus {
  gitVersion: string;
  recordedAt: string;
  config: Record<string, string>;
  commands: string[];
  files: string[];
  patterns: { pattern: string; matches: string }[];
}

function read<T>(name: string): T {
  const path = fileURLToPath(new URL('./fixtures/' + name, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export const gitCorpus: GitCorpus = read<GitCorpus>('git-corpus.json');
export const pathspecCorpus: PathspecCorpus = read<PathspecCorpus>('git-pathspec-corpus.json');

export function gitCase(id: string): GitCase {
  const found = gitCorpus.cases.find((c) => c.id === id);
  if (found === undefined) throw new Error('no such corpus case: ' + id);
  return found;
}

export interface GitDecision {
  /** Whether git printed any rule for the path. */
  matched: boolean;
  ignored: boolean;
  /** The line git printed, 0 when no rule matched. */
  line: number;
  /** The pattern text git printed, empty when no rule matched. */
  pattern: string;
}

/** What git decided for the path at `index` of the corpus, for one case. */
export function gitDecision(c: GitCase, index: number): GitDecision {
  const value = Number(c.r.split(',')[index]);
  const line = Math.abs(value);
  return {
    matched: value !== 0,
    ignored: value > 0,
    line,
    pattern: value === 0 ? '' : (c.printed[String(line)] ?? ''),
  };
}

export function pathIndex(path: string): number {
  const index = gitCorpus.paths.indexOf(path);
  if (index < 0) throw new Error('no such corpus path: ' + path);
  return index;
}
