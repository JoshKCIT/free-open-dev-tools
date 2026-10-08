# Upstream material for the Conventional Commit Checker tests

What the tests are grounded on, where each piece comes from, under which licence, and how it was made. Nothing here is
fetched or run while the tests run: the tests only read these files.

## Conventional Commits 1.0.0 (cited and re-typed, with attribution)

| What        | Value                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Repository  | `conventional-commits/conventionalcommits.org`                                                                                 |
| Path        | `content/v1.0.0/index.md`                                                                                                      |
| Git blob    | `4fa8464d66f7659c3565a2a84ce0577839552046` (10,374 bytes), repository head `7d293dc5` of 2026-03-11                             |
| Published   | https://www.conventionalcommits.org/en/v1.0.0/                                                                                 |
| Licence     | The published page says "Creative Commons - CC BY 3.0"; the repository is MIT. The text is quoted by rule number, not copied. |
| Read on     | 2026-10-06 (research) and checked again on 2026-10-07 (the blob hash of the saved copy equals the value above)                   |
| Used how    | `spec-examples.json` holds the seven examples of its section "Examples", re-typed, with the parts each one shows; `test/commit.test.ts` holds one passing and one failing message for each of the 16 numbered rules of its section "Specification", written from the words of the rule |

Attribution (CC BY 3.0): "Conventional Commits 1.0.0", https://www.conventionalcommits.org/en/v1.0.0/, by the Conventional
Commits authors, licensed under Creative Commons Attribution 3.0 (https://creativecommons.org/licenses/by/3.0/). The seven
example messages and the quoted rule fragments in the tests were re-typed; no other change was made to their meaning.

## Semantic Versioning 2.0.0 (cited)

The version parser is the official regular expression with numbered groups from https://semver.org/spec/v2.0.0.html
(CC BY 3.0, "Semantic Versioning 2.0.0" by Tom Preston-Werner), run only on text of at most 256 characters. The bump follows
the specification's own summary lines: a fix correlates with PATCH, a feat with MINOR and a breaking change with MAJOR,
and "Additional types ... have no implicit effect in Semantic Versioning (unless they include a BREAKING CHANGE)".

## The reference parser (recorded as data)

| What        | Value                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Package     | `@conventional-commits/parser` 0.4.1, ISC licence, "reference implementation of conventionalcommits.org spec"                   |
| Recorded as | `reference/reference.json`: 1,033 messages (the 33 research probes and 1,000 seeded ones) with its answer for each              |
| Made by     | `reference/record-reference.cjs` on `reference/make-corpus.mjs`, run by hand from a scratch folder; nothing is installed here    |
| Read how    | `reference/README.md` lists the versions, the seed, the date and the ten places where this page follows the wording instead      |

No source code of the parser is copied; only its answers are kept.

## git log output (recorded as data)

| What        | Value                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Tool        | `git version 2.53.0.windows.1`                                                                                                  |
| Recorded as | `gitlog/gitlog.txt`: the default `git log` output of a scratch repository with synthetic authors at example.invalid            |
| Made by     | `gitlog/record-gitlog.sh`; `gitlog/README.md` lists the eleven commits                                                           |
| Hashes      | real 40-digit hashes of a scratch repository that no longer exists (unit fixture only); page fixtures use short synthetic hashes |
