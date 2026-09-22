# Chmod Calculator

Convert between symbolic and octal Unix permissions, including setuid and sticky bits.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts between the octal form you pass to chmod and the nine-character form ls prints, in both directions, with the three special bits handled properly. It also applies a chmod expression such as u+x,go-w to an existing mode, which is the part people get wrong, and warns about the combinations that are usually mistakes.

## Supported

- Octal to symbolic and back, for all 4096 possible modes
- The setuid, setgid and sticky bits, rendered as s, S, t and T in the right positions
- The ten character form that ls prints, including the leading type character
- chmod expressions with +, - and =, several clauses separated by commas, and a default of all three triads
- Working out what mode a new file or directory gets under a given umask
- Warnings for world-writable files, setuid binaries, special bits that have no effect, and read without execute on a directory

## Limits

- This covers POSIX permission bits only. Access control lists, extended attributes, SELinux labels and Windows ACLs all sit on top and can override what these bits say.
- Whether a special bit does anything depends on the operating system. The sticky bit on a regular file is ignored on Linux; setgid on a directory behaves differently on BSD.
- It does not read or change anything on your filesystem. It computes modes and prints the command you would run.
- Permission to reach a file also depends on execute permission on every directory in the path above it, which no single mode can tell you.

## Ambiguous cases, and what this does about them

- A capital S or T in a symbolic mode means the special bit is set but the matching execute bit is not, so the bit has no effect. It looks like a typo and is usually a mistake, so it is called out explicitly.
- On a directory, read and execute mean different things: read lists the names, execute opens what is inside. Read without execute is legal, nearly useless, and reported.

## Defined by

- [POSIX.1-2017 — chmod](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/chmod.html)
- [POSIX.1-2017 — File permission bits](https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap04.html#tag_04_06)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/chmod-calculator chmod-calculator
cd chmod-calculator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/chmod-calculator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { report, fromMode, toSymbolic, applyExpression, applyUmask } from '@fodt/chmod-calculator';

toSymbolic(fromMode(0o755));       // 'rwxr-xr-x'
applyExpression(0o644, 'u+x');     // 0o744
applyUmask(0o022, true);           // 0o755
report(0o4755).warnings;           // setuid caution
```

Modes are plain numbers, so octal literals such as `0o755` work directly. `report` takes an `isDirectory` flag because several of the warnings only make sense for one or the other.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

All 4096 modes are round-tripped through both the numeric and the symbolic representation. The special bit rendering is asserted for every combination, including the capital S and T cases. chmod expressions are tested for add, remove, replace, default-to-all and multi-clause forms, and umask is checked against the three common values with a property test that a new file never gains execute permission.

## Licence

MIT. See [LICENSE](./LICENSE).
