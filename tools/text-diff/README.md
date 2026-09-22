# Text Diff

Compare two texts line by line or word by word and produce a unified diff.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Compares two blocks of text using the same Myers algorithm that git and every editor use, so the result is the smallest set of changes rather than the first one found. It also names the differences you cannot see: line endings, trailing whitespace, a missing final newline, zero-width characters, and text that differs only in Unicode normalisation.

## Supported

- Line, word and character granularity
- A side-by-side view that pairs a replaced line with its replacement
- Unified diff output with a configurable amount of context, as git and patch use
- Ignoring case, ignoring whitespace, and comparing lines regardless of their order
- Normalising CRLF and CR to LF before comparing, or not, as you choose
- Naming differences that are invisible on screen, which is usually the answer when two files look the same

## Limits

- Diffing by character on a very large input is slow, because the algorithm cost grows with the number of differences. Line granularity is the right choice for anything over a few thousand lines.
- This is a text diff. It does not understand structure, so a reordered JSON object or a reformatted block of code shows as many changes. The JSON diff tool compares structurally.
- The unified diff output is the standard format but is not produced by git, so a patch generated here may order equivalent hunks differently from one git would produce. It applies the same.
- Word granularity splits on whitespace only. It does not understand punctuation or word boundaries in scripts that do not use spaces.

## Ambiguous cases, and what this does about them

- When several edit scripts are equally short, which one to show is a presentation choice. Myers prefers deletions before insertions, which is what git does and what this follows, so a replaced line appears as a removal then an addition.
- Whether a trailing newline counts as a difference is genuinely contested. It is treated as a real difference and called out separately, because in a configuration file it sometimes matters and in prose it never does.

## Defined by

- [Myers, An O(ND) Difference Algorithm and Its Variations (1986)](http://www.xmailserver.org/diff2.pdf)
- [POSIX diff, unified format](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/diff.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/text-diff text-diff
cd text-diff
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/text-diff
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { diffText, unifiedDiff, sideBySide, invisibleDifferences } from '@fodt/text-diff';

diffText(a, b);                                  // changes plus statistics
diffText(a, b, { granularity: 'word' });
unifiedDiff(a, b, { context: 3 });               // git-style patch text
sideBySide(a, b);                                // aligned rows for two columns
invisibleDifferences(a, b);                      // why they look identical
```

`diffSequences` is exported separately and works on arrays of anything with a custom equality function, so it can diff tokens, records or objects rather than only text.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The algorithm is checked against the textbook Myers example for producing a genuinely minimal script, and by a property test that applying the edit script reproduces the right-hand side exactly across several shapes including empty sides and a full reversal. The unified diff output is checked for correct hunk headers, context limits, hunk splitting and edge insertions. Invisible difference detection covers line endings, trailing whitespace, final newline, byte order marks, zero-width characters and Unicode normalisation.

## Licence

MIT. See [LICENSE](./LICENSE).
