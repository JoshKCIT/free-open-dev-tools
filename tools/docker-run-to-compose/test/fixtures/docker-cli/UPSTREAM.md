# Upstream: docker/cli

- Repository: https://github.com/docker/cli
- Commit: 09d30a34bf8c7b1fe9c323b23935a1ddb7af8ec0
- Commit date: 2026-09-03
- Fetch date: 2026-10-04
- Licence: Apache License, Version 2.0 (see LICENSE in this folder)

`opts.go` and `run.go` are `cli/command/container/opts.go` and `cli/command/container/run.go` at the commit above (the
newest commit on `master` that changed `opts.go`), copied byte for byte with `curl -fsSL
https://raw.githubusercontent.com/docker/cli/09d30a34bf8c7b1fe9c323b23935a1ddb7af8ec0/cli/command/container/<name>`.
LICENSE is `LICENSE` at the same commit. Nothing in this folder is edited: the tests check each file against the git
blob SHA below.

The tests read only the flag registrations in these two files (`flags.String`, `flags.Var`, `flags.BoolP` and the other
forms) to prove that every option `docker run` accepts is in the option table. The Go code is never run.

## Files

- opts.go: 94b8dffa34a62a6f519e33255dcebe317aa6f135
- run.go: 3c25630d6b789edaf63f09a14a7670a08af20b7f
- LICENSE: 9c8e20ab85c1d538df580fdf137c933707fc92b1
