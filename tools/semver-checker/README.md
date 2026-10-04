# Semantic Version Range Checker & Sorter

Check versions against a semantic version range, read the range in plain words and sort a list of versions.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Type a version range such as ^1.2.3 || >=4.0.0 <5.0.0 and paste versions, one per line, and see which ones satisfy the range, with the normalised range npm prints. Explain mode reads the range in plain words, alternative by alternative, and says when the pre-release rule applies. Sort mode orders versions by SemVer 2.0.0 precedence. Everything is decided by npm's own semver package, the same code npm uses, so the answers are npm's answers. Nothing you type is sent anywhere.

## Supported

- Check mode: each pasted version is marked satisfies, does not satisfy, or not a valid version, with the range as npm normalises it, the highest pasted version that satisfies it and the lowest version it allows
- Explain mode: the range read in plain words, one sentence per alternative, with the pre-release rule stated when it applies
- Sort mode: valid versions ordered by SemVer 2.0.0 precedence (lowest first); a line that is not a version never stops the sort and is listed with its line number; equal versions keep their pasted order
- node-semver range grammar: caret ^1.2.3, tilde ~1.2.3, x-ranges such as 1.x and *, hyphen ranges such as 1.2.3 - 2.3.4, comparators >, >=, <, <= and =, and alternatives joined with ||
- Loose parsing (accepts forms such as =1.2.3 and 1.2.3beta) and Include pre-releases, the two options npm's semver package has for this

## Limits

- Pasted versions are limited to 262,144 characters and 20,000 lines; each version to 256 characters.
- A range is limited to 1,000 characters and 500 alternatives joined by ||.
- A pre-release version such as 1.3.0-beta.1 matches only when a comparator in the same alternative names the same major, minor and patch with a pre-release, unless Include pre-releases is ticked; this is how npm decides.
- Build metadata (+...) is ignored when ordering, as SemVer 2.0.0 says, so versions that differ only in it keep their pasted order.
- Numeric pre-release identifiers above 9,007,199,254,740,991 (for example 1.0.0-9007199254740993) are compared as numbers by npm's semver package, so two that differ only beyond that size can be shown as equal in precedence or ordered wrongly; SemVer 2.0.0 compares numeric identifiers as whole numbers of any size.
- An empty range shows nothing; type * or x for any version.
- Nothing is fetched from a package registry; only the versions you paste are checked.
- At most the first 1,000 rows of a check are shown, and at most the first 200 lines that are not versions; the counts above cover every line.

## Ambiguous cases, and what this does about them

- npm's range rules differ from other package managers' rules: for example npm leaves out pre-releases of a version unless the range names a pre-release of that same version, and ^0.2.3 stops at 0.3.0 where ^1.2.3 stops at 2.0.0.
- An empty alternative, as in ^1.2.3 || with nothing after the bars, is read by npm as any version.
- A leading v or = on a version is accepted by npm as written; other loose forms such as 1.2.3beta need Loose parsing.
- SemVer 2.0.0 ignores build metadata when two versions are compared, but a sorted list shows the build metadata that was pasted.

## Defined by

- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)
- [node-semver README at its 7.8.5 tag (range syntax and the pre-release rule)](https://github.com/npm/node-semver/blob/v7.8.5/README.md)
- [node-semver range grammar (range.bnf) at its 7.8.5 tag](https://github.com/npm/node-semver/blob/v7.8.5/range.bnf)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/semver-checker semver-checker
cd semver-checker
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/semver-checker
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { checkVersions, sortVersions, explainRange, SemverCheckerError } from '@fodt/semver-checker';

const options = { loose: false, includePrerelease: false };

const checked = checkVersions('1.9.9\n2.0.0\n1.3.0-beta.1', '^1.2.3', options);
checked.normalized; // '>=1.2.3 <2.0.0-0'
checked.rows.map((row) => row.result); // ['satisfies', 'does not satisfy', 'does not satisfy']

sortVersions('1.0.0\n1.0.0-rc.1\nbogus', { loose: false }).sorted.map((v) => v.shown);
// ['1.0.0-rc.1', '1.0.0']  (bogus is listed in .invalid with its line number)

explainRange('^1.2.3', options).alternatives[0]?.words;
// '1.2.3 or higher, and lower than 2.0.0, with no 2.0.0 pre-release'
```

`checkVersions(versions, range, options)` refuses a paste over the limits before parsing anything, parses the range once with npm's own Range class (any library error becomes a SemverCheckerError whose message says which alternative cannot be read and never repeats any of the text), and returns the range as npm normalises it, one row per non-blank pasted line in order (line number, the text to show, and satisfies, does not satisfy or not a valid version), the highest pasted version that satisfies the range and the lowest version the range allows. `sortVersions(versions, { loose })` validates each line first, so a line that is not a version is listed in `invalid` with its line number and the sort never throws; the valid lines are sorted by SemVer 2.0.0 precedence with a stable sort, so versions equal in precedence (build metadata is ignored) keep their pasted order, and `equalGroups` counts how many sets of such versions there are, `buildOnlyGroups` how many of those sets differ only in build metadata (the same pasted text without the build, different builds) and `equalNote` is a sentence that says only what is true of them. `explainRange(range, options)` walks the parsed range: each alternative is a list of comparators that must all hold, each with its operator, its version and a sentence, and `prereleaseNote` states the pre-release rule when Include pre-releases is off. An empty range is read as any version, as npm reads it; the page is what shows nothing for an empty range. `visible(text, max)` writes control and direction-changing characters as \u{XX} and cuts at `max` characters, for showing pasted text. Everything is pure and runs in Node or a browser.

## Dependencies

- `semver` 7.8.5

## Tests

```sh
npm test
```

npm's own semver package is the oracle. The published fixtures of node-semver at its v7.8.5 tag (range-include 126 entries, range-exclude 98, range-parse 133, valid-versions 22, invalid-versions 10 and comparator-intersection 34, copied unchanged with their licence and an UPSTREAM.md of git blob SHAs) pass through this package's own functions with the same loose and include-prerelease options. Entries that cannot be reproduced as pasted text are listed by name with the reason: one exclude entry whose version is the boolean false, three invalid-version entries that are not text (two regular expressions and an object with a toString), and the one over-long version that this package refuses before parsing because a version is limited to 256 characters. The range explanations are tested by a boundary property: for every fixture range (826 explanations, with and without Include pre-releases), a test that reads only the words of each explanation agrees with semver.satisfies on the versions each sentence names, the next and previous patch, and a pre-release of each (17,678 comparisons). The SemVer 2.0.0 precedence example (1.0.0-alpha through 1.0.0) is copied from the specification page. Sorting, the size limits, messages that never repeat pasted text, silence on the console and the time to sort and to check the largest allowed pastes are tested too, and a browser test compares 30 recorded checks on the page with an independent run of the package in four browsers.

## Licence

MIT. See [LICENSE](./LICENSE).
