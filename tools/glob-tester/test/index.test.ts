import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GlobTesterError,
  MAX_PATH_CHARACTERS,
  MAX_PATH_LINES,
  MAX_PATTERN_CHARACTERS,
  MAX_PATTERN_LINES,
  MAX_PATTERN_LINE_CHARACTERS,
  MAX_SHOWN_PATH,
  MAX_SHOWN_PATTERN,
  checkInput,
  testPatterns,
  visible,
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
  // Glob mode shows a directory with the slash it was pasted with (and matches it with the slash kept).
  expect(glRows.map((r) => r.path)).toEqual(['b.log', 'a.log', 'b.log', 'logs/']);
  // *.log is line 1; !a.log (line 3) matches every path except a.log, so the directory logs/ matches it too.
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

it('1,000 rules against 5,000 paths under a re-included directory name each deciding line in well under the 5 second limit of the page', () => {
  // Everything at the top is excluded (line 1), the src directory is re-included (line 2), and 998 more lines name an
  // extension or a directory under src. Every path is five folders deep under src and ends in one of the 499 extensions
  // that a rule names, so each path is decided by one named line, and every one of the 5,000 paths lies under the
  // re-included directory, which is the case that makes a deciding-line search expensive.
  const count = 1_000;
  const rules: string[] = ['/*', '!/src/'];
  for (let i = 0; i < count - 2; i++) rules.push(i % 2 === 1 ? `*.ext${i}` : `/src/gen${i}/`);
  const paths: string[] = [];
  const expectedLine: number[] = [];
  for (let i = 0; i < 5_000; i++) {
    const segments = ['src'];
    for (let k = 0; k < 5; k++) segments.push('s' + ((i * 7919 + k * 13) % 97));
    const extension = 2 * (i % ((count - 2) >> 1)) + 1;
    paths.push(`${segments.join('/')}/f${i}.ext${extension}`);
    expectedLine.push(extension + 3);
  }
  const input = job('gitignore', rules.join('\n'), paths.join('\n'));
  // Only the code under test is timed: the input is built above and checked below.
  const before = performance.now();
  const result = testPatterns(input);
  const elapsed = performance.now() - before;
  expect(result.mode).toBe('gitignore');
  const rows = result.rows as GitignoreRow[];
  expect(rows).toHaveLength(5_000);
  expect(elapsed, `took ${Math.round(elapsed)} ms`).toBeLessThan(3_500);
  for (const [index, row] of rows.entries()) {
    expect(row.ignored).toBe(true);
    expect(row.decidedBy).toEqual({
      kind: 'rule',
      line: expectedLine[index],
      pattern: `*.ext${(expectedLine[index] as number) - 3}`,
      negated: false,
    });
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

it('shown patterns and paths have control and direction-changing characters escaped and long ones cut', () => {
  // The characters are built at run time. The set is the Unicode Standard Annex 9 direction controls (U+061C, U+200E,
  // U+200F, U+202A to U+202E, U+2066 to U+2069) and the C0 and C1 controls; the written form is a backslash, u, braces
  // and the code point in capital hex.
  const open = String.fromCodePoint(92) + 'u{';
  expect(visible(String.fromCodePoint(0x202e), 10)).toBe(open + '202E}');
  expect(visible(String.fromCodePoint(0x0), 10)).toBe(open + '0}');
  expect(visible(String.fromCodePoint(0x1b), 10)).toBe(open + '1B}');
  expect(visible(String.fromCodePoint(0x7f), 10)).toBe(open + '7F}');
  expect(visible(String.fromCodePoint(0x85), 10)).toBe(open + '85}');
  expect(visible(String.fromCodePoint(0x61c), 10)).toBe(open + '61C}');
  expect(visible(String.fromCodePoint(0x200e), 10)).toBe(open + '200E}');
  expect(visible(String.fromCodePoint(0x2066), 10)).toBe(open + '2066}');
  expect(visible(String.fromCodePoint(0x2069), 10)).toBe(open + '2069}');
  expect(visible('a' + String.fromCodePoint(0x202a) + 'b', 10)).toBe('a' + open + '202A}b');
  // Ordinary text, a space and a character outside the basic plane are shown as they are.
  expect(visible('src/a b' + String.fromCodePoint(0x1f600), 20)).toBe('src/a b' + String.fromCodePoint(0x1f600));
  // Only the first characters are kept, counted as characters rather than UTF-16 units, with an ellipsis.
  expect(MAX_SHOWN_PATTERN).toBe(40);
  expect(MAX_SHOWN_PATH).toBe(200);
  const long = 'x'.repeat(MAX_SHOWN_PATTERN + 5);
  expect(visible(long, MAX_SHOWN_PATTERN)).toBe('x'.repeat(MAX_SHOWN_PATTERN) + String.fromCodePoint(0x2026));
  expect(visible('x'.repeat(MAX_SHOWN_PATTERN), MAX_SHOWN_PATTERN)).toBe('x'.repeat(MAX_SHOWN_PATTERN));
  expect(visible(String.fromCodePoint(0x1f600).repeat(3), 2)).toBe(
    String.fromCodePoint(0x1f600).repeat(2) + String.fromCodePoint(0x2026),
  );
});

it('characters that show nothing are shown as escapes, so a hidden character in a pattern or path can be seen', () => {
  // The review's example: src/a, a zero width space, .ts reads as src/a.ts and is a different path. Soft hyphen, no-break
  // space, line separator, byte order mark, the Braille blank (a pattern of dots that draws nothing) and the other
  // invisible characters are escaped too. Built at run time (a file-writing tool can turn written escapes into characters).
  const open = String.fromCodePoint(92) + 'u{';
  const hidden = [
    0xad, 0xa0, 0x34f, 0x1680, 0x180e, 0x2000, 0x200a, 0x200b, 0x200c, 0x200d, 0x2028, 0x2029, 0x202f, 0x205f, 0x2060,
    0x3000, 0x3164, 0xfe0f, 0xfeff, 0xffa0, 0x2800, 0xe0020, 0x1d173,
  ];
  for (const point of hidden) {
    const shown = visible('a' + String.fromCodePoint(point) + 'b', 10);
    expect(shown, 'U+' + point.toString(16)).toBe('a' + open + point.toString(16).toUpperCase() + '}b');
  }
  expect(visible('src/a' + String.fromCodePoint(0x200b) + '.ts', 20)).toBe('src/a' + open + '200B}.ts');
  // A lone surrogate is shown as an escape as well, and a pair as the character it makes.
  expect(visible(String.fromCharCode(0xd800), 10)).toBe(open + 'D800}');
  expect(visible(String.fromCodePoint(0x1f600), 10)).toBe(String.fromCodePoint(0x1f600));
  // Visible characters next to the hidden ones are left alone: the other Braille patterns, accented letters, CJK text.
  for (const point of [0x2801, 0x28ff, 0xfc, 0x65e5, 0x20, 0x2e, 0x1f600]) {
    expect(visible(String.fromCodePoint(point), 10)).toBe(String.fromCodePoint(point));
  }
});
