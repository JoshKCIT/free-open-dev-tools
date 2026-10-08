#!/usr/bin/env bash
# Records the default `git log` output of a scratch repository, for the git log splitter's tests.
#
#   bash record-gitlog.sh <scratch repository folder> <output file>
#
# The repository is made from scratch with whatever git is installed (the recording in gitlog.txt was made with git 2.53.0),
# with synthetic authors at example.invalid and fixed author and committer dates, so the log differs between runs only in
# the hashes. It holds ordinary Conventional Commits, a merge commit, a revert, and a fixup, a squash and an amend commit
# (the lines git writes itself). Carriage returns are stripped from the output, because git for Windows can write them.
#
# Nothing here is run by the unit tests: they only read gitlog.txt.
set -eu

repo="$1"
out="$2"

rm -rf "$repo"
mkdir -p "$repo"
cd "$repo"

export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME="Example Author"
export GIT_AUTHOR_EMAIL="author@example.invalid"
export GIT_COMMITTER_NAME="Example Author"
export GIT_COMMITTER_EMAIL="author@example.invalid"
export GIT_EDITOR=true
export GIT_MERGE_AUTOEDIT=no
export LC_ALL=C

git init -q -b main .
git config core.autocrlf false
git config commit.gpgsign false

# Every call that makes a commit takes the date as its first argument.
at() {
  export GIT_AUTHOR_DATE="$1"
  export GIT_COMMITTER_DATE="$1"
}

at "2026-01-05T10:00:00+0000"
echo parser > parser.txt
git add parser.txt
git commit -q -m "feat: add a parser"
first=$(git rev-parse HEAD)

at "2026-01-06T10:00:00+0000"
echo api > api.txt
git add api.txt
git commit -q -m "fix(api): handle empty input

The parser returned null.

Refs: #12"
second=$(git rev-parse HEAD)

at "2026-01-07T10:00:00+0000"
echo node > node.txt
git add node.txt
git commit -q -m "feat!: drop support for Node 6

BREAKING CHANGE: use JavaScript features not available in Node 6."
third=$(git rev-parse HEAD)

git checkout -q -b topic
at "2026-01-08T10:00:00+0000"
echo changelog > changelog.txt
git add changelog.txt
git commit -q -m "docs: correct spelling of CHANGELOG"

git checkout -q main
at "2026-01-09T10:00:00+0000"
echo image > image.txt
git add image.txt
git commit -q -m "chore: update the build image"

at "2026-01-10T10:00:00+0000"
git merge -q --no-ff --no-edit topic

at "2026-01-11T10:00:00+0000"
git revert --no-edit "$first" > /dev/null

at "2026-01-12T10:00:00+0000"
git commit -q --allow-empty --fixup="$second"

at "2026-01-13T10:00:00+0000"
git commit -q --allow-empty --squash="$third"

at "2026-01-14T10:00:00+0000"
git commit -q --allow-empty --fixup="amend:$third" --no-edit

at "2026-01-15T10:00:00+0000"
echo race > race.txt
git add race.txt
git commit -q -m "fix: prevent racing of requests

Introduce a request id and a reference to latest request. Dismiss
incoming responses other than from latest request.

Remove timeouts which were used to mitigate the racing issue but are
obsolete now.

Reviewed-by: Z
Refs: #123"

git --no-pager -c log.decorate=no log | tr -d '\r' > "$out"
git --version
