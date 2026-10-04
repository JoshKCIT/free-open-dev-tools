# Fixtures of the docker run to Compose Converter

Everything in this folder is test data. None of it is part of the published package.

| File or folder                 | What it is                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-cli/`                  | `opts.go` and `run.go` of the Docker CLI source (Apache-2.0) at commit `09d30a34bf8c7b1fe9c323b23935a1ddb7af8ec0`, fetched on 2026-10-04.      |
| `compose-spec/`                | The Compose Specification JSON schema (Apache-2.0) at commit `914ec15d1fa498969c0df5c1d672306db3256089`, fetched on 2026-09-25.                |
| `samples.json`                 | One command for every option `docker run` registers (108 of them), with the Compose key it must write or how it is listed.                    |
| `recorded-commands.json`       | The ten commands whose YAML the unit tests and the browser test both assert.                                                                  |
| `acceptance.json`              | The record of the offline Compose run, made with `run-acceptance.mjs`: for every command, the hash of the YAML and what Compose and docker said. |
| `run-acceptance.mjs`           | The script that made `acceptance.json`. Run by hand; CI never runs Docker.                                                                    |

## The vendored files

`docker-cli/` and `compose-spec/` are copied byte for byte. Each has a licence text and an `UPSTREAM.md` that records the
commit, the date and the git blob SHA of every file; `test/schema.test.ts` checks every file against its SHA. The
Compose schema folder is also a byte for byte copy of the schema folder vendored elsewhere in this repository, and the converter's
`src/compose-spec-schema.ts` must equal what `test/build-compose-schema.ts` builds from `compose-spec/compose-spec.json`.

The Go files are only read as text: `test/options.test.ts` scans their flag registrations (`flags.Var`, `flags.BoolVarP`,
`flags.DurationVar` and the other forms), and every flag it finds, 108 in all, must be in the converter's option table with
its value type, its short form and a Compose key or a reason.

## The offline acceptance run

```
node tools/docker-run-to-compose/test/fixtures/run-acceptance.mjs <scratch-folder>
```

Versions used for the committed record (2026-10-04, Windows 11):

- `Docker version 29.6.2, build dfc4efb`
- `Docker Compose version v5.3.1`

For every sample and every recorded command the script writes the YAML the converter gives and runs two commands with no
daemon (`DOCKER_HOST` points at a closed port, so nothing is started, pulled or looked up):

1. `docker compose -f <file> config --quiet`: Compose must accept the YAML.
2. `docker run <the command's words>`: docker's own option reader must accept every option and value. The command stops
   at the connection to the daemon, which only happens after every option has been read. One sample is expected to be
   refused: `--umask` is in the recorded source files but not yet in Docker CLI 29.6.2 (`unknown flag: --umask`).

The unit test `the recorded docker compose config run accepted every sample` checks that every sample is in
`acceptance.json`, was accepted by Compose, and that the hash of its YAML is still what the converter writes now. When
the converter changes the YAML of any sample, run the script again and commit the new record.

The script bundles the converter with the repository's own esbuild into the scratch folder, makes the empty files the
samples name (`a.envfile`, `labels`; never a file called `.env`), starts every child process with an argument array
(never a shell string) and exits with a non-zero code when Compose refuses a sample.
