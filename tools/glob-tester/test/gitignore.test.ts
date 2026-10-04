import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { gitignoreRows, withoutTrailingSpaces, type GitignoreRow } from '../src/gitignore';
import { meta as toolMeta } from '../src/index';
import { gitCase, gitCorpus, gitDecision, pathIndex, type GitCase } from './corpus';

// Expected values are git's own answers, recorded with `git check-ignore -v -n -z --no-index --stdin` (see
// fixtures/README.md for the git version, the date and the two-repository method): whether each path is ignored and the
// line git printed. The tool is the `ignore` package 7.0.8 with ignorecase false; the differences between the two are
// listed below, each with the class that meta.json `limits` states, and a listed pair must really differ.

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
});

const UMLAUT = String.fromCodePoint(0xfc);
const NIHON = String.fromCodePoint(0x65e5, 0x672c);
const GO = String.fromCodePoint(0x8a9e);

/** `ignored`: the two disagree on whether the path is ignored. `line`: they agree, but the deciding line differs. */
interface KnownDifference {
  caseId: string;
  path: string;
  kind: 'ignored' | 'line';
  diffClass: 'three-asterisks' | 'utf8-bytes';
}

const KNOWN_DIFFERENCES: KnownDifference[] = [
  // Git reads three or more asterisks before a slash like **/ ; the package does not match any of these paths.
  ...['foo', 'bar/baz/foo', 'a/b/foo', 'a/x/foo', 'a/b/c/foo', 'foo/', 'a/b/foo/'].map((path): KnownDifference => ({
    caseId: 'three-stars-slash',
    path,
    kind: 'ignored',
    diffClass: 'three-asterisks',
  })),
  // Git compares UTF-8 bytes, so ? stands for one byte and a bracket holds one byte; the package compares characters.
  { caseId: 'question', path: NIHON + '/' + GO + '.txt', kind: 'ignored', diffClass: 'utf8-bytes' },
  { caseId: 'question-before-umlaut', path: UMLAUT + 'ber.txt', kind: 'ignored', diffClass: 'utf8-bytes' },
  { caseId: 'two-questions-before-umlaut', path: UMLAUT + 'ber.txt', kind: 'ignored', diffClass: 'utf8-bytes' },
  { caseId: 'bracket-umlaut', path: UMLAUT + 'ber.txt', kind: 'ignored', diffClass: 'utf8-bytes' },
];

/** What meta.json `limits` must say for each class of difference. */
const CLASS_STATED_IN_LIMITS: Record<KnownDifference['diffClass'], RegExp> = {
  'three-asterisks': /three or more asterisks/i,
  'utf8-bytes': /UTF-8/,
};

function rowsFor(c: GitCase): GitignoreRow[] {
  return gitignoreRows(c.text, gitCorpus.paths.join('\n'));
}

function lineOf(row: GitignoreRow): number {
  return row.decidedBy.kind === 'rule' || row.decidedBy.kind === 'parent' ? row.decidedBy.line : 0;
}

it('.gitignore mode agrees with git check-ignore on the recorded corpus except the listed differences, each named in limits', () => {
  expect(gitCorpus.gitVersion).toMatch(/^git version \d+\.\d+/);
  expect(gitCorpus.config['core.ignorecase']).toBe('false');

  const found: string[] = [];
  let pairs = 0;
  for (const c of gitCorpus.cases) {
    const rows = rowsFor(c);
    expect(rows).toHaveLength(gitCorpus.paths.length);
    rows.forEach((row, index) => {
      pairs += 1;
      const path = gitCorpus.paths[index] as string;
      expect(row.path + (row.isDirectory ? '/' : '')).toBe(path);
      const git = gitDecision(c, index);
      if (row.ignored !== git.ignored) found.push(`${c.id} | ${path} | ignored`);
      else if (lineOf(row) !== git.line) found.push(`${c.id} | ${path} | line`);
    });
  }

  const listed = KNOWN_DIFFERENCES.map((d) => `${d.caseId} | ${d.path} | ${d.kind}`);
  // Nothing outside the list differs, and nothing in the list agrees (no stale entries).
  expect(found.slice().sort()).toEqual(listed.slice().sort());
  expect(pairs).toBe(gitCorpus.cases.length * gitCorpus.paths.length);
  expect(gitCorpus.cases.length).toBeGreaterThanOrEqual(60);
  expect(gitCorpus.paths.length).toBeGreaterThanOrEqual(60);

  const limits = toolMeta.limits.join('\n');
  for (const diffClass of new Set(KNOWN_DIFFERENCES.map((d) => d.diffClass))) {
    expect(limits, `limits must state the class ${diffClass}`).toMatch(CLASS_STATED_IN_LIMITS[diffClass]);
  }
});

it('the deciding rule is the line number of the last matching pattern, a negation included, or the excluded parent directory', () => {
  // Git printed .gitignore:1:*.log and .gitignore:2:!keep.log for these paths.
  const reinclude = gitCase('negate-after');
  expect(reinclude.printed).toEqual({ '1': '*.log', '2': '!keep.log' });
  const rows = rowsFor(reinclude);
  const debug = rows[pathIndex('debug.log')] as GitignoreRow;
  expect(debug.ignored).toBe(true);
  expect(debug.decidedBy).toEqual({ kind: 'rule', line: 1, pattern: '*.log', negated: false });
  const keep = rows[pathIndex('keep.log')] as GitignoreRow;
  expect(keep.ignored).toBe(false);
  expect(keep.decidedBy).toEqual({ kind: 'rule', line: 2, pattern: '!keep.log', negated: true });

  // A file under an excluded directory is decided by the directory's rule, and git cannot re-include it (line 1).
  const parent = gitCase('parent-excluded-cannot-reinclude');
  expect(parent.printed['1']).toBe('build/');
  const parentRows = rowsFor(parent);
  const keepTxt = parentRows[pathIndex('build/keep.txt')] as GitignoreRow;
  expect(gitDecision(parent, pathIndex('build/keep.txt'))).toMatchObject({ ignored: true, line: 1 });
  expect(keepTxt.ignored).toBe(true);
  expect(keepTxt.decidedBy).toEqual({ kind: 'parent', directory: 'build/', line: 1, pattern: 'build/' });
  const deeper = parentRows[pathIndex('build/sub/out.js')] as GitignoreRow;
  expect(deeper.decidedBy).toEqual({ kind: 'parent', directory: 'build/', line: 1, pattern: 'build/' });
  const dir = parentRows[pathIndex('build/')] as GitignoreRow;
  expect(dir.isDirectory).toBe(true);
  expect(dir.decidedBy).toEqual({ kind: 'rule', line: 1, pattern: 'build/', negated: false });

  // When a rule excludes the contents and a negation names one file, the file keeps its own rule (git: line 2).
  const contents = gitCase('contents-excluded-then-reinclude');
  const contentRows = rowsFor(contents);
  const reincluded = contentRows[pathIndex('build/out.js')] as GitignoreRow;
  expect(gitDecision(contents, pathIndex('build/out.js'))).toMatchObject({
    ignored: false,
    line: 2,
    pattern: '!build/out.js',
  });
  expect(reincluded.ignored).toBe(false);
  expect(reincluded.decidedBy).toEqual({ kind: 'rule', line: 2, pattern: '!build/out.js', negated: true });

  // No rule matched: git printed nothing for the path.
  const plain = gitCase('plain-name');
  const plainRow = rowsFor(plain)[pathIndex('a.txt')] as GitignoreRow;
  expect(gitDecision(plain, pathIndex('a.txt')).matched).toBe(false);
  expect(plainRow.ignored).toBe(false);
  expect(plainRow.decidedBy).toEqual({ kind: 'none' });
});

it('blank lines, comments, a byte order mark and CRLF line ends are read as git reads them', () => {
  // The recorded text of each case holds the real characters (CR before LF, U+FEFF first).
  expect(gitCase('crlf').text).toContain('\r\n');
  expect(gitCase('bom').text.charCodeAt(0)).toBe(0xfeff);

  const crlf = gitCase('crlf');
  const crlfRows = rowsFor(crlf);
  const crlfDebug = crlfRows[pathIndex('debug.log')] as GitignoreRow;
  // Git printed line 2 and the pattern without its CR.
  expect(gitDecision(crlf, pathIndex('debug.log'))).toMatchObject({ ignored: true, line: 2, pattern: '*.log' });
  expect(crlfDebug.decidedBy).toEqual({ kind: 'rule', line: 2, pattern: '*.log', negated: false });

  const bom = gitCase('bom');
  const bomDebug = rowsFor(bom)[pathIndex('debug.log')] as GitignoreRow;
  expect(gitDecision(bom, pathIndex('debug.log'))).toMatchObject({ ignored: true, line: 1, pattern: '*.log' });
  expect(bomDebug.decidedBy).toEqual({ kind: 'rule', line: 1, pattern: '*.log', negated: false });

  // Blank lines and a comment before the rule still count as lines: git printed line 4.
  const blanks = gitCase('blank-and-comments');
  const blankDebug = rowsFor(blanks)[pathIndex('debug.log')] as GitignoreRow;
  expect(gitDecision(blanks, pathIndex('debug.log'))).toMatchObject({ ignored: true, line: 4, pattern: '*.log' });
  expect(blankDebug.decidedBy).toEqual({ kind: 'rule', line: 4, pattern: '*.log', negated: false });

  // A comment, an empty text and a text of only a comment match nothing, as in git.
  for (const id of ['only-comment', 'empty-text']) {
    const c = gitCase(id);
    for (const row of rowsFor(c)) {
      expect(row.ignored).toBe(false);
      expect(row.decidedBy).toEqual({ kind: 'none' });
    }
    expect(c.r.split(',').every((v) => v === '0')).toBe(true);
  }

  // An escaped hash names a file that starts with a hash, and an escaped bang a file that starts with a bang.
  const hash = gitCase('escaped-hash');
  expect(gitDecision(hash, pathIndex('#notes.txt'))).toMatchObject({ ignored: true, line: 1 });
  expect((rowsFor(hash)[pathIndex('#notes.txt')] as GitignoreRow).ignored).toBe(true);
  const bang = gitCase('escaped-bang');
  expect(gitDecision(bang, pathIndex('!important.txt'))).toMatchObject({ ignored: true, line: 1 });
  expect((rowsFor(bang)[pathIndex('!important.txt')] as GitignoreRow).ignored).toBe(true);
});

it('a later line that matches the same path decides it and logs/ matches only the directory', () => {
  // Git names the last matching line: line 2 for debug.log, and line 3 when the rule is written again after a negation.
  const twice = gitCase('two-rules-same-path');
  const twiceRows = rowsFor(twice);
  expect(gitDecision(twice, pathIndex('debug.log'))).toMatchObject({ ignored: true, line: 2, pattern: 'debug.log' });
  expect((twiceRows[pathIndex('debug.log')] as GitignoreRow).decidedBy).toEqual({
    kind: 'rule',
    line: 2,
    pattern: 'debug.log',
    negated: false,
  });
  expect((twiceRows[pathIndex('keep.log')] as GitignoreRow).decidedBy).toEqual({
    kind: 'rule',
    line: 1,
    pattern: '*.log',
    negated: false,
  });

  const relist = gitCase('negate-then-relist');
  expect(gitDecision(relist, pathIndex('keep.log'))).toMatchObject({ ignored: true, line: 3, pattern: 'keep.log' });
  expect((rowsFor(relist)[pathIndex('keep.log')] as GitignoreRow).decidedBy).toEqual({
    kind: 'rule',
    line: 3,
    pattern: 'keep.log',
    negated: false,
  });

  // logs/ is the directory logs and what is under it, never a file named logs.
  const logs = gitCase('dir-pattern-vs-file-named-like-dir');
  expect(logs.text).toBe('logs/');
  const logRows = rowsFor(logs);
  const directory = logRows[pathIndex('logs/')] as GitignoreRow;
  const inside = logRows[pathIndex('logs/a.txt')] as GitignoreRow;
  const file = logRows[pathIndex('logs')] as GitignoreRow;
  expect(gitDecision(logs, pathIndex('logs/')).ignored).toBe(true);
  expect(gitDecision(logs, pathIndex('logs/a.txt')).ignored).toBe(true);
  expect(gitDecision(logs, pathIndex('logs')).matched).toBe(false);
  expect(directory.ignored).toBe(true);
  expect(directory.isDirectory).toBe(true);
  expect(inside.ignored).toBe(true);
  expect(inside.decidedBy).toEqual({ kind: 'parent', directory: 'logs/', line: 1, pattern: 'logs/' });
  expect(file.isDirectory).toBe(false);
  expect(file.ignored).toBe(false);
  expect(file.decidedBy).toEqual({ kind: 'none' });
});

it('line numbers stay exact across many rules, and when a re-included directory sits above the path', () => {
  const decisions = (text: string, paths: string[]): GitignoreRow[] => gitignoreRows(text, paths.join('\n'));

  // 200 rules whose answers are known by construction: line k names f<k>.txt for k up to 150, so every file's line is its
  // own number, whichever group of rules the search reaches it in (groups hold 32 rules, so 32, 33, 64 and 65 cross).
  const lines: string[] = [];
  for (let k = 1; k <= 150; k++) lines.push(`f${k}.txt`);
  lines.push('*.log'); // 151
  lines.push('!keep.log'); // 152
  for (let k = 153; k <= 197; k++) lines.push(`d${k}/`); // line k is the directory d<k>/
  lines.push('!f9.txt'); // 198
  lines.push('f5.txt'); // 199
  lines.push('d160/inner.txt'); // 200
  const many = lines.join('\n');
  const paths = [
    'f1.txt',
    'f32.txt',
    'f33.txt',
    'f64.txt',
    'f65.txt',
    'f150.txt',
    'f9.txt',
    'f5.txt',
    'x.log',
    'keep.log',
    'd153/',
    'd197/',
    'd153',
    'd160/x.txt',
    'd160/inner.txt',
    'none.txt',
    'sub/f1.txt',
  ];
  const rows = decisions(many, paths);
  const lineOf = (index: number): number | undefined => {
    const by = (rows[index] as GitignoreRow).decidedBy;
    return by.kind === 'rule' || by.kind === 'parent' ? by.line : undefined;
  };
  expect([0, 1, 2, 3, 4, 5].map(lineOf)).toEqual([1, 32, 33, 64, 65, 150]);
  // f9.txt is named by line 9 and re-included by line 198: the last decides. f5.txt is named again on line 199.
  expect(rows[6]).toMatchObject({
    ignored: false,
    decidedBy: { kind: 'rule', line: 198, pattern: '!f9.txt', negated: true },
  });
  expect(rows[7]).toMatchObject({
    ignored: true,
    decidedBy: { kind: 'rule', line: 199, pattern: 'f5.txt', negated: false },
  });
  expect(rows[8]).toMatchObject({ ignored: true, decidedBy: { kind: 'rule', line: 151 } });
  expect(rows[9]).toMatchObject({ ignored: false, decidedBy: { kind: 'rule', line: 152, negated: true } });
  expect(rows[10]).toMatchObject({
    ignored: true,
    isDirectory: true,
    decidedBy: { kind: 'rule', line: 153, pattern: 'd153/' },
  });
  expect(rows[11]).toMatchObject({ ignored: true, decidedBy: { kind: 'rule', line: 197 } });
  expect(rows[12]).toMatchObject({ ignored: false, isDirectory: false, decidedBy: { kind: 'none' } });
  // Under an excluded directory the directory decides, even where a later line names the file itself.
  expect(rows[13]).toMatchObject({
    ignored: true,
    decidedBy: { kind: 'parent', directory: 'd160/', line: 160, pattern: 'd160/' },
  });
  expect(rows[14]).toMatchObject({ ignored: true, decidedBy: { kind: 'parent', directory: 'd160/', line: 160 } });
  expect(rows[15]).toMatchObject({ ignored: false, decidedBy: { kind: 'none' } });
  // f1.txt in a folder is still named by line 1 (no slash in the rule, so it matches at any depth).
  expect(rows[16]).toMatchObject({ ignored: true, decidedBy: { kind: 'rule', line: 1 } });

  // Everything at the top is excluded (line 60), then the src directory is re-included (line 70), with the file rule
  // on line 5. A rule group that holds line 60 but not line 70 would see src/ as excluded and wrongly name line 60 for
  // src/x.dat; the answer is line 5, as git reads it (the directory is back in, so the file rule counts).
  const tail: string[] = [];
  for (let k = 1; k <= 100; k++)
    tail.push(k === 5 ? 'src/*.dat' : k === 60 ? '/*' : k === 70 ? '!/src/' : `zz${k}.tmp`);
  const reincluded = decisions(tail.join('\n'), ['src/x.dat', 'src/other.txt', 'top.txt', 'lib/y.txt', 'src/']);
  expect(reincluded[0]).toMatchObject({ ignored: true, decidedBy: { kind: 'rule', line: 5, pattern: 'src/*.dat' } });
  expect(reincluded[1]).toMatchObject({ ignored: false, decidedBy: { kind: 'none' } });
  expect(reincluded[2]).toMatchObject({ ignored: true, decidedBy: { kind: 'rule', line: 60, pattern: '/*' } });
  expect(reincluded[3]).toMatchObject({ ignored: true, decidedBy: { kind: 'parent', directory: 'lib/', line: 60 } });
  expect(reincluded[4]).toMatchObject({
    ignored: false,
    isDirectory: true,
    decidedBy: { kind: 'rule', line: 70, negated: true },
  });
});

it('unquoted trailing spaces are dropped before a rule is read and a quoted space stays, as git reads a .gitignore line', () => {
  const backslash = String.fromCharCode(92);
  // The gitignore documentation: "Trailing spaces are ignored unless they are quoted with backslash".
  expect(withoutTrailingSpaces('node_modules/ ')).toBe('node_modules/');
  expect(withoutTrailingSpaces('build/     ')).toBe('build/');
  expect(withoutTrailingSpaces('foo' + backslash + ' ')).toBe('foo' + backslash + ' ');
  expect(withoutTrailingSpaces('foo' + backslash + '  ')).toBe('foo' + backslash + ' ');
  // A backslash that is itself quoted does not quote the space after it.
  expect(withoutTrailingSpaces('foo' + backslash + backslash + ' ')).toBe('foo' + backslash + backslash);
  expect(withoutTrailingSpaces('a b ')).toBe('a b');
  expect(withoutTrailingSpaces('foo' + backslash)).toBe('foo' + backslash);
  expect(withoutTrailingSpaces('   ')).toBe('');
  expect(withoutTrailingSpaces('tab\t')).toBe('tab\t');

  // The case the review found: a directory rule with a trailing space still matches at every depth, as git decides.
  const nested = gitCase('trailing-space-dir');
  expect(nested.text).toBe('node_modules/ ');
  const rows = rowsFor(nested);
  for (const path of [
    'packages/app/node_modules/',
    'packages/app/node_modules/x/index.js',
    'node_modules/x/index.js',
  ]) {
    const git = gitDecision(nested, pathIndex(path));
    expect(git).toMatchObject({ ignored: true, line: 1 });
    const row = rows[pathIndex(path)] as GitignoreRow;
    expect(row.ignored, path).toBe(true);
    expect(lineOf(row), path).toBe(1);
  }
  // The pasted line is what the row names, with its trailing space, and the line numbers still count every line.
  const second = gitignoreRows('*.tmp\nbuild/   \n', 'src/build/out.js\nbuild/');
  expect(second[0]).toMatchObject({
    ignored: true,
    decidedBy: { kind: 'parent', directory: 'src/build/', line: 2, pattern: 'build/   ' },
  });
  expect(second[1]).toMatchObject({ ignored: true, decidedBy: { kind: 'rule', line: 2, pattern: 'build/   ' } });
});

it('a line holding only a ! matches nothing and still counts in the line numbers, as in git', () => {
  // The review's case: *.log then a lone !. Git ignores a.log by line 1; the ! is not a negation of every path.
  const after = gitCase('lone-bang-after-rule');
  expect(after.text).toBe('*.log\n!');
  expect(gitDecision(after, pathIndex('debug.log'))).toMatchObject({ ignored: true, line: 1, pattern: '*.log' });
  const row = rowsFor(after)[pathIndex('debug.log')] as GitignoreRow;
  expect(row.ignored).toBe(true);
  expect(row.decidedBy).toEqual({ kind: 'rule', line: 1, pattern: '*.log', negated: false });
  // With trailing spaces the line is still only a !, and a rule after it is still named by its pasted line number.
  const between = gitCase('lone-bang-between-rules');
  expect(gitDecision(between, pathIndex('keep.log'))).toMatchObject({ ignored: false, line: 3, pattern: '!keep.log' });
  expect((rowsFor(between)[pathIndex('keep.log')] as GitignoreRow).decidedBy).toEqual({
    kind: 'rule',
    line: 3,
    pattern: '!keep.log',
    negated: true,
  });
  const spaces = gitCase('lone-bang-spaces-after-rule');
  expect((rowsFor(spaces)[pathIndex('debug.log')] as GitignoreRow).decidedBy).toEqual({
    kind: 'rule',
    line: 1,
    pattern: '*.log',
    negated: false,
  });
  // Nothing but a lone ! matches no path at all.
  for (const id of ['lone-bang', 'lone-bang-spaces']) {
    for (const r of rowsFor(gitCase(id))) {
      expect(r.ignored).toBe(false);
      expect(r.decidedBy).toEqual({ kind: 'none' });
    }
  }
  // The limits no longer say the answers differ.
  expect(toolMeta.limits.join('\n')).not.toMatch(/only a !/i);
});
