# List Comparison

Find the union, intersection and differences between two lists.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Compares two line-separated lists and gives every set operation at once: the union, the intersection, the items found only in each list, and the symmetric difference. Case, whitespace, blank-line and Unicode normalisation options control which lines count as the same item.

## Supported

- Union, intersection, only-in-A, only-in-B and symmetric difference computed together from the same two lists
- CRLF, LF and CR line endings all read as line breaks
- Trimming leading and trailing whitespace on each line, and dropping blank lines, both independently switchable
- Case-insensitive comparison using the default Unicode case-folding mapping, never a locale-dependent variant
- UAX #15 NFC normalisation as an option, so a precomposed character and its decomposed equivalent can be treated as the same item
- A count of duplicate lines collapsed within each list

## Limits

- Comparison is always line-by-line: a list is never re-ordered or otherwise interpreted as structured data
- A repeated line within one list counts once, no matter how many times it appears
- Case folding uses the default Unicode mapping (toLowerCase), not a locale-specific one
- Unicode normalisation, when switched on, is Normalization Form C only; no other normalisation form is offered

## Ambiguous cases, and what this does about them

- Comparison is by code point after the chosen options (normalisation, case folding, trimming) have been applied, never before.
- Case folding uses JavaScript's default (non-locale) lower-casing, which can differ from a locale-specific mapping for a small number of characters.
- A line repeated within the same list is counted once in every result list; the duplicate count reports how many repeats were collapsed.

## Defined by

- [UAX #15 — Unicode Normalization Forms](https://www.unicode.org/reports/tr15/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/list-compare list-compare
cd list-compare
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/list-compare
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { compareLists } from '@fodt/list-compare';

compareLists('apple\nbanana\ncherry', 'banana\ncherry\ndate');
// { union: [...], intersection: ['banana','cherry'], onlyA: ['apple'], onlyB: ['date'], symmetric: [...], counts: {...} }
```

`compareLists(a, b, options)` splits each list on CRLF, LF or CR, trims each line unless `trim` is false, drops blank lines unless `keepBlank` is true, then builds a comparison key per line (NFC when `normalize`, then lower-cased when `ignoreCase`). Each list collapses to its first occurrence of each key; result lists hold the first-seen text, not the comparison key. `counts` reports the size of each result list plus `duplicatesA` and `duplicatesB`.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every required behaviour is checked against a real call to compareLists: union/intersection/onlyA/onlyB/symmetric ordering, the case and trim options, blank-line handling, all three line-ending styles, and UAX #15 NFC normalisation using a precomposed and a decomposed form of the same character, fetched and quoted from the Unicode Consortium's own report.

## Licence

MIT. See [LICENSE](./LICENSE).
