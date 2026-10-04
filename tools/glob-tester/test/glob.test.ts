import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import picomatch from 'picomatch';
import { globRows } from '../src/glob';
import { meta as toolMeta } from '../src/index';
import { pathspecCorpus } from './corpus';

// Every call the tool makes to picomatch is recorded (and passed on unchanged), so a test can see the options it was
// given. picomatch decides what to do about backslashes from the `windows` option, and when that option is missing it
// asks the platform: the tool must never leave it out.
const picomatchCalls = vi.hoisted(() => ({ matcher: [] as unknown[], makeRe: [] as unknown[] }));

vi.mock('picomatch', async (importOriginal) => {
  const real = (await importOriginal<{ default: typeof picomatch }>()).default;
  const wrapped = ((glob: string, options?: Parameters<typeof real>[1]) => {
    picomatchCalls.matcher.push(options);
    return real(glob, options);
  }) as typeof real;
  wrapped.makeRe = (glob, options) => {
    picomatchCalls.makeRe.push(options);
    return real.makeRe(glob, options);
  };
  return { default: wrapped };
});

// Expected values: (1) git's own `git ls-files -- ":(glob)<pattern>"` answers on the recorded pathspec corpus, for the
// patterns made only of *, ?, brackets and ** that picomatch and git both define; (2) the examples published in the
// picomatch README at its 4.0.7 tag (https://github.com/micromatch/picomatch/blob/4.0.7/README.md); (3) Bash 5.2.37
// (`shopt -s extglob nullglob globstar`, run once on the files listed below) for the three places where picomatch
// documents that it departs from Bash. A listed difference must really differ, and each class is stated in limits.

let spies: { log: ReturnType<typeof makeSpy>; warn: ReturnType<typeof makeSpy>; error: ReturnType<typeof makeSpy> };

function makeSpy(method: 'log' | 'warn' | 'error') {
  return vi.spyOn(console, method).mockImplementation(() => undefined);
}

beforeEach(() => {
  spies = { log: makeSpy('log'), warn: makeSpy('warn'), error: makeSpy('error') };
});

afterEach(() => {
  expect(spies.log).not.toHaveBeenCalled();
  expect(spies.warn).not.toHaveBeenCalled();
  expect(spies.error).not.toHaveBeenCalled();
  spies.log.mockRestore();
  spies.warn.mockRestore();
  spies.error.mockRestore();
  vi.unstubAllGlobals();
});

const UMLAUT = String.fromCodePoint(0xfc);

interface PathspecDifference {
  pattern: string;
  path: string;
  /** Who lists the path: git only, or picomatch only. */
  who: 'git-only' | 'picomatch-only';
  diffClass: 'bang-in-brackets' | 'globstar-matches-directory' | 'utf8-bytes';
}

// picomatch reads [!a] as the characters ! and a, not as "not a" (its README states it); git reads it as negation.
const BANG_GIT_ONLY = [
  'b.log',
  'b.js',
  'foo',
  'foo.txt',
  'README.md',
  '.hidden',
  '.eslintrc.js',
  UMLAUT + 'ber.txt',
  'ber.txt',
  'A.txt',
  'NOTES.TXT',
  '1.txt',
  'x',
  'z.ts',
];
const BANG_PICOMATCH_ONLY = [
  'a.txt',
  'a.js',
  'ab.js',
  'a b.txt',
  'a*b.txt',
  'ab',
  'ab.log',
  'a.log',
  'a.l g',
  'a_b.txt',
];

const PATHSPEC_DIFFERENCES: PathspecDifference[] = [
  ...BANG_GIT_ONLY.map((path): PathspecDifference => ({
    pattern: '[!a]*',
    path,
    who: 'git-only',
    diffClass: 'bang-in-brackets',
  })),
  ...BANG_PICOMATCH_ONLY.map((path): PathspecDifference => ({
    pattern: '[!a]*',
    path,
    who: 'picomatch-only',
    diffClass: 'bang-in-brackets',
  })),
  // picomatch matches src for src/** (its documentation says so); the :(glob) pathspec lists only what is under it.
  { pattern: 'foo/**', path: 'foo', who: 'picomatch-only', diffClass: 'globstar-matches-directory' },
  { pattern: '**/.hidden/**', path: '.hidden', who: 'picomatch-only', diffClass: 'globstar-matches-directory' },
  // git compares UTF-8 bytes (? is one byte, and a bracket holds one byte); picomatch compares characters.
  { pattern: '?ber.txt', path: UMLAUT + 'ber.txt', who: 'picomatch-only', diffClass: 'utf8-bytes' },
  { pattern: '??ber.txt', path: UMLAUT + 'ber.txt', who: 'git-only', diffClass: 'utf8-bytes' },
  { pattern: '[' + UMLAUT + ']ber.txt', path: UMLAUT + 'ber.txt', who: 'picomatch-only', diffClass: 'utf8-bytes' },
];

const CLASS_STATED_IN_LIMITS: Record<PathspecDifference['diffClass'], RegExp> = {
  'bang-in-brackets': /\[!a\]/,
  'globstar-matches-directory': /\/\*\* also matches/,
  'utf8-bytes': /UTF-8/,
};

function matchedPaths(pattern: string, files: string[], options: { dot: boolean; nocase: boolean }): Set<string> {
  const { rows } = globRows(pattern, files.join('\n'), options);
  expect(rows).toHaveLength(files.length);
  return new Set(rows.filter((r) => r.matched).map((r) => r.path));
}

it('glob mode agrees with git pathspec glob matching on the recorded corpus except the listed differences, each named in limits', () => {
  expect(pathspecCorpus.gitVersion).toMatch(/^git version \d+\.\d+/);
  expect(pathspecCorpus.patterns.length).toBeGreaterThanOrEqual(30);

  const found: string[] = [];
  let pairs = 0;
  for (const { pattern, matches } of pathspecCorpus.patterns) {
    const git = new Set(matches === '' ? [] : matches.split(',').map((i) => pathspecCorpus.files[Number(i)] as string));
    const ours = matchedPaths(pattern, pathspecCorpus.files, { dot: true, nocase: false });
    for (const file of pathspecCorpus.files) {
      pairs += 1;
      if (ours.has(file) && !git.has(file)) found.push(`${pattern} | ${file} | picomatch-only`);
      if (!ours.has(file) && git.has(file)) found.push(`${pattern} | ${file} | git-only`);
    }

    // With dotfiles off, picomatch drops only paths that have a segment starting with a dot (its documented default),
    // and never adds one.
    const without = matchedPaths(pattern, pathspecCorpus.files, { dot: false, nocase: false });
    for (const file of without) expect(ours.has(file)).toBe(true);
    for (const file of ours) {
      if (!without.has(file)) expect(file.split('/').some((segment) => segment.startsWith('.'))).toBe(true);
    }
  }

  const listed = PATHSPEC_DIFFERENCES.map((d) => `${d.pattern} | ${d.path} | ${d.who}`);
  expect(found.slice().sort()).toEqual(listed.slice().sort());
  expect(pairs).toBe(pathspecCorpus.patterns.length * pathspecCorpus.files.length);

  const limits = toolMeta.limits.join('\n');
  for (const diffClass of new Set(PATHSPEC_DIFFERENCES.map((d) => d.diffClass))) {
    expect(limits, `limits must state the class ${diffClass}`).toMatch(CLASS_STATED_IN_LIMITS[diffClass]);
  }
});

it('glob mode matches each path as picomatch 4.0.7 does with windows false whatever the platform reports', () => {
  const BACKSLASH = String.fromCharCode(92);
  const cases: { pattern: string; paths: string[]; expected: boolean[] }[] = [
    // A backslash escapes the star, so only the literal text a*b matches.
    { pattern: 'a' + BACKSLASH + '*b', paths: ['a*b', 'a/xb', 'axb'], expected: [true, false, false] },
    // Examples from the picomatch README at its 4.0.7 tag.
    { pattern: '*.js', paths: ['abcd', 'a.js', 'a.md', 'a/b.js'], expected: [false, true, false, false] },
    { pattern: '*.!(*a)', paths: ['a.a', 'a.b'], expected: [false, true] },
    { pattern: 'a*(z)', paths: ['a', 'az', 'azzz'], expected: [true, true, true] },
    { pattern: 'a+(z)', paths: ['a', 'az', 'azzz'], expected: [false, true, true] },
    { pattern: '!(foo).!(bar)', paths: ['foo.bar'], expected: [false] },
    { pattern: '!(!(foo)).!(!(bar))', paths: ['foo.bar'], expected: [true] },
    { pattern: 'a/*', paths: ['a/b', 'a/b/c'], expected: [true, false] },
    { pattern: 'src/**/*.js', paths: ['src/a.js', 'src/x/y/a.js', 'lib/a.js'], expected: [true, true, false] },
  ];
  // The regular expression picomatch writes for a posix path, asked for with windows false explicitly. This is what
  // the tool must show on every platform.
  const posix = cases.map((c) => picomatch.makeRe(c.pattern, { windows: false, dot: false, nocase: false }).source);

  // Why the flag matters: when picomatch is left to find the platform out, a Windows machine reads a backslash in a
  // path as a separator and a Linux machine does not. If this stops being true the premise is gone.
  const slashPath = 'a' + BACKSLASH + 'b';
  vi.stubGlobal('navigator', { platform: 'Win32' });
  expect(picomatch('a/*', { dot: false })(slashPath)).toBe(true);
  vi.stubGlobal('navigator', { platform: 'Linux x86_64' });
  expect(picomatch('a/*', { dot: false })(slashPath)).toBe(false);
  vi.unstubAllGlobals();

  for (const platform of ['Win32', 'Linux x86_64', 'MacIntel']) {
    vi.stubGlobal('navigator', { platform });
    picomatchCalls.matcher.length = 0;
    picomatchCalls.makeRe.length = 0;
    cases.forEach((c, index) => {
      const { rows, regexes } = globRows(c.pattern, c.paths.join('\n'), { dot: false, nocase: false });
      expect(
        rows.map((r) => r.matched),
        `${platform}: ${c.pattern}`,
      ).toEqual(c.expected);
      expect(regexes[0]?.source, `${platform}: regular expression of ${c.pattern}`).toBe(posix[index]);
    });
    // Every call picomatch received, for the matcher and for the regular expression, pinned the platform to posix. The
    // regular expression shown comes from the matcher itself, so there is one call per pattern.
    expect(picomatchCalls.matcher.length).toBe(cases.length);
    for (const options of [...picomatchCalls.matcher, ...picomatchCalls.makeRe]) {
      expect((options as { windows?: boolean }).windows, platform).toBe(false);
    }
    // A published vector: a quantified extglob that is risky is read literally by default.
    expect(globRows('+(a|aa)', 'a', { dot: false, nocase: false }).regexes[0]?.source).toBe(
      String.raw`^(?:\+\(a\|aa\))$`,
    );
  }
  vi.unstubAllGlobals();
});

it('glob mode names the first pattern line that matched each path and shows the regular expression it became', () => {
  // Line 3 is blank and still counts, so *.js is line 4.
  const patterns = '*.ts\nsrc/**\n\n*.js\nsrc/a.ts';
  const paths = ['src/a.ts', 'b.js', 'src/lib/c.js', 'z.md', 'a.ts'].join('\n');
  const { rows, regexes } = globRows(patterns, paths, { dot: false, nocase: false });

  expect(rows).toEqual([
    // *.ts does not match src/a.ts (a star never crosses a slash), src/** is line 2, and line 5 also matches.
    { path: 'src/a.ts', matched: true, line: 2, pattern: 'src/**', also: [5], moreAlso: 0 },
    { path: 'b.js', matched: true, line: 4, pattern: '*.js', also: [], moreAlso: 0 },
    { path: 'src/lib/c.js', matched: true, line: 2, pattern: 'src/**', also: [], moreAlso: 0 },
    { path: 'z.md', matched: false, line: null, pattern: '', also: [], moreAlso: 0 },
    { path: 'a.ts', matched: true, line: 1, pattern: '*.ts', also: [], moreAlso: 0 },
  ]);

  // One regular expression per pattern line, in line order, exactly what picomatch.makeRe gives for the same options.
  expect(regexes.map((r) => r.line)).toEqual([1, 2, 4, 5]);
  for (const r of regexes) {
    const text = ['*.ts', 'src/**', '', '*.js', 'src/a.ts'][r.line - 1] as string;
    expect(r.source).toBe(picomatch.makeRe(text, { windows: false, dot: false, nocase: false }).source);
    expect(r.truncated).toBe(false);
  }

  // The option changes what is matched: with dotfiles on, a star reaches a leading dot.
  const dotted = globRows('*.js', '.hidden.js\nx.js', { dot: true, nocase: false }).rows;
  expect(dotted.map((r) => r.matched)).toEqual([true, true]);
  const plain = globRows('*.js', '.hidden.js\nx.js', { dot: false, nocase: false }).rows;
  expect(plain.map((r) => r.matched)).toEqual([false, true]);
  const folded = globRows('*.JS', 'x.js', { dot: false, nocase: true }).rows;
  expect(folded[0]?.matched).toBe(true);
  expect(globRows('*.JS', 'x.js', { dot: false, nocase: false }).rows[0]?.matched).toBe(false);

  // A long regular expression is cut and says so.
  const long = globRows('{' + Array.from({ length: 400 }, (_, i) => 'name' + i).join(',') + '}', 'name1', {
    dot: false,
    nocase: false,
  });
  expect(long.rows[0]?.matched).toBe(true);
  expect(long.regexes[0]?.truncated).toBe(true);
  expect(long.regexes[0]?.source.length).toBeLessThanOrEqual(2000);
});

it('picomatch differences from Bash for [!a] and extglobs are what limits says', () => {
  // Bash 5.2.37 (shopt -s extglob nullglob globstar), run in a directory holding exactly these files:
  const FILES = ['a.txt', 'b.txt', 'ab.txt', '.hidden.js', 'x.js', 'y.ts', 'z.md'];
  const BASH: Record<string, string[]> = {
    '[!a].txt': ['b.txt'],
    '[^a].txt': ['b.txt'],
    '!(a).txt': ['ab.txt', 'b.txt'],
    '!(a)*.txt': ['a.txt', 'ab.txt', 'b.txt'],
    '@(*.js|*.ts)': ['x.js', 'y.ts'],
    '*.js': ['x.js'],
  };
  const ours = (pattern: string): string[] =>
    FILES.filter((f) => matchedPaths(pattern, [f], { dot: false, nocase: false }).has(f));

  // Agreement where limits says to write the Bash form: [^a] is negation, and a plain star pattern is the same.
  expect(ours('[^a].txt')).toEqual(BASH['[^a].txt']);
  expect(ours('*.js')).toEqual(BASH['*.js']);

  // [!a] is the two characters ! and a in picomatch, so it matches a.txt and not b.txt: the opposite of Bash.
  expect(ours('[!a].txt')).toEqual(['a.txt']);
  expect(ours('[!a].txt')).not.toEqual(BASH['[!a].txt']);

  // A negated extglob does not backtrack the way Bash does (picomatch README: Matching behavior vs. Bash).
  expect(ours('!(a).txt')).toEqual(['b.txt']);
  expect(ours('!(a).txt')).not.toEqual(BASH['!(a).txt']);
  expect(ours('!(a)*.txt')).toEqual(['b.txt']);
  expect(ours('!(a)*.txt')).not.toEqual(BASH['!(a)*.txt']);

  // @(*.js|*.ts) also matches the dotfile .hidden.js, which Bash leaves out unless dotglob is set.
  expect(ours('@(*.js|*.ts)')).toEqual(['.hidden.js', 'x.js', 'y.ts']);
  expect(ours('@(*.js|*.ts)')).not.toEqual(BASH['@(*.js|*.ts)']);

  const limits = toolMeta.limits.join('\n');
  expect(limits).toMatch(/\[!a\] is not negation/);
  expect(limits).toMatch(/!\(a\)\.txt/);
  expect(limits).toMatch(/@\(\*\.js\|\*\.ts\)/);
  expect(limits).toMatch(/Bash/);
});

it('glob mode matches and shows a path with the trailing slash it was pasted with, so directory patterns can match', () => {
  // The review's three patterns and three paths. picomatch 4.0.7 reads src/ as the directory, src as a file, and src/*/
  // as a directory one level down, and each only matches a path written the same way.
  const patterns = ['src/', 'src/*/', 'src'];
  const paths = ['src/', 'src/lib/', 'src'];
  const { rows } = globRows(patterns.join('\n'), paths.join('\n'), { dot: false, nocase: false });
  expect(rows.map((row) => row.path)).toEqual(['src/', 'src/lib/', 'src']);
  expect(rows.map((row) => [row.matched, row.line, row.pattern, row.also])).toEqual([
    [true, 1, 'src/', []],
    [true, 2, 'src/*/', []],
    [true, 3, 'src', []],
  ]);
  // A path pasted with and without its slash are two different paths, and a duplicate still gives two rows.
  const again = globRows('src/', 'src\nsrc/\nsrc/', { dot: false, nocase: false }).rows;
  expect(again.map((row) => [row.path, row.matched])).toEqual([
    ['src', false],
    ['src/', true],
    ['src/', true],
  ]);
  // The same answers as picomatch itself gives for the strings as pasted.
  for (const pattern of patterns) {
    for (const path of paths) {
      const row = globRows(pattern, path, { dot: false, nocase: false }).rows[0];
      expect(row?.matched, `${pattern} against ${path}`).toBe(picomatch(pattern, { windows: false })(path));
    }
  }
  // A directory pattern is not matched by a file path of the same name, and a file pattern not by the directory.
  expect(globRows('src/', 'src', { dot: false, nocase: false }).rows[0]?.matched).toBe(false);
  expect(globRows('src', 'src/', { dot: false, nocase: false }).rows[0]?.matched).toBe(false);
});
