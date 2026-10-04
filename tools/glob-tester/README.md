# Glob & .gitignore Pattern Tester

Test glob patterns and .gitignore rules against a list of paths and see which rule decided each one.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Paste glob patterns or .gitignore rules and a list of paths, and see for each path whether it matches and which line decided it. Globs are matched with picomatch and .gitignore rules with the ignore package, as one .gitignore file at the top of a repository. Matching runs in a background task that stops after 5 seconds, so a pattern that backtracks cannot freeze the page. Nothing you paste is sent anywhere.

## Supported

- Glob mode: picomatch 4.0.7 globs with braces, extglobs such as @(*.js|*.ts) and ** across directories; one pattern per line, the first matching line is named and the other matching lines are listed
- Glob options: match dotfiles, and ignore case
- .gitignore mode: the rules of one .gitignore file at the top of a repository, decided by the ignore package 7.0.8 with case-sensitive matching: negation with !, directory-only patterns ending in /, anchoring with a leading or middle /, ** as a whole path segment, backslash escapes, trailing spaces, comments, CRLF line ends and a byte order mark
- The deciding rule for each path in .gitignore mode: the line number and pattern of the last rule that matched (a negation included), the excluded parent directory with its line, or no rule matched
- Paths one per line, relative to the repository root; end a directory with / (logs/ is the directory, logs is a file); a path written twice gives two rows

## Limits

- Matching runs in a background task and stops after 5 seconds with a message; some patterns backtrack and can take that long.
- Patterns are limited to 64,000 characters, 1,000 lines and 1,000 characters a line; paths to 5,000 lines of up to 1,024 characters.
- Three or more asterisks before a slash (***/foo) are not read the way git reads them.
- A ? or a range is matched against whole characters, while git compares UTF-8 bytes, so ? does not stand for half of a character such as ü the way it can in git.
- A line holding only a ! is read as a negation of every path, where git reads it as matching nothing; the answer is the same but the rule named differs.
- In glob mode [!a] is not negation, as picomatch defines it; write [^a]. The extglob forms !(a).txt and @(*.js|*.ts) match differently from Bash.
- A glob such as src/** also matches src itself, as picomatch documents, while git's :(glob) pathspec lists only what is under it.
- Nested .gitignore files, a global excludes file, .git/info/exclude, tracked files and symbolic links are not modelled; each path is judged as if untracked, against one .gitignore at the top.
- Glob patterns follow picomatch, not Bash or git: braces, extglobs and a leading ! are picomatch features, POSIX classes such as [[:alpha:]] are not turned on, and * does not match a leading dot unless that option is ticked.

## Ambiguous cases, and what this does about them

- A path ending in / is a directory; the same name without it is a file. logs/ in a .gitignore matches the directory logs and everything under it, never a file named logs.
- When two .gitignore lines match one path the last one decides and is the one named, so a later !keep.log re-includes keep.log. In glob mode the first matching line is named and the other matching lines are listed.
- A file under an excluded directory cannot be re-included; the row names the excluded directory and its line.
- Line numbers count every pasted line, blank lines and comments included.

## Defined by

- [gitignore documentation (pattern format)](https://git-scm.com/docs/gitignore)
- [gitglossary (pathspec and the glob magic)](https://git-scm.com/docs/gitglossary)
- [picomatch README at its 4.0.7 tag](https://github.com/micromatch/picomatch/blob/4.0.7/README.md)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/glob-tester glob-tester
cd glob-tester
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/glob-tester
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { testPatterns, GlobTesterError } from '@fodt/glob-tester';

const result = testPatterns({
  mode: 'gitignore',
  patterns: '*.log\n!keep.log',
  paths: 'debug.log\nkeep.log\nlogs/\nlogs/a.txt',
  dot: false,
  nocase: false,
});

result.rows[0]; // { path: 'debug.log', isDirectory: false, ignored: true,
//   decidedBy: { kind: 'rule', line: 1, pattern: '*.log', negated: false } }
result.rows[1]; // keep.log: ignored false, decidedBy a negation on line 2

testPatterns({ mode: 'glob', patterns: 'src/**/*.ts', paths: 'src/a.ts', dot: false, nocase: false }).rows[0];
// { path: 'src/a.ts', matched: true, line: 1, pattern: 'src/**/*.ts', also: [], moreAlso: 0 }
```

`testPatterns(job)` checks the size of the paste first (`checkInput`), then splits both texts into lines (a line feed ends a line, one carriage return before it and a leading byte order mark are dropped, and line numbers count every pasted line), refuses a path that is absolute, starts with ./ or ../, holds a . or .. segment, a backslash or an empty segment (naming the line, never the text), and returns one row per non-blank path line in pasted order. In .gitignore mode every pattern line is handed to the ignore package as a rule marked with its pasted line number, with ignorecase off; the package decides whether the path is ignored, and the line that decided it is found by asking the same package about groups of rules from each line to the end, so a negation and the last of several matching lines are named, and an excluded parent directory is named with its line. In glob mode each non-blank line is compiled once with picomatch and `windows: false` (the platform a browser reports never matters), the first matching line and up to 20 other matching lines are returned, and so is the regular expression each pattern became, taken from the matcher itself and cut at 2,000 characters. `visible(text, max)` writes control and direction-changing characters as \u{XX} and cuts at `max` characters, for showing pasted text. Everything is pure and runs in Node or a worker. Errors are `GlobTesterError` with `part` and `line`; no message holds pasted text.

## Dependencies

- `picomatch` 4.0.7
- `ignore` 7.0.8

## Tests

```sh
npm test
```

Git's own answers are the oracle. The .gitignore corpus holds 88 .gitignore texts against 72 paths (6,336 pairs), recorded with git check-ignore -v -n -z --no-index using Git for Windows 2.53.0 (core.ignorecase and core.autocrlf off; files queried with nothing on disk, directories queried on disk without a trailing slash). The tool and git agree on whether the path is ignored on 6,325 pairs; the 11 that differ are three or more asterisks before a slash (7) and ? or a range against non-ASCII text (4), each listed by name in the test. On those 6,325 pairs git and this page name the same line on 6,253; the other 72 are a line holding only a ! (the answer agrees, the rule named differs), also listed. The glob corpus holds 40 patterns made of *, ?, brackets and ** against 57 files (2,280 pairs), recorded with git ls-files and the :(glob) pathspec magic; 2,251 agree and 29 differ ([!a] is not negation in picomatch (24), src/** also matches src (2), and UTF-8 bytes against characters (3)), each listed by name. The picomatch examples published in its README at 4.0.7, the Bash 5.2.37 answers for [!a] and the extglob forms, the fixed limits, the escaping of shown text, and line numbers across 200 rules (groups of 32) and across a re-included directory are checked too. Both corpora, the script that recorded them and the git version are in test/fixtures.

## Licence

MIT. See [LICENSE](./LICENSE).
