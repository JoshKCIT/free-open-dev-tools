import { readFileSync, writeFileSync } from 'node:fs';
import { it, expect, vi } from 'vitest';
import {
  GlobTesterError,
  MAX_CODEOWNERS_CHARACTERS,
  MAX_CODEOWNERS_LINE_CHARACTERS,
  MAX_CODEOWNERS_RULES,
  MAX_CODEOWNERS_WORK,
  OWNER_SHAPES,
  checkCodeownersInput,
  codeownersRows,
  ownersForPaths,
  parseCodeowners,
  testPatterns,
  type CodeownersRow,
} from '../src/index';
import { MAX_SCALING_RATIO, scalingRatio } from './scaling';

// Expected values come from GitHub's "About code owners" page (blob a0ff66d59c8819c28c87e94c61195e175afd8ec2, CC BY 4.0,
// see test/fixtures/codeowners/UPSTREAM.md): the example file and the comments written beside its lines, re-typed as two
// files, 14 paths and 28 answers in docs-example.json. The deciding line is counted over every pasted line, comment
// lines included. The owners were also checked against the recorded codeowners 0.9.0 package.

interface DocsAnswer {
  file: 'A' | 'B';
  path: string;
  owners: string[];
  line: number | null;
}

interface DocsExample {
  blob: string;
  files: Record<'A' | 'B', string>;
  paths: string[];
  answers: DocsAnswer[];
}

const docs = JSON.parse(
  readFileSync(new URL('./fixtures/codeowners/docs-example.json', import.meta.url), 'utf8'),
) as DocsExample;

it('the documented example file gives the owners and deciding line GitHub describes for every listed path', () => {
  expect(docs.blob).toBe('a0ff66d59c8819c28c87e94c61195e175afd8ec2');
  expect(docs.paths).toHaveLength(14);
  expect(docs.answers).toHaveLength(28);
  for (const file of ['A', 'B'] as const) {
    const { rows, skipped } = codeownersRows(docs.files[file], docs.paths.join('\n'));
    // The documented example holds no line GitHub does not support.
    expect(skipped, `file ${file}`).toEqual([]);
    // One row for each path, in the order the paths were pasted.
    expect(rows.map((row) => row.path)).toEqual(docs.paths);
    for (const answer of docs.answers.filter((a) => a.file === file)) {
      const row = rows.find((r) => r.path === answer.path);
      expect(row?.owners, `${file} ${answer.path} owners`).toEqual(answer.owners);
      expect(row?.line, `${file} ${answer.path} deciding line`).toBe(answer.line);
    }
  }

  // The comments in the documentation, spelled out for the paths they talk about.
  const a = codeownersRows(docs.files.A, docs.paths.join('\n')).rows;
  const by = (path: string) => a.find((row) => row.path === path);
  // "*       @global-owner1 @global-owner2" is line 2, after the comment line.
  expect(by('README.md')).toMatchObject({ owners: ['@global-owner1', '@global-owner2'], line: 2, pattern: '*' });
  // "*.js    @js-owner #This is an inline comment." : the inline comment is not an owner.
  expect(by('src/app.js')).toMatchObject({ owners: ['@js-owner'], line: 3, pattern: '*.js' });
  // "**/logs @octocat" comes after "/build/logs/ @doctocat", so it decides build/logs/x.log.
  expect(by('build/logs/x.log')).toMatchObject({ owners: ['@octocat'], line: 11, pattern: '**/logs' });
  // "/apps/github" has no owners: the path has no owner, and that line is the one that decided it.
  expect(by('apps/github/readme.md')).toMatchObject({ owners: [], line: 13, pattern: '/apps/github' });
  // File B names @doctocat for the same path.
  const b = codeownersRows(docs.files.B, 'apps/github/readme.md').rows;
  expect(b[0]).toMatchObject({ owners: ['@doctocat'], line: 2 });
});

it('the last matching line wins and the owners of earlier lines are never merged', () => {
  // GitHub: "Order is important; the last matching pattern takes the most precedence." The example file's own comment
  // adds that a pull request that only changes JS files asks only @js-owner and not the global owners.
  const global = '* @global-owner1 @global-owner2\n';
  const js = '*.js @js-owner\n';
  const forward = codeownersRows(global + js, 'src/app.js\nREADME.md').rows;
  expect(forward[0]).toMatchObject({ path: 'src/app.js', owners: ['@js-owner'], line: 2 });
  expect(forward[1]).toMatchObject({ path: 'README.md', owners: ['@global-owner1', '@global-owner2'], line: 1 });

  // The same two lines the other way round: now the global line is the later one and decides, with its owners alone.
  const reversed = codeownersRows(js + global, 'src/app.js').rows;
  expect(reversed[0]).toMatchObject({ owners: ['@global-owner1', '@global-owner2'], line: 2 });
  expect(reversed[0]?.owners).not.toContain('@js-owner');

  // Three matching lines: only the last one's owners are shown.
  const three = codeownersRows('* @a\n*.js @b\nsrc/ @c @d\n', 'src/app.js').rows;
  expect(three[0]).toMatchObject({ owners: ['@c', '@d'], line: 3 });
});

// ---------------------------------------------------------------------------------------------------------------------
// The rules, one sentence of GitHub's page (or of the gitignore documentation it points to) at a time.
// ---------------------------------------------------------------------------------------------------------------------

const MARKER = 'FODT-MARKER-5538';

/** The answer for one path under a CODEOWNERS text. */
function decide(text: string, path: string): CodeownersRow {
  return codeownersRows(text, path).rows[0] as CodeownersRow;
}

/** Whether a single pattern line, with an owner, owns a path. */
function owns(pattern: string, path: string): boolean {
  return decide(pattern + ' @o', path).owners.length > 0;
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

it('docs/* gives direct children only while docs/ and /docs/ give everything under them', () => {
  // GitHub, in the example file: "The `docs/*` pattern will match files like `docs/getting-started.md` but not further
  // nested files like `docs/build-app/troubleshooting.md`."
  const star = codeownersRows(
    'docs/* docs@example.com',
    'docs/getting-started.md\ndocs/build-app/troubleshooting.md\ndocs\nlib/docs/a.md',
  ).rows;
  expect(star.map((row) => row.owners)).toEqual([['docs@example.com'], [], [], []]);
  expect(star.map((row) => row.line)).toEqual([1, null, null, null]);

  // GitHub, in the example file: "/docs/ @doctocat" owns "any file in the /docs directory in the root of your repository and
  // any of its subdirectories", and "apps/ @octocat" owns "any file in an apps directory anywhere".
  for (const pattern of ['docs/', '/docs/']) {
    expect(owns(pattern, 'docs/getting-started.md'), pattern).toBe(true);
    expect(owns(pattern, 'docs/build-app/troubleshooting.md'), pattern).toBe(true);
    // A file called docs is not a directory called docs.
    expect(owns(pattern, 'docs'), pattern).toBe(false);
  }
  expect(owns('docs/', 'lib/docs/a.md')).toBe(true);
  expect(owns('/docs/', 'lib/docs/a.md')).toBe(false);
});

it('a single segment pattern matches a file or directory of that name at any depth and everything under it', () => {
  // The vendored table (hmarr/codeowners) "single-segment pattern" foo, and GitHub's own comment on **/logs: "@octocat owns
  // any file in a /logs directory such as /build/logs, /scripts/logs, and /deeply/nested/logs".
  for (const path of ['foo', 'foo/bar', 'bar/foo', 'bar/foo/baz']) expect(owns('foo', path), path).toBe(true);
  for (const path of ['foo.txt', 'fool.txt', 'xfoo', 'bar/foo.txt', 'bar/baz'])
    expect(owns('foo', path), path).toBe(false);
  for (const path of ['logs', 'build/logs/x.log', 'scripts/logs/y', 'deeply/nested/logs/z']) {
    expect(owns('**/logs', path), path).toBe(true);
  }
  expect(owns('**/logs', 'logsx')).toBe(false);
  expect(owns('**/logs', 'a/logs.txt')).toBe(false);
  // Anchored at the top with a leading slash, and by a slash in the middle.
  expect(owns('/foo', 'bar/foo')).toBe(false);
  expect(owns('foo/bar', 'x/foo/bar')).toBe(false);
  expect(owns('foo/bar', 'foo/bar/baz')).toBe(true);
});

it('leading, trailing and middle double stars match zero or more directories', () => {
  // The gitignore documentation, which GitHub's page says CODEOWNERS follows: "a/**/b matches a/b, a/x/b, a/x/y/b".
  for (const path of ['a/b', 'a/x/b', 'a/x/y/b']) expect(owns('a/**/b', path), path).toBe(true);
  expect(owns('a/**/b', 'a/x/c')).toBe(false);
  expect(owns('a/**/b', 'x/a/b')).toBe(false);
  // "A leading **/ matches in all directories" and "a trailing /** matches everything inside".
  for (const path of ['foo/bar', 'x/foo/bar', 'x/y/foo/bar']) expect(owns('**/foo/bar', path), path).toBe(true);
  expect(owns('**/foo/bar', 'foo/baz')).toBe(false);
  for (const path of ['abc/x', 'abc/x/y']) expect(owns('abc/**', path), path).toBe(true);
  expect(owns('abc/**', 'abc')).toBe(false);
  expect(owns('abc/**', 'x/abc/y')).toBe(false);
});

it('a pattern with no owners leaves matching paths with no owner, shown as a result', () => {
  // GitHub, in the example file: "/apps/github" with its owners left empty means "changes to apps/github can be made with
  // the approval of any user who has write access to the repository".
  const file = '/apps/ @octocat\n/apps/github\n';
  const rows = codeownersRows(file, 'apps/web/a.ts\napps/github/readme.md\nREADME.md').rows;
  expect(rows[0]).toMatchObject({ owners: ['@octocat'], line: 1 });
  // The line with no owners decided this path, and says so: a line number, no owners.
  expect(rows[1]).toMatchObject({ owners: [], line: 2, pattern: '/apps/github' });
  // No line matched at all: no deciding line.
  expect(rows[2]).toMatchObject({ owners: [], line: null, pattern: '' });
  // Nothing was thrown and nothing is listed as skipped: a pattern with no owners is an ordinary line.
  expect(codeownersRows(file, 'apps/github/x').skipped).toEqual([]);
});

interface TableGroup {
  name: string;
  pattern: string;
  paths: Record<string, boolean>;
}

it('the 153 path cases of the vendored pattern table agree except the one bracket case listed by name', () => {
  // hmarr/codeowners testdata/patterns.json at 11d3ff26, blob 1006cea0 (MIT): 30 pattern groups, each path with whether the
  // pattern matches it. Every case is matched here as a one-line CODEOWNERS file.
  const groups = JSON.parse(
    readFileSync(new URL('./fixtures/codeowners/patterns.json', import.meta.url), 'utf8'),
  ) as TableGroup[];
  const differences: { name: string; pattern: string; path: string; table: boolean; here: boolean }[] = [];
  let cases = 0;
  for (const group of groups) {
    const { rules } = parseCodeowners(group.pattern + ' @o');
    for (const [path, expected] of Object.entries(group.paths)) {
      cases += 1;
      const here = rules[0]?.matches(path) ?? false;
      if (here !== expected)
        differences.push({ name: group.name, pattern: group.pattern, path, table: expected, here });
    }
  }
  expect(cases).toBe(153);
  // The one difference is by design: that table reads [param] with literal brackets, while GitHub's page says [ ] "doesn't
  // work", so this page lists the line as unsupported and matches nothing.
  expect(differences).toEqual([
    {
      name: 'pattern with square brackets',
      pattern: '/apps/[param]/file.ts',
      path: 'apps/[param]/file.ts',
      table: true,
      here: false,
    },
  ]);
  const skipped = parseCodeowners('/apps/[param]/file.ts @o').skipped;
  expect(skipped).toHaveLength(1);
  expect(skipped[0]).toMatchObject({ line: 1, documented: true });
  expect(skipped[0]?.reason).toContain('[ ]');
});

interface SecondMatcherRecording {
  recordedAt: string;
  package: string;
  version: string;
  seed: number;
  pairs: [string, string, boolean][];
  differences: { pattern: string; path: string; theirs: boolean; ours: boolean; reason: string }[];
}

/**
 * Why a pair is a difference. The one family known is a double star followed by a trailing slash. Any other difference
 * has no known reason, so this fails rather than record a reason that may not apply (20-REVIEW-A, A-IN-04): a new
 * difference must be looked at and given its own reason here first.
 */
function explainDifference(pattern: string): string {
  if (pattern.endsWith('**/')) {
    return 'a double star followed by a trailing slash: the vendored table (hmarr/codeowners) says foo/**/ owns foo/bar, so this page does too, while codeowners 0.9.0 wants one more directory level below the double star';
  }
  throw new Error(
    `The pattern ${JSON.stringify(pattern)} disagrees with codeowners 0.9.0 in no known family of differences. Look at it and name its reason before recording it.`,
  );
}

it('the recorded second matcher agrees on every generated pair except the differences listed by name, all in runs of stars and slashes', () => {
  // codeowners 0.9.0 (MIT) was asked about 3,498 seeded (pattern, path) pairs by record-second-matcher.py; the answers are
  // stored in second-matcher.json. Each pair is one pattern line, and a line this page lists as unsupported matches nothing.
  const file = new URL('./fixtures/codeowners/second-matcher.json', import.meta.url);
  const recording = JSON.parse(readFileSync(file, 'utf8')) as SecondMatcherRecording;
  expect(recording.package).toBe('codeowners');
  expect(recording.version).toBe('0.9.0');
  expect(recording.seed).toBe(31);
  expect(recording.pairs).toHaveLength(3498);

  const found: SecondMatcherRecording['differences'] = [];
  for (const [pattern, path, theirs] of recording.pairs) {
    const rules = parseCodeowners(pattern + ' @o').rules;
    const ours = rules[0]?.matches(path) ?? false;
    if (ours !== theirs) found.push({ pattern, path, theirs, ours, reason: explainDifference(pattern) });
  }
  if (process.env['RECORD_DIFFERENCES'] === '1') {
    writeFileSync(file, JSON.stringify({ ...recording, differences: found }) + '\n');
  }
  // The list in the file is explicit and complete: the same pairs, the same answers, a reason for each.
  const listed = recording.differences;
  expect(found.map(({ pattern, path, theirs, ours }) => ({ pattern, path, theirs, ours }))).toEqual(
    listed.map(({ pattern, path, theirs, ours }) => ({ pattern, path, theirs, ours })),
  );
  for (const difference of listed) {
    expect(difference.pattern, difference.pattern).toMatch(/[*/]/);
    // The recorded reason is the one its family gives, so a reason cannot be kept for a pair it does not explain.
    expect(difference.reason, difference.pattern).toBe(explainDifference(difference.pattern));
  }
  // Agreement is the rule: at least 99 percent of the pairs.
  expect(recording.pairs.length - listed.length).toBeGreaterThanOrEqual(Math.floor(recording.pairs.length * 0.99));
});

it('negation, an escaped hash and bracket ranges are listed as unsupported with the documented reason and match nothing', () => {
  // GitHub: "Using `!` to negate a pattern doesn't work", "Escaping a pattern starting with `#` using `\` so it is treated as
  // a pattern and not a comment doesn't work" and "Using `[ ]` to define a character range doesn't work".
  const text = ['# comment', '!foo @a', '\\#bar @b', '*.[ch] @c', '/src/x]y @d', '*.md @e'].join('\n');
  const { rules, skipped } = parseCodeowners(text);
  expect(skipped.map((s) => s.line)).toEqual([2, 3, 4, 5]);
  expect(skipped.every((s) => s.documented)).toBe(true);
  expect(skipped[0]?.reason).toContain('negate');
  expect(skipped[1]?.reason).toContain('escaping a leading #');
  expect(skipped[2]?.reason).toContain('[ ]');
  expect(skipped[3]?.reason).toContain('[ ]');
  for (const entry of skipped) expect(entry.reason).toContain('does not work');
  // Only the ordinary line is a rule, and its line number counts the comment and the skipped lines.
  expect(rules.map((r) => r.line)).toEqual([6]);
  // The unsupported lines match nothing, whatever they would have matched had they been read.
  const rows = codeownersRows(text, 'foo\n#bar\nx.c\nx.h\nsrc/xay\nsrc/x]y\nREADME.md').rows;
  expect(rows.map((row) => row.line)).toEqual([null, null, null, null, null, null, 6]);
});

it('three or more stars in a row are listed as not documented and match nothing', () => {
  const { rules, skipped } = parseCodeowners('a***b @a\n*** @b\nsrc/***/x @c\n** @d\na**b @e\n');
  expect(skipped.map((s) => s.line)).toEqual([1, 2, 3]);
  expect(skipped.every((s) => !s.documented)).toBe(true);
  expect(skipped[0]?.reason).toContain('three or more stars');
  // Two stars in a row are not three: those lines are rules.
  expect(rules.map((r) => r.line)).toEqual([4, 5]);
  const rows = codeownersRows('a***b @a\n*** @b\nsrc/***/x @c\n', 'a123b\nanything\nsrc/q/x').rows;
  expect(rows.map((row) => row.owners)).toEqual([[], [], []]);
});

it('owners are shape checked and a line with a malformed owner is skipped and listed', () => {
  // GitHub names three forms: "@username", "@org/team-name" and an email address. The exact shapes are not documented by
  // GitHub; this page's loose reading accepts letters, digits, hyphen, underscore and dot in a name.
  expect(OWNER_SHAPES.map((shape) => shape.shape)).toEqual(['user', 'team', 'email']);
  const good = [
    '@name',
    '@octocat',
    '@a-b_c.d',
    '@org/team',
    '@octo-org/octocats',
    'docs@example.com',
    'first.last+tag@sub.example.com',
  ];
  for (const owner of good) {
    const { rules, skipped } = parseCodeowners('* ' + owner);
    expect(skipped, owner).toEqual([]);
    expect(rules[0]?.owners, owner).toEqual([owner]);
  }
  const bad = [
    '@',
    '@org/',
    '@/team',
    '/team',
    '@org/team/x',
    '@@a',
    'a@b',
    'a@.com',
    'a@b..com',
    'a@b.',
    'a@',
    'plain',
    '@a#b',
    '@a$b',
  ];
  for (const owner of bad) {
    const { rules, skipped } = parseCodeowners('# first\n*.js @js-owner\n*.go ' + owner + '\n');
    expect(
      rules.map((r) => r.line),
      owner,
    ).toEqual([2]);
    expect(skipped, owner).toHaveLength(1);
    expect(skipped[0]?.line, owner).toBe(3);
    expect(skipped[0]?.documented, owner).toBe(false);
    expect(skipped[0]?.reason, owner).toContain('@username');
    expect(skipped[0]?.reason, owner).toContain('email address');
  }
  // One bad owner among good ones skips the whole line; the line then matches nothing.
  const mixed = codeownersRows('* @good @bad/\n', 'a.txt');
  expect(mixed.skipped).toHaveLength(1);
  expect(mixed.rows[0]).toMatchObject({ owners: [], line: null });
});

it('an inline comment after the owners ends the line and comment and blank lines are skipped', () => {
  // GitHub's example line: "*.js    @js-owner #This is an inline comment."
  const text = [
    '# A comment line',
    '',
    '   # an indented comment',
    '\t',
    '*.js    @js-owner #This is an inline comment.',
    '*.go\tdocs@example.com\t# tab separated #not an owner',
    '/apps/github #only a comment, so no owners',
    'a#b @hash',
  ].join('\n');
  const { rules, skipped } = parseCodeowners(text);
  expect(skipped).toEqual([]);
  // Line numbers count every pasted line, comments and blank lines included.
  expect(rules.map((r) => r.line)).toEqual([5, 6, 7, 8]);
  expect(rules[0]).toMatchObject({ pattern: '*.js', owners: ['@js-owner'] });
  expect(rules[1]).toMatchObject({ pattern: '*.go', owners: ['docs@example.com'] });
  expect(rules[2]).toMatchObject({ pattern: '/apps/github', owners: [] });
  // A # inside a pattern is part of the pattern; only an owner position that starts with # is a comment.
  expect(rules[3]).toMatchObject({ pattern: 'a#b', owners: ['@hash'] });
  expect(owns('a#b', 'x/a#b')).toBe(true);
});

it('paths are case sensitive and a path ending in a slash is refused with its line number', () => {
  // GitHub: "CODEOWNERS paths are case sensitive, because GitHub uses a case sensitive file system."
  const rows = codeownersRows('README.md @a\n', 'README.md\nreadme.md\nReadMe.MD').rows;
  expect(rows.map((row) => row.owners)).toEqual([['@a'], [], []]);
  expect(owns('*.JS', 'x.js')).toBe(false);
  expect(owns('*.JS', 'x.JS')).toBe(true);

  // Every pasted path names a file: a path that ends with / is refused, naming its line and never its text.
  const text = '* @a\n';
  const paths = 'ok.txt\n\n' + MARKER + '/\nlast.txt';
  for (const run of [() => checkCodeownersInput(text, paths), () => codeownersRows(text, paths)]) {
    const err = refusal(run);
    expect(err.part).toBe('paths');
    expect(err.line).toBe(3);
    expect(err.message).toContain('Line 3');
    expect(err.message).not.toContain(MARKER);
  }
  // A path with a trailing slash alone on the first line is line 1.
  expect(refusal(() => checkCodeownersInput(text, 'src/')).line).toBe(1);
});

it('two rules with the same pattern are decided by the later line and paths keep their pasted order', () => {
  const text = '# top\n*.js @first\n\n\n*.js @second\n';
  const rows = codeownersRows(text, 'b.js\na.js\nb.js\n\nc.md').rows;
  // The later of two identical patterns decides (line 5 of the paste, not line 2).
  expect(rows.map((row) => row.path)).toEqual(['b.js', 'a.js', 'b.js', 'c.md']);
  expect(rows.map((row) => row.line)).toEqual([5, 5, 5, null]);
  expect(rows.map((row) => row.owners)).toEqual([['@second'], ['@second'], ['@second'], []]);
  // A path pasted twice gives two equal rows.
  expect(rows[2]).toEqual(rows[0]);
  // A pattern with no owners after an owned one leaves the path with no owner.
  const unset = decide('*.js @a\n*.js\n', 'x.js');
  expect(unset).toMatchObject({ owners: [], line: 2, pattern: '*.js' });
  // One rule and one path give one row.
  expect(codeownersRows('* @a', 'x').rows).toHaveLength(1);
});

it('an empty file gives every path no owner and an empty path list gives no rows', () => {
  for (const text of [
    '',
    '\n\n',
    '# only a comment\n   # and another\n\n',
    '\ufeff# a byte order mark and a comment\r\n',
  ]) {
    const result = codeownersRows(text, 'a.txt\nsrc/b.ts');
    expect(result.skipped, text).toEqual([]);
    expect(
      result.rows.map((row) => [row.owners, row.line]),
      text,
    ).toEqual([
      [[], null],
      [[], null],
    ]);
  }
  expect(codeownersRows('* @a', '').rows).toEqual([]);
  expect(codeownersRows('* @a', '\n  \n').rows).toEqual([]);
  expect(ownersForPaths([], '')).toEqual([]);
  // A byte order mark and Windows line ends are read as the other two modes read them.
  const windows = codeownersRows('\ufeff* @a\r\n*.js @b\r\n', 'x.js\r\ny.md');
  expect(windows.rows.map((row) => row.owners)).toEqual([['@b'], ['@a']]);
  expect(windows.rows.map((row) => row.line)).toEqual([2, 1]);
});

it('a paste over 600,000 characters, over 5,000 rules or a line over 4,000 characters is refused before matching', () => {
  expect(MAX_CODEOWNERS_CHARACTERS).toBe(600_000);
  expect(MAX_CODEOWNERS_RULES).toBe(5_000);
  expect(MAX_CODEOWNERS_LINE_CHARACTERS).toBe(4_000);

  // 600,000 characters of comment lines are read; one more is refused, naming GitHub's own limit of 3 MB.
  const comments = ('#' + 'x'.repeat(98) + '\n').repeat(6_000);
  expect(comments).toHaveLength(600_000);
  expect(() => checkCodeownersInput(comments, 'a')).not.toThrow();
  const over = refusal(() => checkCodeownersInput(comments + 'x', 'a'));
  expect(over.part).toBe('patterns');
  expect(over.message).toContain('600,001 characters');
  expect(over.message).toContain('600,000');
  expect(over.message).toContain('3 MB');

  // 5,000 rules are read, comments and blank lines between them do not count, and the 5,001st is refused with its line.
  const rule = (i: number) => `file${i} @o`;
  const fiveThousand = Array.from({ length: 5_000 }, (_, i) => rule(i)).join('\n#c\n\n');
  expect(() => checkCodeownersInput(fiveThousand, 'a')).not.toThrow();
  const many = refusal(() => checkCodeownersInput(fiveThousand + '\n#c\n' + rule(5_000), 'a'));
  expect(many.part).toBe('patterns');
  expect(many.line).toBe(15_000);
  expect(many.message).toContain('5,000');

  // A line of 4,000 characters is read; 4,001 is refused with its number.
  expect(() => checkCodeownersInput('a @o\n' + 'b'.repeat(4_000), 'a')).not.toThrow();
  const longLine = refusal(() => checkCodeownersInput('a @o\n# c\n' + 'b'.repeat(4_001), 'a'));
  expect(longLine.part).toBe('patterns');
  expect(longLine.line).toBe(3);
  expect(longLine.message).toBe('Line 3 of the CODEOWNERS file is longer than 4,000 characters.');

  // The paths keep the limits the other modes have: 5,000 paths of up to 1,024 characters.
  expect(() => checkCodeownersInput('a', Array.from({ length: 5_000 }, () => 'p').join('\n'))).not.toThrow();
  const manyPaths = refusal(() => checkCodeownersInput('a', Array.from({ length: 5_001 }, () => 'p').join('\n')));
  expect(manyPaths.part).toBe('paths');
  expect(manyPaths.line).toBe(5_001);
  const longPath = refusal(() => checkCodeownersInput('a', 'p\n' + 'q'.repeat(1_025)));
  expect(longPath.line).toBe(2);
  expect(() => checkCodeownersInput('a', 'q'.repeat(1_024))).not.toThrow();

  // Through the package entry point the refusal comes before any rule is read or any path is matched.
  const job = (patterns: string, paths: string) => ({
    mode: 'codeowners' as const,
    patterns,
    paths,
    dot: false,
    nocase: false,
  });
  expect(() => testPatterns(job(comments + 'x', 'a'))).toThrow(GlobTesterError);
  expect(() => testPatterns(job(fiveThousand + '\n' + rule(5_000), 'a'))).toThrow(GlobTesterError);
  // The CODEOWNERS paste may be longer than the 64,000 characters the other two modes allow.
  expect(() => testPatterns(job(comments, 'a'))).not.toThrow();
  expect(() => testPatterns({ ...job(comments, 'a'), mode: 'glob' })).toThrow(GlobTesterError);
});

it('refusals name a line and never repeat pasted text', () => {
  const longRule = 'a'.repeat(3_000) + MARKER + 'b'.repeat(1_100);
  const cases: { run: () => unknown; line: number | undefined }[] = [
    { run: () => checkCodeownersInput('# c\n' + longRule, 'a'), line: 2 },
    {
      run: () => checkCodeownersInput(Array.from({ length: 5_001 }, () => MARKER + ' @o').join('\n'), 'a'),
      line: 5_001,
    },
    { run: () => checkCodeownersInput('*', '/' + MARKER), line: 1 },
    { run: () => checkCodeownersInput('*', 'a\n./' + MARKER), line: 2 },
    { run: () => checkCodeownersInput('*', 'a\nb\n../' + MARKER + '/x'), line: 3 },
    { run: () => checkCodeownersInput('*', 'a//' + MARKER), line: 1 },
    { run: () => checkCodeownersInput('*', 'C:/' + MARKER), line: 1 },
    { run: () => checkCodeownersInput('*', MARKER + '/'), line: 1 },
    { run: () => checkCodeownersInput('*', 'a' + String.fromCharCode(92) + MARKER), line: 1 },
    { run: () => codeownersRows('*', 'ok\n' + MARKER + '/'), line: 2 },
    { run: () => checkCodeownersInput('x'.repeat(MAX_CODEOWNERS_CHARACTERS + 1), 'a'), line: undefined },
  ];
  for (const { run, line } of cases) {
    const err = refusal(run);
    expect(err.message).not.toContain(MARKER);
    expect(err.line).toBe(line);
    if (line !== undefined) expect(err.message).toContain('Line ' + line);
  }
  // Lines that are listed as unsupported or skipped give a fixed reason; the pasted text appears only in the shown pattern,
  // which is cut at 40 characters.
  const hostile = [
    '!' + MARKER + ' @o',
    '[' + MARKER + ' @o',
    MARKER + '*** @o',
    'ok @' + MARKER + '/',
    'q'.repeat(100) + '[ @o',
  ].join('\n');
  const { skipped } = parseCodeowners(hostile);
  expect(skipped).toHaveLength(5);
  for (const entry of skipped) {
    expect(entry.reason).not.toContain(MARKER);
    expect(entry.shown.length).toBeLessThanOrEqual(41);
  }
  expect(skipped[4]?.shown).toBe('q'.repeat(40) + String.fromCodePoint(0x2026));
});

it('patterns and owners named __proto__, constructor and toString are plain text', () => {
  const text = '__proto__ @constructor\nconstructor @toString\ntoString @__proto__\n*.hasOwnProperty @valueOf\n';
  const { rules, skipped } = parseCodeowners(text);
  expect(skipped).toEqual([]);
  expect(rules.map((r) => [r.pattern, r.owners])).toEqual([
    ['__proto__', ['@constructor']],
    ['constructor', ['@toString']],
    ['toString', ['@__proto__']],
    ['*.hasOwnProperty', ['@valueOf']],
  ]);
  const rows = codeownersRows(text, '__proto__\nconstructor\ntoString\nvalueOf\nx.hasOwnProperty').rows;
  expect(rows.map((row) => row.owners)).toEqual([['@constructor'], ['@toString'], ['@__proto__'], [], ['@valueOf']]);
  expect(rows.map((row) => row.line)).toEqual([1, 2, 3, null, 4]);
  // Nothing was added to the base object.
  expect(({} as Record<string, unknown>)['owners']).toBeUndefined();
  expect(({} as Record<string, unknown>)['line']).toBeUndefined();
  expect(Object.keys(Object.prototype)).toEqual([]);
});

/** Pairs of a CODEOWNERS file and a path in one string, split at a NUL character, so a size-scaling helper can time them. */
function answerPair(input: string): unknown {
  const cut = input.indexOf('\u0000');
  return codeownersRows(input.slice(0, cut), input.slice(cut + 1));
}

it('the matcher builds no regular expression from pasted text and stays linear on hostile patterns and paths', () => {
  // No regular expression is built while answering: the RegExp constructor is counted.
  const OriginalRegExp = globalThis.RegExp;
  let built = 0;
  globalThis.RegExp = new Proxy(OriginalRegExp, {
    construct(target, args, newTarget) {
      built += 1;
      return Reflect.construct(target, args, newTarget);
    },
    apply(target, thisArg, args) {
      built += 1;
      return Reflect.apply(target, thisArg, args);
    },
  });
  try {
    const hostileLines = [
      'a*'.repeat(200) + 'b',
      '**/'.repeat(100) + 'x',
      '?'.repeat(300),
      '(a+)+$',
      '[[]',
      '.*.*.*.*x',
      'a/**/'.repeat(80) + 'b',
    ];
    answerPair(hostileLines.join('\n') + '\u0000' + 'a/'.repeat(300) + 'a');
    for (const line of hostileLines) answerPair(line + ' @o\u0000' + 'a'.repeat(500));
  } finally {
    globalThis.RegExp = OriginalRegExp;
  }
  expect(built).toBe(0);

  // Hostile shapes, sized so the doubled and the quadrupled input stay under the 4,000 character line limit.
  // Each is a CODEOWNERS file, a NUL character and a path.
  const shapes: Array<[string, (n: number) => string]> = [
    ['stars between letters', (n) => 'a*'.repeat(Math.floor(n / 2)) + 'b @o\u0000' + 'a'.repeat(n)],
    ['letters after stars', (n) => '*a'.repeat(Math.floor(n / 2)) + '*b @o\u0000' + 'a'.repeat(n)],
    [
      'double stars between segments',
      (n) => '**/'.repeat(Math.floor(n / 3)) + 'x @o\u0000' + 'a/'.repeat(Math.floor(n / 2)) + 'a',
    ],
    [
      'segments between double stars',
      (n) => 'a/**/'.repeat(Math.floor(n / 5)) + 'b @o\u0000' + 'a/'.repeat(Math.floor(n / 2)) + 'a',
    ],
    ['question marks', (n) => '?'.repeat(n) + ' @o\u0000' + 'a'.repeat(n)],
    ['a long path against a plain pattern', (n) => '*.js @o\u0000' + 'a/'.repeat(Math.floor(n / 2)) + 'x'],
    ['slashes', (n) => '/'.repeat(n) + ' @o\u0000' + 'a/'.repeat(Math.floor(n / 2)) + 'a'],
    ['many rules', (n) => '*.js @o\n'.repeat(Math.floor(n / 8)) + '\u0000' + 'a/b.c'],
    ['many comment lines', (n) => '#\n'.repeat(Math.floor(n / 2)) + '* @o\u0000' + 'a/b.c'],
    ['many blank owners', (n) => 'a' + ' @o'.repeat(Math.floor(n / 3)) + '\u0000' + 'a'],
    // A star must give way at every letter of the path, and the letters after it run half the path, so a walk that
    // re-reads them at each letter costs about the square of the path (20-REVIEW-A, A-WR-01).
    [
      'a star that gives way inside the path',
      (n) => '*' + 'a'.repeat(Math.floor(n / 2)) + 'b @o\u0000' + 'a'.repeat(n),
    ],
    ['a star, letters and a question mark', (n) => '*' + 'a'.repeat(Math.floor(n / 2)) + '?b @o\u0000' + 'a'.repeat(n)],
    [
      'a double star that gives way inside the path',
      (n) => '**/' + 'a/'.repeat(Math.floor(n / 4)) + 'b @o\u0000' + 'a/'.repeat(Math.floor(n / 2)) + 'a',
    ],
    [
      'a double star, names and a trailing slash',
      (n) => '**/' + 'a/'.repeat(Math.floor(n / 4)) + 'b/ @o\u0000' + 'a/'.repeat(Math.floor(n / 2)) + 'a',
    ],
  ];
  const median = (values: number[]) => [...values].sort((x, y) => x - y)[1] as number;
  for (const [name, make] of shapes) {
    // The doubling rule (2n against n, over 6 fails) and, because it does not catch quadratic growth by itself, an input
    // four times as long against a limit of 12: the doubling from n to 2n times the doubling from 2n to 4n. Each is the
    // median of three measurements, so one slow moment on a busy machine decides nothing.
    const doublings: number[] = [];
    const fourfold: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const first = scalingRatio(answerPair, make, 450);
      const second = scalingRatio(answerPair, make, 900);
      doublings.push(first);
      fourfold.push(first * second);
    }
    expect(Number.isFinite(median(doublings)), name).toBe(true);
    expect(median(doublings), name).toBeLessThanOrEqual(MAX_SCALING_RATIO);
    expect(median(fourfold), name).toBeLessThanOrEqual(12);
  }

  // The longest line against the longest path (a 4,000 character line against a 1,024 character path) is answered, not
  // abandoned. A part that starts with a question mark or a wildcard name is tried place by place and is not linear; the
  // work budget bounds it (the next test).
  const worst = codeownersRows('*' + 'a'.repeat(3_990) + 'b @o', 'a'.repeat(1_024)).rows;
  expect(worst[0]?.owners).toEqual([]);
  const manyRules = codeownersRows(Array.from({ length: 5_000 }, (_, i) => `*.ext${i} @o`).join('\n'), 'src/a/b/c.txt');
  expect(manyRules.rows[0]?.line).toBeNull();
});

it('a paste whose matching would exceed the work budget is refused in plain words naming the path line', () => {
  expect(MAX_CODEOWNERS_WORK).toBe(300_000_000);
  const sentence = (line: number) =>
    `Matching stopped at line ${line} of the paths: this CODEOWNERS file and these paths need more matching work than this page allows (300,000,000 steps). Try fewer paths or fewer rules.`;

  // The paste of the review (20-REVIEW-A, A-WR-01): 1,158 lines of a star, 512 letters a and a b, inside every limit,
  // against 5,000 paths of 1,024 letters a. It took about 1 second a path before the budget, so 5,000 paths would have
  // run for over an hour; now the work is counted and the paste is refused, at the same path line every time.
  const line = '*' + 'a'.repeat(512) + 'b @o';
  const file = ['# ' + MARKER, ...Array.from({ length: 1_158 }, () => line)].join('\n');
  const paths = [MARKER + '/a.txt', ...Array.from({ length: 4_999 }, () => 'a'.repeat(1_024))].join('\n');
  expect(file.length).toBeLessThanOrEqual(MAX_CODEOWNERS_CHARACTERS);
  expect(() => checkCodeownersInput(file, paths)).not.toThrow();
  const first = refusal(() => codeownersRows(file, paths));
  expect(first.part).toBe('paths');
  const stoppedAt = first.line as number;
  expect(stoppedAt).toBeGreaterThan(1);
  expect(stoppedAt).toBeLessThan(5_000);
  expect(first.message).toBe(sentence(stoppedAt));
  expect(first.message).not.toContain(MARKER);
  // Every entry point that matches a whole paste counts the same work and stops at the same line.
  const job = { mode: 'codeowners' as const, patterns: file, paths, dot: false, nocase: false };
  for (const run of [() => testPatterns(job), () => ownersForPaths(parseCodeowners(file).rules, paths)]) {
    const again = refusal(run);
    expect(again.line).toBe(stoppedAt);
    expect(again.message).toBe(first.message);
  }

  // A part that starts with a question mark is tried at every letter, so one such rule and one long path cost about
  // the square of the path: one path against 1,158 of them is already past the budget, and line 1 is named.
  const question = Array.from({ length: 1_158 }, () => '*?' + 'a'.repeat(510) + 'b @o').join('\n');
  const one = refusal(() => codeownersRows(question, 'a'.repeat(1_024) + '\n' + 'a'.repeat(1_024)));
  expect(one.line).toBe(1);
  expect(one.message).toBe(sentence(1));

  // An ordinary paste of the same size is answered: 5,000 rules for folders at the top against 5,000 paths of eight
  // folders that the last 4,999 rules never match (every path is tried against every rule), and the first rule decides
  // the paths it names.
  const folders = [
    '/packages/pkg7/ @org/seven',
    ...Array.from({ length: 4_999 }, (_, i) => `/component${i}/ @org/team-${i % 50}`),
  ].join('\n');
  const many = Array.from(
    { length: 5_000 },
    (_, i) => `packages/pkg${i % 300}/src/lib/feature${i}/internal/helpers/file${i}.ts`,
  ).join('\n');
  const rows = codeownersRows(folders, many).rows;
  expect(rows).toHaveLength(5_000);
  const owned = rows.filter((row) => row.line !== null);
  expect(owned.map((row) => row.path)).toEqual(
    rows.filter((row) => row.path.startsWith('packages/pkg7/')).map((row) => row.path),
  );
  expect(owned.every((row) => row.line === 1 && row.owners[0] === '@org/seven')).toBe(true);
}, 120_000);

/** A seeded generator (mulberry32), so the random names are the same on every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The usual two-pointer walk for wildcards over the UTF-16 units of one name, the way this matcher read a name before
 * its parts were searched in one pass: a run of stars is one star, a star gives way one whole character at a time, and a
 * question mark takes one character, a surrogate pair counting as one.
 */
function walkName(pattern: string, name: string): boolean {
  const codes: number[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const code = pattern.charCodeAt(i);
    if (code === 42) {
      if (codes[codes.length - 1] !== -2) codes.push(-2);
    } else codes.push(code === 63 ? -1 : code);
  }
  const units = (i: number): number => {
    const high = name.charCodeAt(i);
    const low = name.charCodeAt(i + 1);
    return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff ? 2 : 1;
  };
  let p = 0;
  let t = 0;
  let starAt = -1;
  let starText = 0;
  while (t < name.length) {
    if (p < codes.length && codes[p] === -2) {
      starAt = p;
      starText = t;
      p += 1;
    } else if (p < codes.length && codes[p] === -1) {
      t += units(t);
      p += 1;
    } else if (p < codes.length && codes[p] === name.charCodeAt(t)) {
      p += 1;
      t += 1;
    } else if (starAt >= 0) {
      starText += units(starText);
      t = starText;
      p = starAt + 1;
    } else return false;
  }
  while (p < codes.length && codes[p] === -2) p += 1;
  return p === codes.length;
}

/**
 * The same walk over the folders of a path: `**` is any number of folders, `*` is one folder that is not empty, any other
 * name is that folder, and a pattern that ends with a name also owns everything under it.
 */
function walkFolders(pattern: string[], segments: string[]): boolean {
  const tokens = [...pattern];
  if (tokens[tokens.length - 1] !== '*') tokens.push('**');
  let t = 0;
  let s = 0;
  let starAt = -1;
  let starSegment = 0;
  while (s < segments.length) {
    const token = tokens[t];
    const segment = segments[s] as string;
    if (token === '**') {
      starAt = t;
      starSegment = s;
      t += 1;
    } else if (token !== undefined && (token === '*' ? segment.length > 0 : token === segment)) {
      t += 1;
      s += 1;
    } else if (starAt >= 0) {
      starSegment += 1;
      s = starSegment;
      t = starAt + 1;
    } else return false;
  }
  while (tokens[t] === '**') t += 1;
  return t === tokens.length;
}

it('the matcher gives the answers of the two-pointer walk for wildcards on seeded random names and folders', () => {
  const random = seeded(2031);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const high = String.fromCharCode(0xd83d);
  const low = String.fromCharCode(0xde00);
  const nameParts = ['a', 'b', 'a', 'ab', 'aa', 'ba', '*', '*', '?', high, low, high + low];
  const textParts = ['a', 'b', 'a', 'a', 'ab', 'aab', high, low, high + low];
  let names = 0;
  for (let i = 0; i < 20_000; i++) {
    let pattern = '';
    for (let k = 1 + Math.floor(random() * 8); k > 0; k--) pattern += pick(nameParts);
    // A name that is only a star, or a double star, is a folder token rather than a name; three stars are unsupported.
    if (pattern === '*' || pattern === '**' || pattern.includes('***')) continue;
    let name = '';
    for (let k = 1 + Math.floor(random() * 10); k > 0; k--) name += pick(textParts);
    // A leading slash anchors the one name at the top; the rule owns the path when its first folder matches.
    const rule = parseCodeowners('/' + pattern + ' @o').rules[0];
    expect(rule, pattern).toBeDefined();
    const path = random() < 0.5 ? name : name + '/x';
    expect(rule?.matches(path), JSON.stringify([pattern, path])).toBe(walkName(pattern, name));
    names += 1;
  }
  expect(names).toBeGreaterThan(15_000);

  const folderParts = ['a', 'b', 'c', 'a', '**', '*'];
  let folders = 0;
  for (let i = 0; i < 20_000; i++) {
    const pattern: string[] = [];
    for (let k = 1 + Math.floor(random() * 6); k > 0; k--) pattern.push(pick(folderParts));
    // Kept to the forms the walk above reads the same way: no double star at the end and no two in a row.
    if (pattern[pattern.length - 1] === '**' || pattern.some((p, k) => p === '**' && pattern[k + 1] === '**')) continue;
    const segments: string[] = [];
    for (let k = 1 + Math.floor(random() * 12); k > 0; k--) segments.push(pick(['a', 'b', 'c', 'a']));
    const rule = parseCodeowners('/' + pattern.join('/') + ' @o').rules[0];
    expect(rule?.matches(segments.join('/')), JSON.stringify([pattern, segments])).toBe(walkFolders(pattern, segments));
    folders += 1;
  }
  expect(folders).toBeGreaterThan(10_000);
});

it('question marks and backslash escapes are this page reading and are marked not documented by GitHub', () => {
  // ? is one character of a name (never a slash), and a backslash takes the next character as it is. GitHub documents
  // neither, so every row they decide carries the words not documented by GitHub.
  expect(owns('f?o', 'foo')).toBe(true);
  expect(owns('f?o', 'fo')).toBe(false);
  expect(owns('f?o', 'f/o')).toBe(false);
  // One character is one code point: an emoji is not two.
  expect(owns('a?b', 'a' + String.fromCodePoint(0x1f600) + 'b')).toBe(true);
  expect(owns('a??b', 'a' + String.fromCodePoint(0x1f600) + 'b')).toBe(false);
  expect(owns('f' + String.fromCharCode(92) + '*o', 'f*o')).toBe(true);
  expect(owns('f' + String.fromCharCode(92) + '*o', 'fxo')).toBe(false);
  const question = decide('f?o @o', 'foo');
  expect(question.note).toBe('not documented by GitHub: ?');
  const escape = decide('f' + String.fromCharCode(92) + '*o @o', 'f*o');
  expect(escape.note).toBe('not documented by GitHub: a backslash escape');
  // A pattern that uses only what GitHub shows carries no note.
  expect(decide('*.js @o', 'a.js').note).toBe('');
  expect(decide('/docs/ @o', 'docs/a.md').note).toBe('');
});

it('runs of stars and slashes are read as one at the ends and marked not documented by GitHub', () => {
  // GitHub documents no run of slashes and no run of double stars. This page reads a run of slashes at the start or the end
  // as one slash, a run of double stars as one, and leaves a run of slashes in the middle as an empty name that no real
  // path has, so that pattern owns nothing.
  expect(owns('//docs', 'docs/x')).toBe(true);
  expect(owns('//docs', 'lib/docs/x')).toBe(false);
  expect(owns('docs//', 'lib/docs/x')).toBe(true);
  expect(owns('a//b', 'a/b')).toBe(false);
  for (const path of ['a/b', 'a/x/b']) expect(owns('a/**/**/b', path), path).toBe(true);
  expect(owns('**/**', 'a/b')).toBe(true);
  expect(owns('**', 'a')).toBe(true);
  // A slash alone, or only slashes, is no pattern that names a file.
  expect(owns('//', 'a')).toBe(false);
  expect(owns('/', 'a')).toBe(false);
  // A double star and a trailing slash with nothing else means every file inside some directory.
  expect(owns('**/', 'a/b')).toBe(true);
  expect(owns('**/', 'a')).toBe(false);
  expect(decide('//docs @o', 'docs/x').note).toBe('not documented by GitHub: runs of ** or /');
  expect(decide('a/**/**/b @o', 'a/b').note).toBe('not documented by GitHub: runs of ** or /');
  expect(parseCodeowners('a//b @o').rules[0]?.note).toBe('not documented by GitHub: runs of ** or /');
  expect(decide('** @o', 'a').note).toBe('not documented by GitHub: a bare **');
  expect(decide('**/ @o', 'a/b').note).toBe('not documented by GitHub: a bare **');
  // The documented forms carry no note.
  expect(decide('**/logs @o', 'a/logs').note).toBe('');
  expect(decide('foo/**/bar @o', 'foo/bar').note).toBe('');
});

it('the package prints nothing while answering a CODEOWNERS file', () => {
  const spies = (['log', 'warn', 'error'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
  try {
    codeownersRows('!x @a\n*** @b\n* @c\n*.js @', 'a.js\nb/c.md');
    try {
      codeownersRows('* @a', 'dir/');
    } catch {
      // The refusal is the answer here.
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('the glob and gitignore modes give the same answers as before for the same job', () => {
  // The jobs and answers of the earlier tests (gitignore.test.ts "the deciding rule is the line number of the last matching
  // pattern" and glob.test.ts "glob mode names the first pattern line that matched each path"), through the package entry
  // point, which now also answers a third mode.
  const ignore = testPatterns({
    mode: 'gitignore',
    patterns: '*.log\n!keep.log\nbuild/',
    paths: 'debug.log\nkeep.log\nbuild/\nbuild/keep.txt',
    dot: false,
    nocase: false,
  });
  expect(ignore.mode).toBe('gitignore');
  if (ignore.mode !== 'gitignore') throw new Error('expected a gitignore result');
  expect(ignore.rows.map((row) => [row.path, row.ignored, row.decidedBy])).toEqual([
    ['debug.log', true, { kind: 'rule', line: 1, pattern: '*.log', negated: false }],
    ['keep.log', false, { kind: 'rule', line: 2, pattern: '!keep.log', negated: true }],
    ['build', true, { kind: 'rule', line: 3, pattern: 'build/', negated: false }],
    ['build/keep.txt', true, { kind: 'parent', directory: 'build/', line: 3, pattern: 'build/' }],
  ]);
  expect(ignore.regexes).toEqual([]);

  const glob = testPatterns({
    mode: 'glob',
    patterns: '*.ts\nsrc/**\n\n*.js\nsrc/a.ts',
    paths: ['src/a.ts', 'b.js', 'src/lib/c.js', 'z.md', 'a.ts'].join('\n'),
    dot: false,
    nocase: false,
  });
  expect(glob.mode).toBe('glob');
  if (glob.mode !== 'glob') throw new Error('expected a glob result');
  expect(glob.rows).toEqual([
    { path: 'src/a.ts', matched: true, line: 2, pattern: 'src/**', also: [5], moreAlso: 0 },
    { path: 'b.js', matched: true, line: 4, pattern: '*.js', also: [], moreAlso: 0 },
    { path: 'src/lib/c.js', matched: true, line: 2, pattern: 'src/**', also: [], moreAlso: 0 },
    { path: 'z.md', matched: false, line: null, pattern: '', also: [], moreAlso: 0 },
    { path: 'a.ts', matched: true, line: 1, pattern: '*.ts', also: [], moreAlso: 0 },
  ]);

  // The third mode answers the same text differently, as it should: a CODEOWNERS file is not a .gitignore file.
  const owners = testPatterns({
    mode: 'codeowners',
    patterns: '*.log @a\n!keep.log @b',
    paths: 'keep.log',
    dot: false,
    nocase: false,
  });
  expect(owners.mode).toBe('codeowners');
  if (owners.mode !== 'codeowners') throw new Error('expected a CODEOWNERS result');
  expect(owners.rows[0]).toMatchObject({ owners: ['@a'], line: 1 });
  expect(owners.skipped.map((s) => s.line)).toEqual([2]);
});
