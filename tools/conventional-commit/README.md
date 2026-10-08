# Conventional Commit Checker

Check commit messages against Conventional Commits 1.0.0 and see the version bump they add up to and a draft changelog.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Paste one or more commit messages and see each one checked against the 16 numbered rules of Conventional Commits 1.0.0: the type, the optional scope, the ! mark, the description, the body, the footers and BREAKING CHANGE or BREAKING-CHANGE. The page adds up the Semantic Versioning bump the set calls for (major, minor, patch or no release), gives the next version when you give a current one, and drafts a changelog grouped by type. Convention advice such as an unknown type, a long header or a look-alike character is listed apart, labelled as not part of the specification, and never makes a message invalid. Nothing you paste is sent anywhere.

## Supported

- Messages split by a line that holds a separator (default ---), one message per line, or the default output of git log (a commit line with a full or abbreviated hash, then Author, Date and the indented message)
- The 16 numbered rules of Conventional Commits 1.0.0: the type, an optional scope in one pair of parentheses, an optional ! right before the colon, the colon and a space, a description, a body one blank line after the description, footers one blank line after the body, footer tokens that use - in place of white space, and BREAKING CHANGE or BREAKING-CHANGE in upper case as a footer
- A footer value that runs over lines until the next line that starts a valid footer token, with the separator : or a space and #
- Each failing rule named by its number in plain words, in a table with one row per message in pasted order
- The Semantic Versioning bump: any breaking change gives major, otherwise any feat gives minor, otherwise any fix gives patch, otherwise no release; the next version when a current version is given, with an option that raises the minor part for a breaking change while the major part is 0
- A draft changelog in Markdown: Breaking Changes, Features, Bug Fixes, Performance Improvements and Reverts, and the other types when you ask, each entry in pasted order
- Two notes on how the numbered rules were applied, shown apart from the convention notes and also when those are turned off: a line that starts with breaking change in lower or mixed case (rules 12 and 15), and a BREAKING CHANGE line that follows body text without a blank line (rule 8); neither marks a breaking change
- Convention notes, shown apart from the specification: an unknown type, a header over 72 or 100 characters, a capital first letter, a trailing period, a space in the scope, a type outside ASCII, and look-alike characters such as a fullwidth colon or a no-break space after the colon
- Lines that git writes itself (Merge, Revert with a quote, fixup!, squash!, amend! and # comment lines) are named and skipped, not judged

## Limits

- Conventional Commits 1.0.0 defines the types feat and fix and the two ways to mark a breaking change. Every other type, the changelog headings and the reading that a docs or chore commit needs no release are common conventions: they are shown apart from the specification checks and never decide whether a message is valid.
- The page reads only the messages you paste. It does not see your repository, earlier tags or merge commits, so the version change is the highest change among the pasted messages, not the next release of your project.
- Footers follow the Conventional Commits rule that a footer value ends where the next valid token starts, which differs from the rules for a git trailer in some corner cases: here a value may run over blank lines and unindented lines, and a footer needs a blank line before the first one.
- A reference parser accepts some messages that the wording of the specification rules out: no space after the colon, an empty description, a body with no blank line before it, and white space before the type. This page follows the wording and calls those messages not valid.
- A version below 1.0.0 follows your choice of the zero major option, because Semantic Versioning lets anything change before 1.0.0. A current version with a pre-release tag is raised from its release numbers: the tag and any build text are dropped first.
- Lines that git writes itself (Merge, Revert with a quote, fixup!, squash!, amend! and # comment lines) are named and skipped, not judged. Up to 1,000 messages and 200,000 characters are read; a line may hold 10,000 characters, a message 2,000 lines and 100 footers. The table shows 500 messages and the changelog 1,000 lines, each with a sentence saying what was left out.

## Ambiguous cases, and what this does about them

- Where the footers start: this page reads the first footer-shaped line that follows a blank line as the start of the footers, and every later line as a new footer or the continuation of the one before. A line such as Note: text in the middle of a paragraph stays in the body.
- Mixed case: the units of information are not case-sensitive except BREAKING CHANGE, which must be upper case. Breaking-Change: y is read as an ordinary footer and breaking change: y as body text, each with a note that rule 12 needs upper case; neither marks a breaking change.
- A current version that already has a pre-release tag is raised from its release numbers (1.5.0-rc.1 with a fix gives 1.5.1); the specification does not say how.
- More than one blank line between the description and the body is read as one blank line; the specification says only that the body begins one blank line after the description.

## Defined by

- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/conventional-commit conventional-commit
cd conventional-commit
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/conventional-commit
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { checkCommits } from '@fodt/conventional-commit';

const result = checkCommits({
  text: 'feat!: drop v1\n---\nfix: typo\n\nRefs: #12',
  currentVersion: '1.4.2',
});
result.bump.level; // 'major'
result.bump.next; // '2.0.0'
result.messages.map((m) => m.parsed.valid); // [true, true]
result.changelog; // '### Breaking Changes\n\n- drop v1\n\n### Features\n...'
```

`checkCommits({ text, mode, separator, currentVersion, zeroMajor, includeHidden, advice })` refuses a paste over 200,000 characters first (`ConventionalCommitError`, naming the limit), then splits the paste (`splitMessages`: mode 'separator' with a separator line, 'lines', or 'gitlog'), parses every message with `parseMessage`, adds up the bump with `bumpFor`, drafts the changelog with `changelogFor` and collects notes with `adviceFor` (`advice: false` leaves out only the convention notes; the notes labelled `specification` are always kept). `parseMessage(text)` is a hand-written scanner with an index: it never builds a regular expression and every failure carries the number of the specification rule it breaks (`failures: { rule, message }[]`); a not valid message is a result, never an error. `parseVersion` runs the official Semantic Versioning regular expression on at most 256 characters, and `increment(version, level, { zeroMajor })` raises it. Footer tokens, types and scopes are plain strings and never keys of an object. Everything is pure and runs in Node or a browser.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The seven examples of the Conventional Commits 1.0.0 page (blob 4fa8464d) are re-typed as data with the parts they show, and each of the 16 numbered rules has a passing and a failing message written from its own words. The reference parser @conventional-commits/parser 0.4.1 is recorded on 1,033 messages (the 33 research probes and 1,000 from a seeded generator): 768 are read the same way, and the 265 that differ are each explained by one of ten named places where this page follows the wording of the specification (no space after the colon, an empty description, a tab or no-break space after the colon, white space before the type, a header with a space and a number sign in place of the colon, a second line that is not blank, a footer glued to body text, a footer value that runs over a blank or unindented line, a footer separator that is not a colon and a space, and a footer token that holds a scope or a mark). Default git log output was recorded from a scratch repository made with git 2.53.0 and synthetic authors, with a merge, a revert and fixup, squash and amend commits. The version parser is the official Semantic Versioning expression, checked on the specification example versions. Hostile input is checked for linear time and every cap is checked at its edge.

## Licence

MIT. See [LICENSE](./LICENSE).
