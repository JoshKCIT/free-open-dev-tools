import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';
import { parseDiff, GitDiffError } from '../src/index';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'git-output');
function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

it('git diff documentation extended headers for renames, copies, mode changes and new and deleted files are recognised', () => {
  // git diff documentation, "Generating patch text with -p" (fetched
  // 2026-09-25): the extended header list is "old mode <mode>", "new mode
  // <mode>", "deleted file mode <mode>", "new file mode <mode>", "copy
  // from <path>", "copy to <path>", "rename from <path>", "rename to
  // <path>", "similarity index <number>", "dissimilarity index <number>",
  // "index <hash>..<hash> <mode>".
  const rename = parseDiff('diff --git a/file1 b/file2\nsimilarity index 90%\nrename from file1\nrename to file2\n')
    .files[0]!;
  expect(rename).toMatchObject({ oldPath: 'file1', newPath: 'file2', status: 'renamed', similarity: 90 });

  const copy = parseDiff('diff --git a/file1 b/file3\nsimilarity index 100%\ncopy from file1\ncopy to file3\n')
    .files[0]!;
  expect(copy).toMatchObject({ oldPath: 'file1', newPath: 'file3', status: 'copied', similarity: 100 });

  const modeChange = parseDiff('diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n').files[0]!;
  expect(modeChange).toMatchObject({
    oldPath: 'run.sh',
    newPath: 'run.sh',
    status: 'mode-changed',
    oldMode: '100644',
    newMode: '100755',
  });

  const added = parseDiff(
    'diff --git a/new.txt b/new.txt\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,1 @@\n+hello\n',
  ).files[0]!;
  expect(added).toMatchObject({ oldPath: null, newPath: 'new.txt', status: 'added' });

  const deleted = parseDiff(
    'diff --git a/old.txt b/old.txt\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/old.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-bye\n',
  ).files[0]!;
  expect(deleted).toMatchObject({ oldPath: 'old.txt', newPath: null, status: 'deleted' });
});

it('GNU diff unified format hunk headers give the right line numbers, including omitted counts', () => {
  // GNU diffutils manual, "Detailed Description of Unified Format"
  // (fetched 2026-09-25): "If a hunk contains just one line, only its
  // start line number appears. Otherwise its line numbers look like
  // start,count."
  const oneLine = parseDiff('diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\n').files[0]!;
  expect(oneLine.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 });

  const newFile = parseDiff(
    'diff --git a/f b/f\nnew file mode 100644\n--- /dev/null\n+++ b/f\n@@ -0,0 +1,3 @@\n+a\n+b\n+c\n',
  ).files[0]!;
  expect(newFile.hunks[0]).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 3 });

  const explicit = parseDiff(
    'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,5 +1,5 @@ section title\n a\n-b\n+B\n c\n d\n e\n',
  ).files[0]!;
  expect(explicit.hunks[0]).toMatchObject({
    oldStart: 1,
    oldLines: 5,
    newStart: 1,
    newLines: 5,
    section: 'section title',
  });
});

it('binary markers and GIT binary patch blocks mark the file as binary without reading the data', () => {
  const noBinaryFlag = parseDiff(fixture('binary-file-no-binary-flag.diff'));
  expect(noBinaryFlag.files).toHaveLength(1);
  expect(noBinaryFlag.files[0]).toMatchObject({ oldPath: 'image.bin', newPath: 'image.bin', binary: true });
  expect(noBinaryFlag.files[0]!.hunks).toEqual([]);

  const withBinaryFlag = parseDiff(fixture('binary-file-with-binary-flag.diff'));
  expect(withBinaryFlag.files).toHaveLength(1);
  expect(withBinaryFlag.files[0]).toMatchObject({ oldPath: 'image.bin', newPath: 'image.bin', binary: true });
  expect(withBinaryFlag.files[0]!.hunks).toEqual([]);
  expect(withBinaryFlag.warnings).toEqual([]);
});

it('quoted paths with octal escapes are decoded', () => {
  // The literal "caf\303\251.txt" is git's own core.quotePath rendering of
  // caf + U+00E9 (é) + .txt: 0303 0251 octal is 0xC3 0xA9, the UTF-8
  // encoding of U+00E9.
  const result = parseDiff(fixture('path-non-ascii.diff'));
  expect(result.files).toHaveLength(1);
  expect(result.files[0]!.newPath).toBe('café.txt');
  expect(result.files[0]!.oldPath).toBe(null);
});

it('a hunk whose line counts do not match its header is refused with its line', () => {
  const tooFewLines = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n';
  expect(() => parseDiff(tooFewLines)).toThrow(GitDiffError);
  try {
    parseDiff(tooFewLines);
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(GitDiffError);
    expect((err as GitDiffError).line).toBe(6);
  }

  const tooManyLines = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-a\n-b\n+c\n';
  expect(() => parseDiff(tooManyLines)).toThrow(GitDiffError);
});

it('no newline at end of file markers are kept as meta lines', () => {
  const result = parseDiff(fixture('no-final-newline.diff'));
  const hunk = result.files[0]!.hunks[0]!;
  const metaLines = hunk.lines.filter((l) => l.type === 'meta');
  expect(metaLines).toHaveLength(2);
  expect(metaLines[0]!.text).toBe('\\ No newline at end of file');
  expect(metaLines[1]!.text).toBe('\\ No newline at end of file');
});

it('CRLF line endings parse the same as LF', () => {
  const lf = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  const resultLf = parseDiff(lf);
  const resultCrlf = parseDiff(crlf);
  expect(resultCrlf.files[0]!.hunks[0]!.lines).toEqual(resultLf.files[0]!.hunks[0]!.lines);
  expect(resultCrlf.files[0]!.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2 });
});

it('combined diffs from merges are refused with a plain message', () => {
  // git diff documentation, "Combined diff format" (fetched 2026-09-25):
  // "diff --combined file" / "diff --cc file", followed by a chunk header
  // "@@@ -98,20 -98,12 +98,20 @@@".
  const combined =
    'diff --cc describe.c\nindex fabadb8,cc95eb0..4866510\n--- a/describe.c\n+++ b/describe.c\n@@@ -98,20 -98,12 +98,20 @@@\n';
  expect(() => parseDiff(combined)).toThrow(GitDiffError);
  try {
    parseDiff(combined);
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(GitDiffError);
    expect((err as GitDiffError).message).toMatch(/not supported/i);
  }
});

it('real git output for a rename, a copy, a binary file and a mode change parses as git describes', () => {
  const rename = parseDiff(fixture('rename-with-edit.diff'));
  expect(rename.files).toHaveLength(1);
  expect(rename.files[0]).toMatchObject({
    oldPath: 'rename-src.txt',
    newPath: 'rename-dst.txt',
    status: 'renamed',
    similarity: 94,
  });
  expect(rename.files[0]!.hunks).toHaveLength(1);

  const copy = parseDiff(fixture('copy-file.diff'));
  expect(copy.files).toHaveLength(1);
  expect(copy.files[0]).toMatchObject({
    oldPath: 'copy-src.txt',
    newPath: 'copy-dst.txt',
    status: 'copied',
    similarity: 100,
  });
  expect(copy.files[0]!.hunks).toEqual([]);

  const binary = parseDiff(fixture('binary-file-with-binary-flag.diff'));
  expect(binary.files[0]).toMatchObject({ oldPath: 'image.bin', newPath: 'image.bin', binary: true });

  const modeChange = parseDiff(fixture('mode-change.diff'));
  expect(modeChange.files[0]).toMatchObject({
    oldPath: 'mode-change.sh',
    newPath: 'mode-change.sh',
    status: 'mode-changed',
    oldMode: '100644',
    newMode: '100755',
  });

  const twoHunks = parseDiff(fixture('modify-two-hunks.diff'));
  expect(twoHunks.files[0]!.hunks).toHaveLength(2);
  expect(twoHunks.files[0]!.status).toBe('modified');

  const added = parseDiff(fixture('added-file.diff'));
  expect(added.files[0]).toMatchObject({ oldPath: null, newPath: 'added.txt', status: 'added' });

  const deleted = parseDiff(fixture('deleted-file.diff'));
  expect(deleted.files[0]).toMatchObject({ oldPath: 'deleted.txt', newPath: null, status: 'deleted' });

  const withSpace = parseDiff(fixture('path-with-space.diff'));
  expect(withSpace.files[0]!.newPath).toBe('file with space.txt');

  const formatPatch = parseDiff(fixture('format-patch.patch'));
  expect(formatPatch.files).toHaveLength(1);
  expect(formatPatch.files[0]!.newPath).toBe('no-final-newline.txt');
  expect(formatPatch.warnings).toContain('Text before the first diff header was ignored.');
  expect(formatPatch.warnings).toContain('Text after the last diff hunk was ignored.');
});
