# Shell Script Formatter

Format shell scripts for POSIX sh, bash or mksh with shfmt and a chosen indent, with syntax errors shown by line and column.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Formats shell scripts with shfmt, the formatter of the mvdan/sh parser, compiled to WebAssembly and run in a background worker in your browser. You choose bash, mksh or POSIX sh and an indent: tabs, which is what shfmt does by default, or a number of spaces. A syntax error is reported with its line and column instead of any formatted code. Nothing is sent anywhere.

## Supported

- bash and mksh scripts, each read in its own dialect (a mksh coprocess is refused when the dialect is bash)
- POSIX sh scripts, formatted exactly as they would be under bash
- Indent 0 for tabs, which is shfmt's default, or 1 to 16 spaces
- A first line naming the shell (a shebang) is honoured when the dialect is POSIX sh
- Comments, here-documents and line continuations are kept
- A syntax error is reported with its line and column, and no formatted code is shown

## Limits

- POSIX sh formats your script but bash-only syntax is not refused: this engine build cannot parse in POSIX mode, so it reads every script as bash or mksh. Use a POSIX checker if you need conformance.
- A run that takes longer than 10 seconds is stopped with a message, so a pathological input cannot freeze the page.
- Line and column count characters as you see them; shfmt reports a byte column, which is converted.
- Only the first syntax error is reported.
- Indent 0 means tabs, as shfmt does by default; the indent must be a whole number from 0 to 16.
- Only the dialect and the indent can be chosen; shfmt's other switches (binary operators at the start of a line, indented case branches, spaces after redirect operators, functions with the brace on its own line, simplify) are not offered.
- A script nested thousands of levels deep (for example 2000 command substitutions inside each other) is refused with a plain message instead of crashing the page.
- After one input that was too large or too deeply nested the shfmt engine is stopped for good: every later call in the same process says so and asks for a new worker or process, because the package cannot start a new engine instance. The page uses a new worker for every run, so it is not affected.

## Ambiguous cases, and what this does about them

- A first line such as #!/bin/mksh makes the engine read the script as mksh even when the dialect is POSIX sh, because the engine only ignores the file-name hint for POSIX sh and then looks at the first line
- The printer does not depend on the dialect, so a script that is valid in all three dialects formats to the same text under each; the dialect only changes which scripts are accepted
- Redirect operators keep the spacing shfmt gives them by default (no space after the operator), and runs of spaces between words are collapsed to one

## Defined by

- [POSIX Shell Command Language (The Open Group Base Specifications Issue 8)](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html)
- [GNU Bash Reference Manual](https://www.gnu.org/software/bash/manual/bash.html)
- [shfmt documentation](https://github.com/mvdan/sh/blob/v3.13.1/cmd/shfmt/shfmt.1.scd)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **mvdan/sh 3.13.1** (BSD-3-Clause) — [source](https://github.com/mvdan/sh/tree/v3.13.1). Copyright (c) 2016, Daniel Martí. The mvdan.cc/sh/v3 parser and printer (the library behind shfmt) are compiled into the WebAssembly module that @wasm-fmt/shfmt 0.2.7 ships.
- **TinyGo runtime** (BSD-3-Clause) — [source](https://github.com/tinygo-org/tinygo/tree/v0.40.1). Copyright (c) 2018-2025 The TinyGo Authors. TinyGo v0.40.1 compiled the Go source into the WebAssembly module and its runtime is part of that module.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/shell-formatter shell-formatter
cd shell-formatter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/shell-formatter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadEngine, formatShell } from '@fodt/shell-formatter';

const require = createRequire(import.meta.url);
loadEngine(readFileSync(require.resolve('@wasm-fmt/shfmt/wasm')));

formatShell('if true\nthen\necho hi\nfi\n', { dialect: 'bash', indent: 2 });
// { output: 'if true; then\n  echo hi\nfi\n', inputBytes: 24, outputBytes: 27 }
```

`loadEngine(wasm)` hands the shfmt WebAssembly bytes (or a compiled module) to the engine once; calling it again does nothing. `formatShell(source, options?)` returns `{ output, inputBytes, outputBytes }`, or `null` for blank or whitespace-only source without calling the engine. The options are `dialect` ('posix', 'bash' or 'mksh'; the default is 'bash') and `indent` (0 for tabs, which is the default, or 1 to 16 spaces). The dialect is passed to the engine as a file name (`input.sh`, `input.bash` or `input.mksh`). It throws `ShellFormatterError` for every failure, never returning partly formatted code; the error carries `line` and `column` (both 1-based, the column counted in characters) when shfmt located a syntax error. `SHELL_DIALECTS` lists the three choices with their labels.

## Dependencies

- `@wasm-fmt/shfmt` 0.2.7

## Tests

```sh
npm test
```

The oracle is shfmt's own published test data at mvdan/sh v3.13.1 (cmd/shfmt/testdata/script/flags.txtar): the flags input is formatted with an indent of 2 and compared byte for byte with the published indent golden, and with the default indent against the published golden that differs from the default in one padding line, the mksh coprocess case is formatted as mksh and refused as bash, and the bash arrays case that upstream refuses in POSIX mode is used to show the limit stated above. The vendored fixtures keep the shfmt licence and a record of where they came from. Error positions in the tests are counted by hand from each test's input.

## Licence

MIT. See [LICENSE](./LICENSE).
