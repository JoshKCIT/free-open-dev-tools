# The recorded git log output

`gitlog.txt` is the default output of `git log` for a scratch repository made by `record-gitlog.sh`. The tests read this file
and never run git. It is the unit fixture for the `git log` splitter, so its hashes are real 40-digit hashes of a scratch
repository that no longer exists; page fixtures use short synthetic hashes instead.

| What          | Value                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- |
| git           | `git version 2.53.0.windows.1`                                                                  |
| Recorded      | 2026-10-08 (UTC; 2026-10-07 local)                                                              |
| Command       | `bash record-gitlog.sh <scratch repository folder> gitlog.txt`                                  |
| Authors       | one synthetic author, `Example Author <author@example.invalid>`                                 |
| Dates         | fixed author and committer dates, one commit a day from 2026-01-05 to 2026-01-15, all at 10:00 UTC |
| Output        | `git -c log.decorate=no log` with carriage returns stripped; blank lines inside a message are written by git as four spaces |

## The commits (newest first, as the log lists them)

| Position | Message                                                                          | Kind        |
| -------- | -------------------------------------------------------------------------------- | ----------- |
| 1        | `fix: prevent racing of requests`, two body paragraphs, footers `Reviewed-by: Z` and `Refs: #123` | message     |
| 2        | `amend! feat!: drop support for Node 6` with the original message as its body    | git line (`git commit --fixup=amend:`) |
| 3        | `squash! feat!: drop support for Node 6`                                         | git line (`git commit --squash=`)      |
| 4        | `fixup! fix(api): handle empty input`                                            | git line (`git commit --fixup=`)       |
| 5        | `Revert "feat: add a parser"` and the sentence `This reverts commit <hash>.`      | git line (`git revert`)                |
| 6        | `Merge branch 'topic'`, with a `Merge:` header line                              | git line (`git merge --no-ff`)         |
| 7        | `chore: update the build image`                                                  | message     |
| 8        | `docs: correct spelling of CHANGELOG`                                            | message     |
| 9        | `feat!: drop support for Node 6` with a `BREAKING CHANGE:` footer                | message     |
| 10       | `fix(api): handle empty input`, a body paragraph and the footer `Refs: #12`      | message     |
| 11       | `feat: add a parser`                                                             | message     |

The six messages and the five lines git wrote itself are what `test/commit.test.ts` expects from the `gitlog` mode.
