import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GlobTesterError,
  MAX_PATH_CHARACTERS,
  MAX_PATH_LINES,
  MAX_PATTERN_CHARACTERS,
  MAX_PATTERN_LINES,
  MAX_PATTERN_LINE_CHARACTERS,
  checkInput,
  testPatterns,
  type TestJob,
} from '../src/index';
import type { GitignoreRow } from '../src/gitignore';
import type { GlobRow } from '../src/glob';

// Expected values: the limits are the ones the plan and meta.json state (64,000 characters, 1,000 lines, 1,000
// characters a line; 5,000 paths, 1,024 characters a path), and what a refusal must contain follows the tool's own
// rule that a message names a line and never repeats pasted text. Matching expectations come from the recorded git
// decisions in the other test files and from picomatch's published examples.

let spies: { log: ReturnType<typeof makeSpy>; warn: ReturnType<typeof makeSpy>; error: ReturnType<typeof makeSpy> };

function makeSpy(method: 'log' | 'warn' | 'error') {
  return vi.spyOn(console, method).mockImplementation(() => undefined);
}

beforeEach(() => {
  spies = { log: makeSpy('log'), warn: makeSpy('warn'), error: makeSpy('error') };
});

afterEach(() => {
  spies.log.mockRestore();
  spies.warn.mockRestore();
  spies.error.mockRestore();
});

const MARKER = 'FODT-MARKER-4417';

function job(mode: 'glob' | 'gitignore', patterns: string, paths: string): TestJob {
  return { mode, patterns, paths, dot: false, nocase: false };
}

function refusal(run: () => unknown): GlobTesterError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(GlobTesterError);
    return err as GlobTesterError;
  }
  throw new Error('expected a refusal');
}

it('paths that are absolute, start with ./ or climb with ../ are refused with their line number and no path text', () => {
  const bad = [
    '/' + MARKER,
    './' + MARKER,
    '../' + MARKER + '/x',
    'a/../' + MARKER,
    'a/./' + MARKER,
    'a//' + MARKER,
    'a' + String.fromCharCode(92) + MARKER,
    'C:/' + MARKER,
  ];
  for (const mode of ['gitignore', 'glob'] as const) {
    for (const path of bad) {
      const err = refusal(() => testPatterns(job(mode, '*.log', 'ok.log\n' + path + '\nalso-ok.txt')));
      expect(err.part).toBe('paths');
      expect(err.line).toBe(2);
      expect(err.message).toContain('Line 2');
      expect(err.message).not.toContain(MARKER);
      expect(err.message).not.toContain(path);
    }
  }
  // A line number counts every pasted line, blank ones included.
  const counted = refusal(() => testPatterns(job('gitignore', '*.log', 'a.txt\n\n\n../up')));
  expect(counted.line).toBe(4);
  // A trailing slash only marks a directory and is allowed; a path that is only a slash is absolute.
  expect(() => testPatterns(job('gitignore', '*.log', 'logs/\nsrc/lib/'))).not.toThrow();
  expect(refusal(() => testPatterns(job('gitignore', '*.log', '/'))).line).toBe(1);
});

it('patterns and paths over the limits are refused before any matching', () => {
  expect(MAX_PATTERN_CHARACTERS).toBe(64_000);
  expect(MAX_PATTERN_LINES).toBe(1_000);
  expect(MAX_PATTERN_LINE_CHARACTERS).toBe(1_000);
  expect(MAX_PATH_LINES).toBe(5_000);
  expect(MAX_PATH_CHARACTERS).toBe(1_024);

  // A pattern that backtracks for seconds on long paths must never be tried: every refusal is immediate.
  const hostile = '*a*a*a*a*a*a*a*a*b';
  const longPath = 'a'.repeat(50) + 'c';

  const tooLong = refusal(() => checkInput('x'.repeat(MAX_PATTERN_CHARACTERS + 1), 'a'));
  expect(tooLong.message).toMatch(/^This paste is 64,001 characters\. The limit is 64,000 because /);
  expect(tooLong.part).toBe('patterns');

  const manyLines = refusal(() => checkInput(Array.from({ length: MAX_PATTERN_LINES + 1 }, () => 'a').join('\n'), 'a'));
  expect(manyLines.part).toBe('patterns');
  expect(manyLines.line).toBe(MAX_PATTERN_LINES + 1);

  // Blank lines are not pattern lines: 1,000 patterns with a blank line between each are allowed.
  const spaced = Array.from({ length: MAX_PATTERN_LINES }, () => 'a').join('\n\n');
  expect(() => checkInput(spaced, 'a')).not.toThrow();

  const longLine = refusal(() => checkInput('a\n' + 'b'.repeat(MAX_PATTERN_LINE_CHARACTERS + 1), 'a'));
  expect(longLine.message).toBe('Line 2 of the patterns is longer than 1,000 characters.');
  expect(longLine.line).toBe(2);
  expect(() => checkInput('b'.repeat(MAX_PATTERN_LINE_CHARACTERS), 'a')).not.toThrow();

  const manyPaths = refusal(() => checkInput('a', Array.from({ length: MAX_PATH_LINES + 1 }, () => 'p').join('\n')));
  expect(manyPaths.part).toBe('paths');
  expect(manyPaths.line).toBe(MAX_PATH_LINES + 1);
  expect(() => checkInput('a', Array.from({ length: MAX_PATH_LINES }, () => 'p').join('\n'))).not.toThrow();

  const longPathLine = refusal(() => checkInput('a', 'p\n' + 'q'.repeat(MAX_PATH_CHARACTERS + 1)));
  expect(longPathLine.message).toBe('Line 2 of the paths is longer than 1,024 characters.');
  expect(longPathLine.part).toBe('paths');
  expect(() => checkInput('a', 'q'.repeat(MAX_PATH_CHARACTERS))).not.toThrow();

  const hugePaste = refusal(() => checkInput('a', '\n'.repeat(6_000_000)));
  expect(hugePaste.part).toBe('paths');
  expect(hugePaste.message).toMatch(/^This paste is 6,000,000 characters\. The limit is /);

  // Through testPatterns, in both modes, with the hostile pattern and 5,001 long paths: refused at once. Only the two
  // calls are timed.
  const tooMany = Array.from({ length: MAX_PATH_LINES + 1 }, () => longPath).join('\n');
  const caught: unknown[] = [];
  const before = performance.now();
  for (const mode of ['gitignore', 'glob'] as const) {
    try {
      testPatterns(job(mode, hostile, tooMany));
    } catch (err) {
      caught.push(err);
    }
  }
  const elapsed = performance.now() - before;
  expect(caught).toHaveLength(2);
  for (const err of caught) {
    expect(err).toBeInstanceOf(GlobTesterError);
    expect((err as GlobTesterError).line).toBe(MAX_PATH_LINES + 1);
  }
  expect(elapsed).toBeLessThan(2_000);
});

it('messages never repeat a marker placed inside a refused pattern or path', () => {
  const messages: string[] = [];
  const collect = (run: () => unknown) => messages.push(refusal(run).message);

  collect(() => checkInput('x'.repeat(MAX_PATTERN_LINE_CHARACTERS) + MARKER, 'a'));
  collect(() => checkInput('a', 'q'.repeat(MAX_PATH_CHARACTERS) + MARKER));
  collect(() => checkInput(MARKER + 'x'.repeat(MAX_PATTERN_CHARACTERS), 'a'));
  collect(() => checkInput('a', MARKER + '\n'.repeat(6_000_000)));
  for (const mode of ['gitignore', 'glob'] as const) {
    for (const path of [
      '/' + MARKER,
      './' + MARKER,
      '../' + MARKER,
      MARKER + '/../x',
      MARKER + '//x',
      MARKER + String.fromCharCode(92) + 'x',
    ]) {
      collect(() => testPatterns(job(mode, MARKER + '*', path)));
    }
  }
  expect(messages.length).toBeGreaterThanOrEqual(16);
  for (const message of messages) {
    expect(message).not.toContain(MARKER);
    expect(message).not.toContain('FODT');
  }

  // A pattern line over the limit is named by its line only, in both modes.
  for (const mode of ['gitignore', 'glob'] as const) {
    const input = job(mode, 'a\n' + 'x'.repeat(MAX_PATTERN_LINE_CHARACTERS) + MARKER, 'a');
    expect(refusal(() => testPatterns(input)).message).toBe('Line 2 of the patterns is longer than 1,000 characters.');
  }
});

it('pattern lines named __proto__, constructor and toString are plain patterns', () => {
  const patterns = '__proto__\nconstructor\ntoString';
  const paths = '__proto__\nconstructor\ntoString\nvalueOf\nsrc/__proto__\nhasOwnProperty';

  const ignored = testPatterns(job('gitignore', patterns, paths)).rows as GitignoreRow[];
  expect(ignored.map((r) => r.ignored)).toEqual([true, true, true, false, true, false]);
  expect(ignored.map((r) => (r.decidedBy.kind === 'rule' ? r.decidedBy.line : 0))).toEqual([1, 2, 3, 0, 1, 0]);
  expect(ignored[3]?.decidedBy).toEqual({ kind: 'none' });

  const globbed = testPatterns(job('glob', patterns, paths)).rows as GlobRow[];
  expect(globbed.map((r) => r.matched)).toEqual([true, true, true, false, false, false]);
  expect(globbed.map((r) => r.line)).toEqual([1, 2, 3, null, null, null]);

  // The same names as paths with no pattern: nothing is read from an object's own members.
  const none = testPatterns(job('glob', 'nothing-here', paths)).rows as GlobRow[];
  expect(none.every((r) => !r.matched && r.line === null && r.also.length === 0)).toBe(true);
  const noneIgnore = testPatterns(job('gitignore', '# nothing', paths)).rows as GitignoreRow[];
  expect(noneIgnore.every((r) => !r.ignored && r.decidedBy.kind === 'none')).toBe(true);
});

it('rows follow the pasted path order, keep duplicates and skip blank lines', () => {
  const paths = 'b.log\n\na.log\r\nb.log\n   \nlogs/\n';
  const gi = testPatterns(job('gitignore', '*.log\n!a.log', paths));
  expect(gi.mode).toBe('gitignore');
  const giRows = gi.rows as GitignoreRow[];
  expect(giRows.map((r) => r.path + (r.isDirectory ? '/' : ''))).toEqual(['b.log', 'a.log', 'b.log', 'logs/']);
  expect(giRows.map((r) => r.ignored)).toEqual([true, false, true, false]);

  const gl = testPatterns(job('glob', '*.log\n\n!a.log', paths));
  expect(gl.mode).toBe('glob');
  const glRows = gl.rows as GlobRow[];
  expect(glRows.map((r) => r.path)).toEqual(['b.log', 'a.log', 'b.log', 'logs']);
  // *.log is line 1; !a.log (line 3) matches every path except a.log, so the directory name logs matches it too.
  expect(glRows.map((r) => r.matched)).toEqual([true, true, true, true]);
  expect(glRows.map((r) => r.line)).toEqual([1, 1, 1, 3]);

  // No paths: nothing to show. No patterns: every path reads not matched, or no rule matched.
  expect(testPatterns(job('gitignore', '*.log', '')).rows).toEqual([]);
  expect(testPatterns(job('glob', '*.log', '\n\n')).rows).toEqual([]);
  const noRules = testPatterns(job('gitignore', '', 'a.log\nb/')).rows as GitignoreRow[];
  expect(noRules.map((r) => r.decidedBy)).toEqual([{ kind: 'none' }, { kind: 'none' }]);
  const noGlobs = testPatterns(job('glob', '\n  \n', 'a.log')).rows as GlobRow[];
  expect(noGlobs).toEqual([{ path: 'a.log', matched: false, line: null, pattern: '', also: [], moreAlso: 0 }]);

  // In .gitignore mode the dot and ignore-case options are never read.
  const base = testPatterns(job('gitignore', '*.LOG\n.hidden', 'a.log\nA.LOG\n.hidden'));
  const flipped = testPatterns({
    mode: 'gitignore',
    patterns: '*.LOG\n.hidden',
    paths: 'a.log\nA.LOG\n.hidden',
    dot: true,
    nocase: true,
  });
  expect(flipped).toEqual(base);
});

it('1,000 rules against 5,000 paths finish in under 10 seconds', () => {
  // A seeded generator (mulberry32) so the input is the same on every machine.
  let seed = 0x9e3779b9;
  const next = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length) as number] as T;
  const dirs = ['src', 'lib', 'build', 'docs', 'test', 'tmp', 'vendor', 'app', 'pkg', 'bin'];
  const names = ['main', 'util', 'index', 'config', 'data', 'cache', 'out', 'log', 'notes', 'app'];
  const exts = ['js', 'ts', 'md', 'json', 'log', 'tmp', 'txt', 'css'];

  const rules: string[] = [];
  for (let i = 0; i < 1_000; i++) {
    const k = i % 5;
    if (k === 0) rules.push(`*.${pick(exts)}${i}`);
    else if (k === 1) rules.push(`${pick(dirs)}${i}/`);
    else if (k === 2) rules.push(`!${pick(names)}${i}.${pick(exts)}`);
    else if (k === 3) rules.push(`/${pick(dirs)}/${pick(names)}${i}/**/*.${pick(exts)}`);
    else rules.push(`${pick(names)}${i}`);
  }
  const paths: string[] = [];
  for (let i = 0; i < 5_000; i++) {
    const depth = 1 + Math.floor(next() * 4);
    const parts: string[] = [];
    for (let d = 0; d < depth; d++) parts.push(pick(dirs) + (next() < 0.3 ? String(Math.floor(next() * 1_000)) : ''));
    parts.push(pick(names) + (next() < 0.3 ? String(Math.floor(next() * 1_000)) : '') + '.' + pick(exts));
    paths.push(parts.join('/'));
  }

  for (const mode of ['gitignore', 'glob'] as const) {
    const input = job(mode, rules.join('\n'), paths.join('\n'));
    const before = performance.now();
    const result = testPatterns(input);
    const elapsed = performance.now() - before;
    expect(result.rows).toHaveLength(5_000);
    expect(elapsed, `${mode} took ${Math.round(elapsed)} ms`).toBeLessThan(10_000);
  }
}, 60_000);

it('nothing is written to the console while matching', () => {
  testPatterns(job('gitignore', '*.log\n!keep.log\nbuild/', 'debug.log\nkeep.log\nbuild/x.js\n'));
  testPatterns(job('glob', 'src/**/*.ts\n!(a).txt', 'src/a.ts\nb.txt\n'));
  refusal(() => testPatterns(job('glob', '*.log', '/etc')));
  refusal(() => checkInput('x'.repeat(MAX_PATTERN_CHARACTERS + 1), ''));
  expect(spies.log).not.toHaveBeenCalled();
  expect(spies.warn).not.toHaveBeenCalled();
  expect(spies.error).not.toHaveBeenCalled();
});
