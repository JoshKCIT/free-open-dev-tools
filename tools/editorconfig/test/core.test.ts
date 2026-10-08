import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { fileLabel, resolveEditorConfig, resolveProperties, type PastedFile } from '../src/index';

/**
 * The EditorConfig project's published conformance tests (editorconfig-core-test, commit 895b3a65, BSD-2-Clause) are
 * vendored byte for byte in test/fixtures/core-test/ (see UPSTREAM.md there) and run here in full: 198 cases in the glob,
 * parser, properties and filetree folders, of which 196 are run and two are excluded by name. cases.json is rebuilt from the
 * vendored CMake files by extract-cases.mjs; a test below compares the rebuilt text with the file.
 *
 * The recorded comparison with the editorconfig 3.0.2 library (test/fixtures/differential/) is read here too.
 */

const CORE = new URL('./fixtures/core-test/', import.meta.url);
const DIFFERENTIAL = new URL('./fixtures/differential/differential.json', import.meta.url);

interface CoreCase {
  name: string;
  folder: string;
  files: Array<{ dir: string; source: string }>;
  path: string;
  expected: string;
  ordered: boolean;
}
interface CoreCases {
  commit: string;
  cases: CoreCase[];
  excluded: Array<{ name: string; reason: string }>;
}

const read = (relative: string): string => readFileSync(new URL(relative, CORE), 'utf8');
const casesFile = (): CoreCases => JSON.parse(read('cases.json')) as CoreCases;

/** The text the reference command prints for a result: one key=value line per property, sorted when the case says so. */
function printed(properties: Array<{ key: string; value: string }>, ordered: boolean): string {
  let lines = properties.map((p) => `${p.key}=${p.value}`);
  if (!ordered) lines = lines.sort();
  return lines.length === 0 ? '' : lines.join('\n') + '\n';
}

/** The core tests compare the printed text with a regular expression; a multiline case allows leading line ends. */
function passes(text: string, c: CoreCase): boolean {
  return (c.ordered ? new RegExp(c.expected) : new RegExp('^[\\r\\n]*' + c.expected + '$')).test(text);
}

it('the 196 runnable cases of the vendored core tests pass and the two command line cases are excluded by name', () => {
  const { commit, cases, excluded } = casesFile();
  expect(commit).toBe('895b3a65d0d823dbd0acf2bc402376381995d1b1');
  expect(cases).toHaveLength(196);
  expect(excluded.map((e) => e.name)).toEqual([
    'indent_size_default_pre_0_9_0',
    'path_separator_backslash_in_cmd_line',
  ]);
  for (const e of excluded) expect(e.reason.length).toBeGreaterThan(20);
  const folders = new Map<string, number>();
  for (const c of cases) folders.set(c.folder, (folders.get(c.folder) ?? 0) + 1);
  expect([...folders]).toEqual([
    ['glob', 130],
    ['parser', 34],
    ['properties', 9],
    ['filetree', 23],
  ]);
  expect(new Set(cases.map((c) => c.name)).size).toBe(196);

  const failedFiles: string[] = [];
  const failedPaste: string[] = [];
  for (const c of cases) {
    // As the reference command reads them: each file's bytes (a byte order mark and carriage returns included) handed to the
    // resolver as they are.
    const files: PastedFile[] = c.files.map((f, index) => ({
      number: index + 1,
      folder: f.dir,
      label: fileLabel(f.dir),
      text: read(f.source),
      firstLine: 1,
    }));
    const direct = resolveProperties(files, c.path).properties;
    if (!passes(printed(direct, c.ordered), c)) failedFiles.push(c.name);

    // As a visitor pastes them: the top file first, then a folder line before each nested file.
    const parts: string[] = [];
    for (const f of c.files) parts.push(f.dir === '' ? read(f.source) : `=== ${f.dir} ===\n${read(f.source)}`);
    if (c.files.length > 0 && c.files[0]?.dir !== '') parts.unshift('');
    const result = resolveEditorConfig(parts.join('\n'), c.path);
    if (!passes(printed(result.properties, c.ordered), c)) failedPaste.push(c.name);
  }
  expect(failedFiles).toEqual([]);
  expect(failedPaste).toEqual([]);
});

/** The git blob sha of some bytes: sha-1 of "blob <length>", a zero byte, and the bytes. */
function blobSha(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

it('every vendored core test file has the git blob sha UPSTREAM.md records', () => {
  const recorded = new Map<string, string>();
  for (const line of read('UPSTREAM.md').split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length === 3 && /^[0-9a-f]{40}$/.test(cells[1] ?? '')) recorded.set(cells[0] ?? '', cells[1] ?? '');
  }
  expect(recorded.size).toBeGreaterThan(30);

  // Every file of the four folders, and the licence and readme, is in the table; nothing else is.
  const onDisk: string[] = ['LICENSE.txt'];
  if (recorded.has('README.md')) onDisk.push('README.md');
  const rootDirectory = fileURLToPath(CORE);
  for (const folder of ['glob', 'parser', 'properties', 'filetree']) {
    for (const relative of readdirSync(join(rootDirectory, folder), { recursive: true, encoding: 'utf8' })) {
      if (statSync(join(rootDirectory, folder, relative)).isFile())
        onDisk.push(`${folder}/${relative.replace(/\\/g, '/')}`);
    }
  }
  expect(onDisk.sort()).toEqual([...recorded.keys()].sort());

  const wrong: string[] = [];
  for (const [path, sha] of recorded) {
    const bytes = readFileSync(new URL(path, CORE));
    if (blobSha(bytes) !== sha) wrong.push(path);
  }
  expect(wrong).toEqual([]);

  // The two files whose bytes git would change if the repository converted line ends are really byte for byte.
  expect(readFileSync(new URL('parser/crlf.in', CORE)).includes(Buffer.from('\r\n'))).toBe(true);
  expect([...readFileSync(new URL('parser/bom.in', CORE)).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(read('UPSTREAM.md')).toContain('895b3a65d0d823dbd0acf2bc402376381995d1b1');
  expect(read('LICENSE.txt')).toContain('EditorConfig Team');
});

it('the extractor rebuilds cases.json from the vendored CMake files', async () => {
  const extractor = (await import(/* @vite-ignore */ new URL('extract-cases.mjs', CORE).href)) as {
    extractCases: (root: string) => unknown;
    serialise: (result: unknown) => string;
  };
  const rebuilt = extractor.serialise(extractor.extractCases(fileURLToPath(CORE)));
  expect(rebuilt).toBe(read('cases.json'));

  // An independent count of the calls in the four CMake files: 198 cases in all, 196 recorded and 2 excluded by name.
  let calls = 0;
  for (const folder of ['glob', 'parser', 'properties', 'filetree']) {
    for (const line of read(`${folder}/CMakeLists.txt`).split('\n')) if (/^\s*new_ec_test\w*\(/.test(line)) calls += 1;
  }
  const { cases, excluded } = casesFile();
  expect(calls).toBe(198);
  expect(cases.length + excluded.length).toBe(calls);
});

interface Differential {
  recordedAt: string;
  version: string;
  seed: number;
  pairs: Array<[string, string, boolean]>;
  differences: Array<{ glob: string; path: string; theirs: boolean; ours: boolean; family: string }>;
}

/** The three families of degenerate globs the specification does not define; the first predicate that fits names the family. */
const FAMILIES: Array<[string, (glob: string) => boolean]> = [
  ['escaped star followed by a star', (glob) => glob.includes('\\**')],
  ['runs of slashes and stars', (glob) => glob.includes('//') || glob.includes('***')],
  ['empty brace alternative before a slash', (glob) => glob.includes(',}/')],
];

it('the recorded editorconfig 3.0.2 matcher agrees on every generated pair except the differences listed by name', () => {
  const recorded = JSON.parse(readFileSync(DIFFERENTIAL, 'utf8')) as Differential;
  expect(recorded.version).toBe('3.0.2');
  expect(recorded.seed).toBe(99);
  expect(recorded.recordedAt).toMatch(/^2026-/);
  expect(recorded.pairs).toHaveLength(5900);

  const ours = (glob: string, path: string): boolean => {
    const result = resolveEditorConfig(`root = true\n\n[${glob}]\nk = v\n`, path);
    return result.properties.some((p) => p.key === 'k' && p.value === 'v');
  };
  const found: Differential['differences'] = [];
  for (const [glob, path, theirs] of recorded.pairs) {
    const mine = ours(glob, path);
    if (mine === theirs) continue;
    const family = FAMILIES.find(([, fits]) => fits(glob))?.[0] ?? 'unexplained';
    found.push({ glob, path, theirs, ours: mine, family });
  }
  // The pairs where this matcher disagrees are exactly the ones listed, each in one of the three families.
  expect(found).toEqual(recorded.differences);
  expect(found.filter((d) => d.family === 'unexplained')).toEqual([]);
  expect(found.length).toBe(34);
  for (const [name] of FAMILIES)
    expect(
      found.some((d) => d.family === name),
      name,
    ).toBe(true);
});
