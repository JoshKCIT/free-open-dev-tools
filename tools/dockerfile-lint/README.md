# Dockerfile Linter

Parse a Dockerfile and report syntax problems and common mistakes.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Parses a Dockerfile with a hand-written parser (checked against an independent parser in tests) and reports both genuine syntax problems -- an instruction before the first FROM, an unrecognised instruction, a malformed exec-form JSON array, an unterminated here-document -- and common mistakes cited to Docker's own documentation, each at its line with the instruction at fault. Nothing about the file is sent anywhere; parsing and linting run entirely in this tab.

## Supported

- Parser directives (# syntax=, # escape=) recognised only at the very top of the file, as the Dockerfile reference describes
- The escape parser directive, switching the continuation character from backslash to backtick
- Backslash- or backtick-continued logical lines, with a comment or blank line inside a continuation skipped rather than ending it
- Here-documents (<<WORD and <<-WORD) consumed to their terminator line
- Exec (JSON array) and shell form for RUN, CMD, ENTRYPOINT and SHELL
- Multi-stage builds: stage names, --from references by name or index, and per-stage state such as the last USER
- 21 rules cited to the Dockerfile reference, Docker's own build checks or its building best practices guide

## Limits

- This tool cannot build the image, pull the base image or run any command, so it cannot tell whether a package or a referenced file actually exists -- only docker build can show that.
- Shell commands inside RUN are checked only for the specific patterns the rules above name (apt-get, cd, sudo); anything else typed into a shell script is not inspected.
- Rules are this project's own, written in the spirit of well-known linters and Docker's own build checks, never a copy of another tool's rule text.
- A COPY --from value containing a slash, a dot or a colon is treated as an external image reference and is not checked against this file's stage names, since this tool cannot tell whether that image exists.

## Ambiguous cases, and what this does about them

- A bare COPY --from value (no slash, dot or colon) could name either a stage in this file or a short, unqualified image name such as "alpine" on a public registry. This tool treats it as a stage reference and reports it when no stage in the file has that name or index, matching how a real build resolves --from -- stage names are tried first.

## Defined by

- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [Docker build checks](https://docs.docker.com/reference/build-checks/)
- [Docker building best practices](https://docs.docker.com/build/building/best-practices/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/dockerfile-lint dockerfile-lint
cd dockerfile-lint
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/dockerfile-lint
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { lintDockerfile } from '@fodt/dockerfile-lint';

const result = lintDockerfile(text);
for (const finding of result.findings) {
  console.log(finding.line, finding.path, finding.message);
}
```

`lintDockerfile` always returns `{ findings, instructions, stages }`; it only throws `DockerfileLintError` for input over the 1 MB limit. Every finding carries a 1-based `line` and `endLine`, the instruction `path`, a `severity` of `error` or `warning`, and, for a rule finding, the rule's `ruleId` and `docsUrl`.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Correctness is checked two ways: a differential test against the independent dockerfile-ast package (devDependency-only, never shipped) confirms this hand-written parser agrees on every instruction's name and line range over ten real, vendored Dockerfiles; and 22 broken fixtures, one or more per rule plus each syntax-problem category, are asserted against this tool's own exact reported line, key and message.

## Licence

MIT. See [LICENSE](./LICENSE).
