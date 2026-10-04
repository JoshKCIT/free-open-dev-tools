/**
 * Records git's own decisions for the hand-written inputs in corpus-cases.json, so the unit tests can compare the tool
 * with git without ever running git themselves. Run by hand, never by the tests:
 *
 *   node tools/glob-tester/test/fixtures/record-git-corpus.mjs <scratch folder>
 *
 * Two corpora are written next to this script:
 *
 *   git-corpus.json           `git check-ignore -v -n -z --no-index --stdin` for every .gitignore case against every path
 *   git-pathspec-corpus.json  `git ls-files -z -- ":(glob)<pattern>"` for every glob pattern against a list of files
 *
 * How the .gitignore corpus is recorded (and why it takes two repositories):
 *   - core.ignorecase and core.autocrlf are set to false explicitly, because Git for Windows turns ignorecase on.
 *   - Files are queried in a repository with nothing on disk, so git treats every queried name as a file.
 *   - Directories are queried in a second repository where each directory exists, and WITHOUT a trailing slash:
 *     with a trailing slash git reads the part before it as a parent directory and matches an empty name, which is not
 *     a question about the directory itself.
 *   - Each case's text is written byte for byte as the repository's .gitignore (CR and byte order mark included).
 * The pathspec corpus puts every file straight into the index of a third repository (no file is written to disk, so
 * names Windows cannot create are still recorded) and asks git which files each pattern lists.
 *
 * Encoding: `r` is a comma separated list with one number per path, in the order of `paths`: 0 means no rule matched,
 * n means line n of the text matched and the path is ignored, -n means line n matched and it is a negation (the path is
 * not ignored). `printed` holds the pattern text git printed for each deciding line.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scratch = process.argv[2];
if (!scratch) {
  console.error('Usage: node record-git-corpus.mjs <scratch folder>');
  process.exit(1);
}
const work = join(scratch, 'git-corpus');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

function git(cwd, args, input) {
  const r = spawnSync('git', args, { cwd, input, maxBuffer: 1 << 28 });
  if (r.error) throw r.error;
  return r;
}

function newRepo(name) {
  const dir = mkdtempSync(join(work, name + '-'));
  const init = git(dir, ['init', '-q']);
  if (init.status !== 0) throw new Error('git init failed: ' + init.stderr.toString());
  git(dir, ['config', 'core.ignorecase', 'false']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  git(dir, ['config', 'core.quotepath', 'false']);
  return dir;
}

function encodeJson(value) {
  // Non-ASCII and control characters stay as JSON escapes so the file is plain ASCII and survives any editor.
  return JSON.stringify(value, null, 2).replace(/[^\x20-\x7e\n]/g, (c) => {
    return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
  });
}

const gitVersion = git(here, ['--version']).stdout.toString().trim();
const recordedAt = new Date().toISOString().slice(0, 10);
const cases = JSON.parse(readFileSync(join(here, 'corpus-cases.json'), 'utf8'));

// ---- .gitignore corpus ----
const filesRepo = newRepo('files');
const dirsRepo = newRepo('dirs');
const paths = cases.gitignorePaths;
const fileQueries = [];
const dirQueries = [];
paths.forEach((p, index) => {
  if (p.endsWith('/')) {
    const name = p.slice(0, -1);
    mkdirSync(join(dirsRepo, name), { recursive: true });
    dirQueries.push({ index, query: name });
  } else {
    fileQueries.push({ index, query: p });
  }
});

function checkIgnore(repo, queries) {
  const input = Buffer.from(queries.map((q) => q.query + '\0').join(''), 'utf8');
  const r = git(repo, ['check-ignore', '-v', '-n', '-z', '--no-index', '--stdin'], input);
  if (r.status !== 0 && r.status !== 1) throw new Error('git check-ignore failed: ' + r.stderr.toString());
  const fields = r.stdout.toString('utf8').split('\0');
  if (fields.length !== queries.length * 4 + 1) {
    throw new Error('unexpected check-ignore output: ' + fields.length + ' fields for ' + queries.length + ' paths');
  }
  return queries.map((q, i) => {
    const [source, line, pattern, path] = fields.slice(i * 4, i * 4 + 4);
    if (path !== q.query) throw new Error('git answered for another path: ' + JSON.stringify(path));
    return { index: q.index, source, line: line === '' ? 0 : Number(line), pattern };
  });
}

const corpusCases = [];
for (const c of cases.gitignoreCases) {
  for (const repo of [filesRepo, dirsRepo]) writeFileSync(join(repo, '.gitignore'), Buffer.from(c.text, 'utf8'));
  const decided = new Array(paths.length).fill(0);
  const printed = {};
  for (const [repo, queries] of [
    [filesRepo, fileQueries],
    [dirsRepo, dirQueries],
  ]) {
    for (const row of checkIgnore(repo, queries)) {
      if (row.line === 0) continue;
      const negated = row.pattern.startsWith('!');
      decided[row.index] = negated ? -row.line : row.line;
      printed[String(row.line)] = row.pattern;
    }
  }
  corpusCases.push({ id: c.id, text: c.text, r: decided.join(','), printed });
}

writeFileSync(
  join(here, 'git-corpus.json'),
  encodeJson({
    gitVersion,
    recordedAt,
    config: { 'core.ignorecase': 'false', 'core.autocrlf': 'false' },
    commands: [
      'git check-ignore -v -n -z --no-index --stdin (files: repository with nothing on disk; directories: repository where each exists, queried without a trailing slash)',
    ],
    paths,
    cases: corpusCases,
  }) + '\n',
);

// ---- :(glob) pathspec corpus ----
const specRepo = newRepo('pathspec');
// Git for Windows refuses to index names holding * or ? unless this is off; nothing is written to disk here.
git(specRepo, ['config', 'core.protectNTFS', 'false']);
const files = cases.globPaths;
const empty = git(specRepo, ['hash-object', '-w', '--stdin'], Buffer.alloc(0)).stdout.toString().trim();
const indexInfo = Buffer.from(files.map((f) => '100644 ' + empty + '\t' + f + '\0').join(''), 'utf8');
const add = git(specRepo, ['update-index', '--add', '-z', '--index-info'], indexInfo);
if (add.status !== 0) throw new Error('git update-index failed: ' + add.stderr.toString());
// Every file must really be in the index (git silently drops a name it refuses and replaces a file that is also a
// directory), or the recorded answers would be about a different list than the one the tests use.
const indexed = git(specRepo, ['ls-files', '-z']).stdout.toString('utf8').split('\0').filter((s) => s !== '');
if (indexed.length !== files.length || !files.every((f) => indexed.includes(f))) {
  throw new Error('the index does not hold exactly the corpus files: ' + indexed.length + ' of ' + files.length);
}

const patterns = cases.globPatterns.map((pattern) => {
  const r = git(specRepo, ['ls-files', '-z', '--', ':(glob)' + pattern]);
  if (r.status !== 0) throw new Error('git ls-files failed: ' + r.stderr.toString());
  const listed = new Set(r.stdout.toString('utf8').split('\0').filter((s) => s !== ''));
  const matches = [];
  files.forEach((f, i) => {
    if (listed.has(f)) matches.push(i);
  });
  if (matches.length !== listed.size) throw new Error('git listed a path that is not in the corpus');
  return { pattern, matches: matches.join(',') };
});

writeFileSync(
  join(here, 'git-pathspec-corpus.json'),
  encodeJson({
    gitVersion,
    recordedAt,
    config: { 'core.ignorecase': 'false' },
    commands: ['git ls-files -z -- ":(glob)<pattern>" (every file is in the index of a repository with nothing on disk)'],
    files,
    patterns,
  }) + '\n',
);

rmSync(work, { recursive: true, force: true });
console.log(gitVersion, recordedAt, 'gitignore cases', corpusCases.length, 'paths', paths.length, 'glob patterns', patterns.length);
