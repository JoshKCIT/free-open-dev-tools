# docker run to Compose Converter

Turn a docker run command into a Compose service, with every option that has no Compose equivalent listed.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Paste a docker run command and get the same container written as a Compose service in YAML, checked against the Compose Specification schema. Every option the Docker command line registers for docker run is read and shown in a table with the Compose key it became. Options Compose has no key for (such as --rm, --detach and --cidfile) are listed with the reason instead of being dropped silently, and so are options that need another service in the same file. The command is read as text and never run: nothing is pulled, started or looked up, and nothing you paste is sent anywhere.

## Supported

- Every option of docker run in the Docker CLI source that this page was checked against, including the short forms (-itd, -p8080:80, -eKEY=value), the equals forms (--name=web), the hidden and deprecated names, and docker container run
- Options end at the image: every word after the image is the command, even one that starts with a dash, and -- ends the options; a shell prompt ($) in front of the command, as copied from a page of examples, is ignored
- POSIX and Bash quoting (single quotes, double quotes, backslash, $'...') and backslash line continuations; $NAME and ${NAME} are kept for Compose to fill in, $(pwd) becomes the current folder
- Named volumes and user-defined networks declared at the top level of the file, healthcheck, logging, ulimits, devices, blkio and GPU options mapped to their Compose keys, and --mount read into the long volume syntax
- A Compose Specification schema check of the service that is written, with each problem named by its path

## Limits

- A paste is limited to 65,536 characters.
- The command is read as text and never run; no image is pulled and nothing is started.
- $NAME and ${NAME} are kept for Compose to fill in from its environment; $(pwd) becomes the current folder; any other command substitution is refused.
- Options with no Compose equivalent (for example --rm, --detach, --cidfile) are listed with the reason instead of being written.
- --link, --volumes-from and network addresses without a user-defined network need another service or network in the same file; they are listed, not written.
- Files named by --env-file and --label-file must exist when Compose runs.
- Only docker run and docker container run are read; docker options placed before the word run, a shell pipeline and anything else a shell would run are refused.
- At most the first 1,000 rows of the options table and the first 200 items of each list are shown; the counts above them cover every option.
- A value such as a size or a number that is written as a variable (for example -m $MEM) is not checked and is written as text for Compose to fill in.

## Ambiguous cases, and what this does about them

- A bare -e KEY takes its value from the shell that runs docker; in Compose a bare KEY in environment takes it from Compose's own environment, which is usually the same shell.
- $(pwd) is the absolute folder the command ran in; Compose reads a relative path such as . as relative to the folder that holds the Compose file, so the two agree only when the file sits where the command ran.
- --entrypoint takes one program name, not a command line: docker uses the whole text as the program, so it is written as a one-item list.
- --restart no is written as the quoted string "no", because an unquoted no is read as a boolean by YAML 1.1.
- Options given more than once: a single-value option keeps the last value (as docker does); list options keep every value.
- A -v or --mount source is treated as a named volume, and declared at the top level, when it looks like a docker volume name: at least two characters, letters, digits, underscore, dot or dash, starting with a letter or digit. Anything else, such as a path or a source with a variable in it, is left as written.
- A --network value of host, none, bridge, default or container: is a network mode and becomes network_mode; any other value is a user-defined network, written under networks and declared external at the top level, because docker run expects it to exist already.

## Defined by

- [Docker CLI reference for docker run](https://docs.docker.com/reference/cli/docker/container/run/)
- [Compose Specification](https://github.com/compose-spec/compose-spec/blob/main/spec.md)
- [POSIX Shell Command Language, section 2.2 Quoting](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **Compose Specification JSON Schema** (Apache-2.0) — [source](https://github.com/compose-spec/compose-spec). "Compose Specification" schema by the Compose Specification project, licensed under the Apache License, Version 2.0. Snapshot taken at commit 914ec15d1fa498969c0df5c1d672306db3256089.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/docker-run-to-compose docker-run-to-compose
cd docker-run-to-compose
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/docker-run-to-compose
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { convertDockerRun } from '@fodt/docker-run-to-compose';

const result = convertDockerRun('docker run --name web -p 8080:80 --rm nginx:1.27');
result.yaml;
// services:
//   web:
//     image: "nginx:1.27"
//     container_name: "web"
//     ports:
//       - "8080:80"
result.noEquivalent.map((entry) => entry.option); // ['--rm']
result.validation.valid; // true
```

`convertDockerRun(text, serviceName?)` reads the command with a shell-word tokenizer that never runs anything, reads the options the way docker's own command line does (options end at the image), and returns the Compose document, its YAML, a row for every option read, the options with no Compose equivalent, the options that need another service, the unknown options with the closest known name, hints and the Compose Specification schema check. Any refusal is a DockerRunError with a line and a column and never repeats more than 40 escaped characters of the paste. `tokenizeDockerCommand`, `parseDockerRun`, `DOCKER_RUN_OPTIONS` and `validateComposeDocument` are exported for use on their own. Everything is pure and runs in Node or a browser.

## Dependencies

- `yaml` 2.9.1
- `ajv` 8.20.0

## Tests

```sh
npm test
```

The option table is checked against the flag registrations in the Docker CLI source files cli/command/container/opts.go and run.go at a recorded commit, copied unchanged with their licence and an UPSTREAM.md of git blob SHAs: all 108 registered flags must be in the table with their value type, short form and a Compose key or a reason. Every option that has a Compose key is converted from a sample command and the service must be accepted by the Compose Specification JSON schema, bundled here as an unchanged copy of the upstream file. The same 108 samples and ten recorded commands were run through docker compose config (Compose v5.3.1, no daemon), which accepted all 118 YAML files, and through docker run with no daemon (Docker 29.6.2), whose own option reader accepted every option and value except the newest flag, --umask; that record is committed with the script that made it. The shell reading, the dollar rules, the size limit, the YAML quoting and the rule that messages never repeat pasted text have their own tests, and a browser test compares the page output for ten recorded commands with the YAML the unit tests assert in four browsers.

## Licence

MIT. See [LICENSE](./LICENSE).
