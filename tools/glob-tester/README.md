# Glob & .gitignore Pattern Tester

Test glob patterns, .gitignore rules and CODEOWNERS files against a list of paths and see which line decided each one.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Paste glob patterns, .gitignore rules or a CODEOWNERS file and a list of paths, and see for each path whether it matches and which line decided it. Globs are matched with picomatch and .gitignore rules with the ignore package, as one .gitignore file at the top of a repository. Matching runs in a background task that stops after 5 seconds, so a pattern that backtracks cannot freeze the page. Nothing you paste is sent anywhere. In CODEOWNERS mode, paste a CODEOWNERS file and file paths to see the owners of each path and the line that decided it under the rules GitHub documents; whether an owner exists is never checked.

## Supported

- Glob mode: picomatch 4.0.7 globs with braces, extglobs such as @(*.js|*.ts) and ** across directories; one pattern per line, the first matching line is named and the other matching lines are listed
- Glob mode reads POSIX classes such as [[:alpha:]] and [[:digit:]] as picomatch does (a letter class, a digit class)
- Glob options: match dotfiles, and ignore case
- .gitignore mode: the rules of one .gitignore file at the top of a repository, decided by the ignore package 7.0.9 with case-sensitive matching: negation with ! (a line holding only a ! matches nothing and still counts in the line numbers, as in git), directory-only patterns ending in /, anchoring with a leading or middle /, ** as a whole path segment, backslash escapes, trailing spaces, comments, CRLF line ends and a byte order mark
- The deciding rule for each path in .gitignore mode: the line number and pattern of the last rule that matched (a negation included), the excluded parent directory with its line, or no rule matched
- Paths one per line, relative to the repository root; end a directory with / (logs/ is the directory, logs is a file); a path written twice gives two rows
- CODEOWNERS mode: paste a CODEOWNERS file and file paths and see, for each path, its owners and the line that decided it under the rules GitHub documents: the last matching line wins and the owners of earlier lines are never merged
- CODEOWNERS patterns: a name with no slash matches that name at any depth and everything under it; a leading or middle slash anchors at the top of the repository; a trailing slash means everything below that directory; docs/* matches direct children only; ** matches any directories at the start, zero or more in the middle and everything below at the end
- A CODEOWNERS line with no owners leaves its paths with no owner and is named as the line that decided; a path that no line matches has no owner and no deciding line
- CODEOWNERS files: an inline comment after the owners ends the line, comment lines and blank lines are skipped, paths are case sensitive, and line numbers count every pasted line
- CODEOWNERS lines GitHub says do not work (a leading !, an escaped leading # and [ ] ranges) are listed as unsupported with that reason and match nothing
- CODEOWNERS owners are checked for shape only: @username, @org/team-name or an email address

## Limits

- Matching runs in a background task and stops after 5 seconds with a message; some patterns backtrack and can take that long.
- Patterns are limited to 64,000 characters, 1,000 lines and 1,000 characters a line; paths to 5,000 lines of up to 1,024 characters.
- Three or more asterisks before a slash (***/foo) are not read the way git reads them.
- A ? or a range is matched against whole characters, while git compares UTF-8 bytes, so ? does not stand for half of a character such as ü the way it can in git.
- In glob mode [!a] is not negation, as picomatch defines it; write [^a]. The extglob forms !(a).txt and @(*.js|*.ts) match differently from Bash.
- A glob such as src/** also matches src itself, as picomatch documents, while git's :(glob) pathspec lists only what is under it.
- Nested .gitignore files, a global excludes file, .git/info/exclude, tracked files and symbolic links are not modelled; each path is judged as if untracked, against one .gitignore at the top.
- Glob patterns follow picomatch, not Bash or git: braces, extglobs and a leading ! are picomatch features, and * does not match a leading dot unless that option is ticked.
- CODEOWNERS mode follows the rules GitHub documents, not GitHub's code. It cannot tell whether a user or team exists or has write access; GitHub checks that and this page cannot.
- CODEOWNERS lines GitHub says do not work (a leading !, an escaped leading # and [ ] ranges) are listed as unsupported and match nothing. What GitHub does with such a line beyond skipping it is not documented by GitHub.
- Not documented by GitHub, so shown as this page's reading and marked on each row it decides: runs of ** and of slashes, ?, other backslash escapes and the exact shape of an owner. Three or more stars in a row, and a pattern made only of slashes, are listed as unsupported for the same reason and match nothing.
- In CODEOWNERS mode each pasted path is a file path and a path that ends in / is refused; a directory is owned through the files under it. Other hosts' CODEOWNERS dialects, such as GitLab sections, are not modelled.
- GitHub does not load a CODEOWNERS file of 3 MB or more. This mode reads up to 600,000 characters, 5,000 rules and 4,000 characters a rule line (a comment line may be longer, as GitHub skips it), with the paths limited to 5,000 lines of up to 1,024 characters; more is refused before anything is matched.
- CODEOWNERS matching runs in the same background task and stops after 5 seconds. It is also limited by a work budget of 300,000,000 steps: a paste that needs more is refused with a sentence naming the path line where matching stopped.
- A very large .gitignore paste can reach the same 5 second stop: 1,000 rules against 5,000 paths that all sit under a folder a later rule re-includes, with every folder name three characters long so the longer paths are many folders deep, took about 2.3 seconds with 36 character paths, 7.8 seconds with 112 character paths and 29 seconds with 376 character paths on one laptop, so only the longer pastes of that shape end with the stop message; if yours does, split it into smaller pastes.

## Ambiguous cases, and what this does about them

- A path ending in / is a directory; the same name without it is a file. logs/ in a .gitignore matches the directory logs and everything under it, never a file named logs.
- When two .gitignore lines match one path the last one decides and is the one named, so a later !keep.log re-includes keep.log. In glob mode the first matching line is named and the other matching lines are listed.
- A file under an excluded directory cannot be re-included; the row names the excluded directory and its line.
- In glob mode a path ending in / is matched with its slash, as picomatch reads it: the pattern src/ matches the path src/ and not src, and src matches the path src and not src/. In .gitignore mode the slash only marks a directory.
- Line numbers count every pasted line, blank lines and comments included.
- In CODEOWNERS mode a line with no owners is a result, not an error: it leaves the paths it matches with no owner, and the row names that line as the one that decided.
- In CODEOWNERS mode the last matching line decides, as GitHub documents, and the owners of earlier lines are never merged; in glob mode the first matching line is named.

## Defined by

- [gitignore documentation (pattern format)](https://git-scm.com/docs/gitignore)
- [gitglossary (pathspec and the glob magic)](https://git-scm.com/docs/gitglossary)
- [picomatch README at its 4.0.7 tag](https://github.com/micromatch/picomatch/blob/4.0.7/README.md)
- [GitHub: About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)

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

// CODEOWNERS mode: the last matching line decides, and the row names it.
const owners = testPatterns({
  mode: 'codeowners',
  patterns: '* @global-owner\n*.js @js-owner\n',
  paths: 'src/app.js\nREADME.md',
  dot: false,
  nocase: false,
});
owners.rows[0]; // { path: 'src/app.js', owners: ['@js-owner'], line: 2, pattern: '*.js', note: '' }
owners.rows[1]; // README.md: owners ['@global-owner'], line 1
owners.skipped; // lines GitHub does not support, each with its line number and reason
```

`testPatterns(job)` checks the size of the paste first (`checkInput`), then splits both texts into lines (a line feed ends a line, one carriage return before it and a leading byte order mark are dropped, and line numbers count every pasted line), refuses a path that is absolute, starts with ./ or ../, holds a . or .. segment, a backslash or an empty segment (naming the line, never the text), and returns one row per non-blank path line in pasted order. In .gitignore mode every pattern line is handed to the ignore package as a rule marked with its pasted line number, after its trailing spaces are taken off unless a backslash quotes them (as the gitignore documentation says), with ignorecase off; the package decides whether the path is ignored, and the line that decided it is found by asking the same package about groups of rules from each line to the end, so a negation and the last of several matching lines are named, and an excluded parent directory is named with its line. In glob mode each non-blank line is compiled once with picomatch and `windows: false` (the platform a browser reports never matters), the first matching line and up to 20 other matching lines are returned, and so is the regular expression each pattern became, taken from the matcher itself and cut at 2,000 characters. `visible(text, max)` writes control, invisible (a zero width space, a no-break space, the Braille blank and similar) and direction-changing characters as \u{XX} and cuts at `max` characters, for showing pasted text. Everything is pure and runs in Node or a worker. Errors are `GlobTesterError` with `part` and `line`; no message holds pasted text. In CODEOWNERS mode `checkCodeownersInput` refuses a paste over 600,000 characters, over 5,000 rules or with a rule line over 4,000 characters (a comment line may be longer), and a path that ends in a slash, naming a line and never the text, before anything is read. `parseCodeowners` reads the file in one pass and returns the rules and the skipped lines; each pattern is compiled to a short list of tokens (any number of directories, one directory, or a name with * and ?) and matched part by part between its stars, each part at the first place it fits, the plain start of a part found with a Knuth-Morris-Pratt search; no regular expression is built from pasted text. `ownersForPaths` scans the rules from the last to the first and the first match decides, so the owners of earlier lines are never merged; it counts its work and refuses a paste that needs more than `MAX_CODEOWNERS_WORK` (300,000,000) steps, naming the path line where matching stopped. A row holds the path, the owners, the deciding line (null when no line matched), its pattern and a note that marks a deciding line resting on a reading GitHub does not document. `codeownersRows(text, pathsText)` does both and returns the rows and the skipped lines.

## Dependencies

- `picomatch` 4.0.7
- `ignore` 7.0.9

## Tests

```sh
npm test
```

Git's own answers are the oracle. The .gitignore corpus holds 112 .gitignore texts against 78 paths (8,736 pairs), recorded with git check-ignore -v -n -z --no-index using Git for Windows 2.53.0 (core.ignorecase and core.autocrlf off; files queried with nothing on disk, directories queried on disk without a trailing slash). The tool and git agree on whether the path is ignored on 8,725 pairs; the 11 that differ are three or more asterisks before a slash (7) and ? or a range against non-ASCII text (4), each listed by name in the test. On those pairs git and this page name the same line on every one. The glob corpus holds 40 patterns made of *, ?, brackets and ** against 57 files (2,280 pairs), recorded with git ls-files and the :(glob) pathspec magic; 2,251 agree and 29 differ ([!a] is not negation in picomatch (24), src/** also matches src (2), and UTF-8 bytes against characters (3)), each listed by name. The picomatch examples published in its README at 4.0.7, the Bash 5.2.37 answers for [!a] and the extglob forms, the fixed limits, the escaping of shown text, and line numbers across 200 rules (groups of 32) and across a re-included directory are checked too. Both corpora, the script that recorded them and the git version are in test/fixtures. CODEOWNERS mode is grounded on GitHub's About code owners page (blob a0ff66d5, CC BY 4.0): its example file, re-typed as two files with 14 paths each, gives the 28 owners and deciding lines the documentation describes, and the owners equal the Python package codeowners 0.9.0. The pattern table of hmarr/codeowners (commit 11d3ff26, MIT, 153 path cases) agrees on 152; the one that differs reads brackets as literal characters while GitHub says [ ] does not work. 3,498 seeded pattern and path pairs were recorded from codeowners 0.9.0 (Python 3.14.3, seed 31) and agree except 2, both named in test/fixtures/codeowners, where a double star is followed by a trailing slash. The package is a port of the matcher the table comes from, so the two are checks on how a pattern form is read and GitHub's page is the source of the rules. Hostile patterns are checked for linear time (an input twice and four times as long), a paste past the work budget is refused at the same path line every time, 40,000 seeded random names and folders give the answers of the usual two-pointer walk for wildcards, and a counter on the regular expression constructor stays at zero.

## Licence

MIT. See [LICENSE](./LICENSE).
