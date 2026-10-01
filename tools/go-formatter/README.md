# Go Formatter

Format Go source exactly as gofmt does, with syntax errors shown by line and column.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Formats Go source the way the gofmt command does with no flags, using the Go standard library's go/format package compiled to WebAssembly and run in a background worker in your browser. Imports are sorted within their blocks, comments are kept, and a syntax error is reported with its line and column instead of any formatted code. Nothing is sent anywhere.

## Supported

- Go 1.25 syntax, including generic type parameters and type aliases
- Import blocks sorted and de-duplicated within each block, as gofmt does
- Comments kept in place and aligned the way gofmt aligns them
- CRLF line endings in the input are accepted and written out as LF
- Whole files, and also bare declarations or statement lists without a package clause
- A syntax error is reported with its line and column, and no formatted code is shown

## Limits

- Formats exactly as gofmt does with no flags; gofmt -s (simplify) and -r (rewrite) are not applied.
- A run that takes longer than 10 seconds is stopped with a message, so a pathological input cannot freeze the page.
- Line and column in an error count characters as you see them; gofmt itself counts bytes, so the column is converted.
- Only the first syntax error is located; when there are more, the message says how many.
- A very long chain of nested expressions (for example 20000 terms added together) is refused with a plain message, because the engine runs out of stack, instead of crashing the page.

## Ambiguous cases, and what this does about them

- gofmt aligns trailing comments and struct field values into columns, so the padding on a line changes when a neighbouring line changes; this is gofmt's own behaviour and is kept
- Source that is not a whole file is accepted when it parses as a list of declarations or statements, and is then formatted without adding a package clause or a final newline, as gofmt does for standard input

## Defined by

- [The Go Programming Language Specification](https://go.dev/ref/spec)
- [gofmt command documentation](https://pkg.go.dev/cmd/gofmt)
- [Package go/format](https://pkg.go.dev/go/format)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **Go standard library 1.25.5** (BSD-3-Clause) — [source](https://github.com/golang/go/tree/go1.25.5/src/go/format). Copyright 2009 The Go Authors. The go/format, go/printer and go/parser packages are compiled into the gofmt WebAssembly module that @wasm-fmt/gofmt 0.7.3 ships.
- **TinyGo runtime** (BSD-3-Clause) — [source](https://github.com/tinygo-org/tinygo/tree/v0.40.1). Copyright (c) 2018-2025 The TinyGo Authors. TinyGo v0.40.1 compiled the Go source into the WebAssembly module and its runtime is part of that module.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/go-formatter go-formatter
cd go-formatter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/go-formatter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadEngine, formatGo } from '@fodt/go-formatter';

const require = createRequire(import.meta.url);
loadEngine(readFileSync(require.resolve('@wasm-fmt/gofmt/wasm')));

formatGo('package main\nfunc main(){}\n');
// { output: 'package main\n\nfunc main() {}\n', inputBytes: 27, outputBytes: 29 }
```

`loadEngine(wasm)` hands the gofmt WebAssembly bytes (or a compiled module) to the engine once; calling it again does nothing. `formatGo(source)` returns `{ output, inputBytes, outputBytes }`, or `null` for blank or whitespace-only source without calling the engine, and throws `GoFormatterError` for every engine failure, never returning partly formatted code. The error carries `line` and `column` (both 1-based, the column counted in characters) when gofmt located a syntax error.

## Dependencies

- `@wasm-fmt/gofmt` 0.7.3

## Tests

```sh
npm test
```

The oracle is the gofmt command's own published test data at tag go1.25.5 (src/cmd/gofmt/testdata): the sixteen fixtures that need no flag (comments, crlf, go2numbers, import, issue28082, stdin1 to stdin7, tabs, typealias, typeparams and typeswitch) are formatted and compared byte for byte with their golden files, and each golden formats to itself. The slices1 fixture, whose golden needs gofmt -s, proves that simplification is not applied. The goldens are vendored with Go's licence and a record of where they came from. Error positions in the tests are counted by hand from each test's input.

## Licence

MIT. See [LICENSE](./LICENSE).
