# jq Playground

Run a jq filter against pasted JSON and see its output or error, with a time limit for runaway filters.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Runs a jq filter against pasted JSON and shows jq's output or its error. jq 1.8.2, compiled to WebAssembly, runs in a background worker in this page, so a filter that never ends is stopped after 5 seconds and can also be cancelled. The input and the filter are never uploaded, never stored and never put in the address; the filter sees only what you paste.

## Supported

- The jq 1.8 language: paths, pipes, reduce and foreach, functions, regular expressions, date functions, SQL-style operators and the rest of the manual
- Several JSON values in the input, each run through the filter in turn, or all of them gathered into one array with the slurp option
- The compact, raw output, slurp, sort keys, null input and ASCII output options, and two-space, four-space or tab indentation
- Variables from an arguments object, passed to the filter as $name the way jq passes --argjson
- A big number literal passes through unchanged while the filter does not change it
- Syntax errors shown with jq's own message and the line and column it gives, and run-time errors shown without the stdin location

## Limits

- Input up to 5 MiB; output is shown up to 1 MiB.
- A filter that runs longer than 5 seconds is stopped with a message.
- jq 1.8.2 keeps a big number literal as written only while it is not changed; arithmetic uses double precision, so .a+1 on 12345678901234567890123 gives 12345678901234568000000.
- input, inputs and other file or module features see only what you paste: import and include find no modules, and env shows only the engine defaults.
- Error columns count as jq counts them.
- Only jq 1.8.2 is available, and only the options listed here; file arguments, --seq, colour output and --exit-status are not offered.

## Ambiguous cases, and what this does about them

- A number written with more digits than a double can hold prints back as written only if the filter does not do arithmetic on it; after arithmetic it is the nearest double
- jq reports a compile error's column in bytes of the filter, so a filter with non-ASCII characters before the error has a column larger than its character count
- When the filter fails part way through, the output it had already produced is shown above the error
- Several inputs are processed in order and the first failure ends the run, so the inputs after it are not run

## Defined by

- [jq 1.8 Manual](https://jqlang.org/manual/v1.8/)
- [RFC 8259: The JavaScript Object Notation (JSON) Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **jq 1.8.2** (MIT) — [source](https://github.com/jqlang/jq/tree/jq-1.8.2). jq is copyright (C) 2012 Stephen Dolan. jq 1.8.2 is compiled into the WebAssembly module that jq-wasm 3.0.0-jq-1.8.2 ships (dist/build/jq.wasm and, as base64, dist/inline.mjs). The notice file is jq's COPYING, which also carries the notices for David M. Gay's dtoa.c and g_fmt.c, the decNumber library (ICU License), the Heimdal and NetBSD portions, and the CC BY 3.0 notice for jq's documentation.
- **Oniguruma** (BSD-2-Clause) — [source](https://github.com/kkos/oniguruma/tree/4ef89209a239c1aea328cf13c05a2807e5c146d1). Copyright (c) 2002-2021 K.Kosako. Oniguruma, the regular expression library, is built into jq (the jq-wasm build passes --with-oniguruma=builtin) from the commit that jq 1.8.2 pins at vendor/oniguruma, and is therefore inside the WebAssembly module that jq-wasm 3.0.0-jq-1.8.2 ships.
- **Emscripten runtime** (MIT) — [source](https://github.com/emscripten-core/emscripten/tree/6.0.0). Copyright (c) 2010-2014 Emscripten authors. The Dockerfile of jq-wasm 3.0.0-jq-1.8.2 builds with Emscripten 6.0.0, and the Emscripten runtime and C library are part of the module that jq-wasm 3.0.0-jq-1.8.2 ships. Emscripten is offered under the MIT licence and the University of Illinois/NCSA licence; the MIT licence is the one relied on here, and the notice file holds both texts.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/jq-playground jq-playground
cd jq-playground
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/jq-playground
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { loadJq } from 'jq-wasm/inline';
import { runJq } from '@fodt/jq-playground';

const jq = await loadJq();
const result = runJq(jq, '{"a":[1,2,3]}', '.a | map(. * 2)', {
  compact: true,
  raw: false,
  slurp: false,
  sortKeys: false,
  nullInput: false,
  ascii: false,
  indent: '2',
  args: '',
});
// result.output is '[2,4,6]'; a filter error is thrown as JqPlaygroundError.
```

`runJq(engine, input, filter, options)` takes the loaded jq-wasm engine as its first argument, so the package never imports the engine itself; it returns null for a blank filter. The input is refused before the engine runs when it is over `MAX_INPUT_BYTES` (UTF-8 bytes). The options become jq flags (-c, -r, -s, -S, -n, -a, --indent or --tab), and the arguments text, a JSON object whose keys are jq identifiers, becomes one --argjson pair per key with each value passed as written. It returns `{ output, truncated, stderr, exitCode }`: `output` is jq's standard output cut at `MAX_OUTPUT_BYTES` with `truncated` set, `stderr` holds what debug, stderr and halt_error wrote. A jq error is thrown as `JqPlaygroundError` with jq's message, the filter's line and column for a compile error, and the output produced before the failure in `output`. `engineFailureMessage(err)` turns an engine abort, such as running out of memory, into a plain sentence.

## Dependencies

- `jq-wasm` 3.0.0-jq-1.8.2

## Tests

```sh
npm test
```

The jq 1.8 manual is the specification: every one of its examples is run and its documented outputs are compared as JSON values, except the two that read the PAGER environment variable, which the manual assumes is set to less. The manual is licensed CC BY 3.0 and credited in the test fixture. The tests also pin the error texts, the size and output limits, number handling and that env shows only the engine's own defaults.

## Licence

MIT. See [LICENSE](./LICENSE).
