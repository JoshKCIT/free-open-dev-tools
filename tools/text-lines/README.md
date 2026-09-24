# Line Toolkit

Sort, deduplicate, shuffle, number, trim, filter, join and split lines.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Treats pasted text as a list of lines and reshapes it: sort by code point or natural order, remove duplicates, shuffle with a repeatable seed, number each line, trim whitespace, keep or drop lines matching a literal text, or join and split against a chosen separator.

## Supported

- Sort by code point or natural order, so line 2 sorts before line 10, ascending or descending
- Deduplicate, keeping the first occurrence, case-sensitive or case-insensitive
- Shuffle with a seed, so the same seed always gives the same order
- Number each line from a chosen starting number with a custom separator
- Trim leading, trailing or both kinds of whitespace, and drop blank lines
- Filter lines that contain or do not contain a literal substring
- Join lines into one line with a chosen separator, or split one line back into many
- Reads CRLF, LF and CR line endings the same way

## Limits

- The shuffle is a deterministic pseudo-random generator, not a cryptographically secure one. It is unsuitable wherever real unpredictability matters, such as drawing lots.
- Natural sort compares each run of digits as an ordinary JavaScript number, so a digit run far beyond safe integer precision can compare incorrectly.
- Sort by code point compares UTF-16 code units, not full Unicode code points, so characters outside the basic multilingual plane may not sort the way a person expects.
- Filter and dedupe match a literal substring or a whole line, never a regular expression.

## Ambiguous cases, and what this does about them

- "Natural order" has no single agreed definition. This tool treats a maximal run of decimal digits as one number and compares runs of that kind numerically, comparing everything else by code point, which matches how most natural-sort implementations behave.
- Shuffling with a seed is deterministic by design, so the same seed always gives the same order. That makes it unsuitable anywhere true unpredictability is required.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/text-lines text-lines
cd text-lines
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/text-lines
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { processLines, splitLines, OPERATIONS } from '@fodt/text-lines';

processLines('banana\napple\ncherry', 'sort', { order: 'codepoint' });
// { output: 'apple\nbanana\ncherry', linesIn: 3, linesOut: 3 }
```

`processLines` always joins its result with a single line feed, regardless of the input's own line endings. `splitLines` reads CRLF, LF and CR endings as line breaks so mixed input can still be read correctly. A bad option, such as an empty split separator, throws `TextLinesError`.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

No standard defines line operations of this kind, so standards is empty; tests assert behaviour against hand-worked examples for every operation, including natural sort ordering, the seeded shuffle's determinism and permutation property, and reading all three common line-ending styles.

## Licence

MIT. See [LICENSE](./LICENSE).
