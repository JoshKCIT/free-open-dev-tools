# Generated git-output fixtures

Every file in this folder except this one is the literal, unedited output of a real `git` command,
run against a throwaway repository built in a session scratch directory and then discarded. Nothing
here was hand-written or transcribed; each command below was run once and its stdout saved byte for
byte.

**git version:** `git version 2.53.0.windows.1`

**Generated:** 2026-09-25

## Repository setup

```sh
git init
git config user.email "fixture@example.com"
git config user.name "Fixture Generator"
git config core.autocrlf false
```

## Commands, in the order run

| File | Command |
|------|---------|
| `modify-two-hunks.diff` | `git diff -- file1.txt` (line 2 and line 18 of a 20-line file edited, far enough apart for two hunks) |
| `added-file.diff` | `git diff --cached -- added.txt` (a newly added, staged file) |
| `deleted-file.diff` | `git diff --cached -- deleted.txt` (a staged deletion) |
| `rename-with-edit.diff` | `git diff --cached -M -- rename-src.txt rename-dst.txt` (`git mv` plus one line edited) |
| `copy-file.diff` | `git diff --cached -C --find-copies-harder` (a byte-identical copy of an existing tracked file, staged as a new file) |
| `mode-change.diff` | `git diff --cached -- mode-change.sh` (after `git update-index --chmod=+x`, with `core.filemode=true`) |
| `binary-file-no-binary-flag.diff` | `git diff -- image.bin` (a modified binary file, without `--binary`) |
| `binary-file-with-binary-flag.diff` | `git diff --binary -- image.bin` (the same change, with `--binary`, producing a `GIT binary patch` block) |
| `path-with-space.diff` | `git diff --cached -- "file with space.txt"` (a newly added file whose name contains a space) |
| `path-non-ascii.diff` | `git -c core.quotepath=true diff --cached` (a newly added file named `café.txt`, quoted with C-style octal escapes) |
| `no-final-newline.diff` | `git diff -- no-final-newline.txt` (the last line edited in a file with no trailing newline, both before and after) |
| `format-patch.patch` | `git format-patch -1 HEAD --stdout` (an email-formatted patch: commit metadata and a `---` stat block precede the first `diff --git` header, and a `-- \n<git version>` signature follows the last hunk) |

## Notes

- `path-with-space.diff`'s `+++ b/file with space.txt` header line ends with a literal trailing tab
  character (visible as `.txt\t` if inspected with `cat -A`): git appends this whenever a path
  contains a space, so a reader that trims a header line's trailing whitespace unconditionally would
  silently swallow it. `git-diff-viewer`'s header parsing strips a trailing tab (and anything after
  it) deliberately, not by generic whitespace trimming.
- `copy-file.diff` has no hunks at all (`similarity index 100%` with no line changes), proving a file
  header does not require a hunk to be valid.
