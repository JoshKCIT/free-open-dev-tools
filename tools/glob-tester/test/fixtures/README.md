# Fixtures: what git answered

The unit tests compare this tool with git without ever running git. Git was run once, by hand, on inputs written for
this folder, and its answers are stored here.

| File                          | What it holds                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `corpus-cases.json`           | The inputs: 104 .gitignore texts, 78 paths (files and directories), 40 glob patterns and 57 file paths. Written by hand.             |
| `record-git-corpus.mjs`       | The script that asks git and writes the two files below. Run by hand: `node record-git-corpus.mjs <scratch folder>`.               |
| `git-corpus.json`             | `git check-ignore -v -n -z --no-index --stdin` for every .gitignore text against every path: 8,112 answers.                         |
| `git-pathspec-corpus.json`    | `git ls-files -z -- ":(glob)<pattern>"` for every glob pattern against the 57 files: 2,280 answers.                                 |

- **Git version:** `git version 2.53.0.windows.1` (Git for Windows), recorded in both files as `gitVersion`.
- **Recorded on:** 2026-10-04 (`recordedAt` in both files).
- **Source pages for the rules:** https://git-scm.com/docs/gitignore (PATTERN FORMAT) and
  https://git-scm.com/docs/gitglossary (the `glob` pathspec magic).

## How the .gitignore corpus is recorded

- `core.ignorecase` and `core.autocrlf` are set to `false` explicitly in every repository, because Git for Windows turns
  ignorecase on by default.
- Files are queried in a repository with nothing on disk, so git treats each queried name as a file.
- Directories are queried in a second repository where each directory exists, and without a trailing slash. With a
  trailing slash git reads the part before it as a parent directory and matches an empty name, which is not a question
  about the directory itself. In the cases a path ending in `/` is the directory.
- Each case's text is written byte for byte as the repository's `.gitignore`, so a CR before the line feed and a byte
  order mark reach git as they are.
- `r` in a case is one number per path: 0 no rule matched, n ignored by line n, -n a negation on line n matched (the
  path is not ignored). `printed` holds the pattern text git printed for each deciding line.

## How the pathspec corpus is recorded

Every file is put straight into the index of a repository with nothing on disk (`git update-index --index-info`), with
`core.protectNTFS` off so names holding `*` and `?` are accepted. The script stops if the index does not hold exactly the
corpus files. Patterns holding a backslash are not recorded: Git for Windows turns a backslash in a command line
argument into a slash, so its answer would not be git's answer on other systems.

## Characters

Carriage returns, the byte order mark and every non-ASCII character are stored as JSON escapes, so the files are plain
ASCII and `.gitattributes` (LF line ends) cannot change them.

## Differences from the tool

The tests list every pair on which the tool and git differ, with the class of difference. Each class is stated in the
tool's `limits`. A listed pair that no longer differs fails the test, so the lists cannot go stale.
