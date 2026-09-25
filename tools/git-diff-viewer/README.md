# Git Diff Viewer

Render unified diff output with per-file and per-hunk navigation.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Parses pasted unified diff or git diff output with a hand-written parser and lets a visitor move through it file by file and hunk by hunk. Recognises git's extended headers for renames, copies, mode changes, and new and deleted files, decodes quoted paths, and marks binary files without ever reading their contents. Nothing pasted here is ever run or fetched.

## Supported

- One or more files in a single unified diff or git diff stream
- git's extended headers: old mode, new mode, deleted file mode, new file mode, copy from, copy to, rename from, rename to, similarity index, dissimilarity index and the index line
- Hunk headers with omitted counts (a single line on either side) as well as explicit start,count pairs
- Binary files, marked without ever reading their contents: both the plain Binary files ... differ marker and a --binary GIT binary patch block
- Quoted paths with C-style octal escapes, and a path containing a space
- \ No newline at end of file markers, kept as their own line
- CRLF and LF line endings
- Text before the first diff header (an email header or commit message from git format-patch) ignored with a warning
- Navigation by file number and hunk number, with a text filter on the path

## Limits

- A combined diff produced by diffing a merge (diff --cc or diff --combined) is refused with a plain message rather than parsed
- Binary file contents are never decoded or shown; only that a file is binary
- Word-level highlighting inside a changed line is not provided; a changed line is shown whole
- A hunk whose body does not match its header's declared line counts is refused, naming the input line
- A very large diff renders at most 2,000 lines per view, with a count of the rest

## Ambiguous cases, and what this does about them

- An unquoted path on the diff --git header line that itself contains the exact three characters space, b and slash is read using the same path on both sides of that header line when the old and new paths are otherwise equal (every rename and copy already carries its own unambiguous rename from/to or copy from/to line, which this tool prefers whenever one is present)

## Defined by

- [git diff documentation, "Generating patch text with -p"](https://git-scm.com/docs/git-diff)
- [GNU diffutils manual, "Detailed Description of Unified Format"](https://www.gnu.org/software/diffutils/manual/html_node/Detailed-Unified.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/git-diff-viewer git-diff-viewer
cd git-diff-viewer
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/git-diff-viewer
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { parseDiff } from '@fodt/git-diff-viewer';

parseDiff('diff --git a/file1 b/file2\nsimilarity index 90%\nrename from file1\nrename to file2\n');
// { files: [{ oldPath: 'file1', newPath: 'file2', status: 'renamed', similarity: 90, binary: false, hunks: [], ... }], warnings: [] }
```

`parseDiff(text)` returns `{ files, warnings }` or throws `GitDiffError` with `line`. Each file has `oldPath`, `newPath` (either may be null for an added or deleted file), `status` (added, deleted, renamed, copied, mode-changed or modified), `oldMode`/`newMode`, `similarity`, `binary`, `additions`, `deletions` and `hunks`. Each hunk has `header`, `oldStart`, `oldLines`, `newStart`, `newLines`, `section` and `lines` (each `{ type: 'add' | 'del' | 'ctx' | 'meta', text }`).

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Extended-header recognition and the hunk header grammar are proven both against small hand-written examples matching the quoted specification text and against real output from a throwaway git repository, generated once with the installed git binary and vendored in test/fixtures/git-output/ alongside GENERATED.md recording the exact commands and git version used.

## Licence

MIT. See [LICENSE](./LICENSE).
