# Fixtures: what grounds the CODEOWNERS mode

The unit tests compare the CODEOWNERS matcher with three outside sources without ever fetching or running them. Each was
read or run once, by hand, and what it said is stored here. `UPSTREAM.md` holds the repositories, commits, git blob
checksums and licences.

| File                       | What it holds                                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs-example.json`        | GitHub's documented CODEOWNERS example, re-typed as two files, 14 paths and 28 answers (owners and deciding line). CC BY 4.0.                                           |
| `patterns.json`            | The pattern table of `hmarr/codeowners`: 30 pattern groups and 153 path cases, each with whether the pattern matches the path. MIT, vendored byte for byte.            |
| `LICENSE.txt`              | The MIT licence text of `hmarr/codeowners` (Copyright (c) 2020 Harry Marr).                                                                                           |
| `generate-pairs.py`        | Makes the 3,498 (pattern, path) pairs from seed 31. Standard library only.                                                                                            |
| `record-second-matcher.py` | Asks the Python package `codeowners` 0.9.0 about each pair and writes `second-matcher.json`.                                                                           |
| `second-matcher.json`      | The recording: `recordedAt`, `version`, `seed`, 3,498 pairs `[pattern, path, matched]`, and `differences` (the pairs where this tool and the recording disagree).     |

## The recorded second matcher

- **Package:** `codeowners` 0.9.0 (MIT), run with Python 3.14.3 from a scratch environment. Nothing was installed for this
  tool and the package is not a dependency of anything in the repository.
- **Not independent of the table:** the package is a Python port of the matching rules of the Go project the pattern table comes
  from, so the table and the recording are related and do not count as two separate opinions. GitHub's own page, not either of
  them, is the source for every documented rule; both are checks that a pattern form was not misread.
- **Seed and pairs:** seed 31, 4,000 tries, 3,498 pairs kept. Patterns are one to four tokens from `* ** / a b .js ? docs x *.js a* /** **/`,
  paths one to five tokens from `a b docs x .js / a.js ab`. A pattern with three or more stars in a row is dropped, because the
  CODEOWNERS mode lists those lines as unsupported and matches nothing.
- **Recorded on:** 2026-10-08 (UTC), as `recordedAt` says.
- **How:** `python record-second-matcher.py second-matcher.json`. For each pair a one-line CODEOWNERS file (the pattern and
  one owner) is built, and the package is asked who owns the path; an owner means the pattern matched.
- **Differences:** the test runs this tool's matcher on every pair and compares. The pairs where the two disagree are listed in
  the `differences` array of `second-matcher.json`, each with the pattern, the path, both answers and a reason; the test fails
  if the live list and the stored list differ in any pair. To write the list after the matcher changed, run the test once with
  `RECORD_DIFFERENCES=1` and read the result in the diff before committing it.

| Pattern (paths)                                            | The recording | This tool | Why                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*/**/` (`xba/.js`)                                        | not owned     | owned     | A double star followed by a trailing slash. The vendored `hmarr/codeowners` table says `foo/**/` owns `foo/bar`; the recorded package wants one more directory below the double star. The two sources disagree; this page follows the table. |
| `/?**/**/` (`docsx/b`)                                     | not owned     | owned     | The same family.                                                                                                                                                                                                          |

Everything else agrees: 3,496 of 3,498 pairs. GitHub documents none of the degenerate forms (runs of double stars and of
slashes), and the mode marks every row they decide with the words not documented by GitHub.

## The vendored pattern table

`patterns.json` has 153 path cases. All but one agree with this tool. The one that does not is the pattern
`/apps/[param]/file.ts` against `apps/[param]/file.ts`: that table reads the brackets as literal characters, while GitHub's page
says a `[ ]` range "doesn't work", so this tool lists such a line as unsupported and it matches nothing.

## The documented example

`docs-example.json` follows the example file on GitHub's "About code owners" page. The deciding line of each answer is counted
over every pasted line, comment lines included, so the `*` rule after the comment line is line 2. The owners of all 28 answers were
also checked against the `codeowners` 0.9.0 package (all equal). A line of `null` means no line matched; an empty list of owners with a
line number means a line with no owners decided the path.
