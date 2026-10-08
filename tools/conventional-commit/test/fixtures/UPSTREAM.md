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
