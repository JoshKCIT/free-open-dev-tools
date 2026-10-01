# Dart Formatter

Format Dart code with the dart_style formatter at a chosen line width, with syntax errors shown by line and column.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Formats Dart code with dart_style, the formatter behind dart format, compiled to WebAssembly and run in a background worker in your browser. You choose the line width, which is 80 unless you change it, and get dart_style's current tall style. A syntax error is reported with its line and column instead of any formatted code. Nothing is sent anywhere.

## Supported

- Dart source files, formatted in dart_style's tall style at the newest Dart language version the formatter knows
- A line width from 1 to 1000 columns; 80 is dart_style's own default
- Trailing commas, comments, annotations, records, patterns and switch expressions are handled as dart format handles them
- A syntax error is reported with its line and column, and no formatted code is shown
- CRLF input is accepted; the output uses LF line endings

## Limits

- A run that takes longer than 10 seconds is stopped with a message, so a pathological input cannot freeze the page.
- This formatter needs WebAssembly garbage collection; the current Chromium, Firefox and Safari engines have it, and older browsers get a message instead of a result.
- Using this folder outside the site needs Node 22 or newer (WebAssembly garbage collection).
- Line and column in an error count characters as you see them; dart_style counts UTF-16 code units, so a character outside the basic multilingual plane, such as an emoji, is converted to count once.
- Only the first syntax error is reported: the first one the formatter lists, which is not always the one nearest the top of the file.
- The line width must be a whole number from 1 to 1000 (a limit of this page, not of dart_style).
- Only the line width can be chosen; dart_style's short style, a language version, preserved trailing commas, a leading indent and experiments are not offered.
- A source nested thousands of levels deep (for example an expression of 5000 terms) is refused with a plain message instead of crashing the page.

## Ambiguous cases, and what this does about them

- dart_style formats at the newest Dart language version it supports, so code that is only valid at an older language version may be refused or formatted differently than dart format with an older SDK constraint would
- A line width of 1 is accepted, but no line can be that short, so every wrappable construct is split as far as the formatter can split it
- The first syntax error reported is the first the formatter lists; the formatter lists errors in the order its parser finds them, which is not strictly top to bottom

## Defined by

- [dart format](https://dart.dev/tools/dart-format)
- [Dart language specification](https://dart.dev/resources/language/spec)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **dart_style formatter** (BSD-3-Clause) — [source](https://github.com/dart-lang/dart_style/tree/v3.1.4). Copyright 2014, the Dart project authors. dart_style 3.1.4 is compiled into the WebAssembly module that @wasm-fmt/dart_fmt 0.4.0 ships.
- **Dart SDK runtime and core libraries** (BSD-3-Clause) — [source](https://github.com/dart-lang/sdk/tree/3.10.7). Copyright 2012, the Dart project authors. The dart2wasm compiler's runtime and the core libraries are part of the WebAssembly module. The module does not record the SDK version that compiled it; 3.10.7 is the newest stable release before the wrapper was published, and the licence text is the same at 3.9.0.
- **Dart packages compiled into the engine** (BSD-3-Clause) — [source](https://pub.dev/packages/analyzer/versions/10.0.1). Copyright the Dart project authors. analyzer 10.0.1, _fe_analyzer_shared 93.0.0, collection 1.19.1, path 1.9.1, pub_semver 2.2.0, source_span 1.10.1 and term_glyph 1.2.2, the packages the engine's source map lists next to dart_style.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/dart-formatter dart-formatter
cd dart-formatter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/dart-formatter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadEngine, formatDart } from '@fodt/dart-formatter';

// Node 22 or newer: the engine needs WebAssembly garbage collection.
const require = createRequire(import.meta.url);
loadEngine(readFileSync(require.resolve('@wasm-fmt/dart_fmt/wasm')));

formatDart("void main() { print('hi'); }", { lineWidth: 80 });
// { output: "void main() {\n  print('hi');\n}\n", inputBytes: 31, outputBytes: 33 }
```

`loadEngine(wasm)` hands the dart_fmt WebAssembly bytes (or a compiled module) to the engine once; calling it again does nothing. In a browser or Node without WebAssembly garbage collection it throws `DartFormatterError` with the message This browser cannot run the Dart formatter (it needs WebAssembly garbage collection). `formatDart(source, options?)` returns `{ output, inputBytes, outputBytes }`, or `null` for blank or whitespace-only source without calling the engine. The only option is `lineWidth`, a whole number from 1 to 1000 (the default is 80). It throws `DartFormatterError` for every failure and never returns partly formatted code; the error carries `line` and `column` (both 1-based, the column counted in characters) when the formatter located a syntax error.

## Dependencies

- `@wasm-fmt/dart_fmt` 0.4.0

## Tests

```sh
npm test
```

The oracle is dart_style's own published test data at v3.1.4 (test/tall): every case of top_level/import.unit reproduces at its declared 40 columns and every case of regression/0000/0084.unit, a file with no width header and so run at dart_style's default of 80, reproduces at 80. The version of dart_style compiled into the engine is not recorded by the wrapper; the engine's own source map names dart_style 3.1.4, and the fixtures at that tag reproduce. The same source map names the other Dart packages compiled in, and their licence notices are published with the engine's. Error positions in the tests are counted by hand from each test's input. The test that provokes a stack overflow loads its own copy of the package and runs last.

## Licence

MIT. See [LICENSE](./LICENSE).
