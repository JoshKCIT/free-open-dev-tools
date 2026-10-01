# Python Formatter

Format Python code with the Ruff formatter, choosing line length, quote style and indent, with syntax errors shown by line and column.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Formats Python source with the Ruff formatter compiled to WebAssembly and run in a background worker in your browser. You choose the line length, the quote style (double, single or kept as written), and whether to indent with spaces or tabs and how wide. A syntax error is reported with its line and column instead of any formatted code. Nothing is sent anywhere.

## Supported

- Python source of any version Ruff 0.15.20 parses, including match statements, type parameters and f-strings
- Line length from 1 to 65535 characters, with Ruff's own default of 88
- Quote style double, single or preserve (each string keeps the quotes it was written with)
- Indent with spaces or tabs, with an indent width from 1 to 255 (Ruff's own default is 4 spaces)
- A magic trailing comma keeps a collection exploded over several lines, as Ruff does by default
- A syntax error is reported with its line and column, and no formatted code is shown

## Limits

- A run that takes longer than 10 seconds is stopped with a message, so a pathological input cannot freeze the page.
- Line and column count characters as you see them; Ruff reports a byte position, which is converted.
- Only the first syntax error is reported.
- Line length must be a whole number from 1 to 65535 and indent width a whole number from 1 to 255, the ranges in Ruff's settings schema; anything else is refused before the formatter runs.
- Formatting follows the style of Ruff 0.15.20, which aims at Black compatibility but is not identical to it everywhere.
- Only the formatter is run: imports are not sorted, unused code is not removed and no lint rule is applied.
- A source nested hundreds of brackets deep is refused with a plain message instead of crashing the page.

## Ambiguous cases, and what this does about them

- Ruff leaves a docstring's own quotes alone only when changing them would change the text, so quote style does not rewrite every string
- A string that already contains the other kind of quote keeps its quotes under every quote style, because swapping them would need escapes

## Defined by

- [Ruff formatter documentation](https://docs.astral.sh/ruff/formatter/)
- [Python language reference, lexical analysis](https://docs.python.org/3/reference/lexical_analysis.html)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **Ruff 0.15.20 formatter** (MIT) — [source](https://github.com/astral-sh/ruff/tree/0.15.20/crates/ruff_python_formatter). Copyright (c) 2022 Charles Marsh. The Ruff Python formatter is compiled into the WebAssembly module that @wasm-fmt/ruff_fmt 0.15.20 ships.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/python-formatter python-formatter
cd python-formatter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/python-formatter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadEngine, formatPython } from '@fodt/python-formatter';

const require = createRequire(import.meta.url);
loadEngine(readFileSync(require.resolve('@wasm-fmt/ruff_fmt/wasm')));

formatPython("x = 'a'\n", { quoteStyle: 'double' });
// { output: 'x = "a"\n', inputBytes: 8, outputBytes: 8 }
```

`loadEngine(wasm)` hands the Ruff WebAssembly bytes (or a compiled module) to the engine once; calling it again does nothing. `formatPython(source, options?)` returns `{ output, inputBytes, outputBytes }`, or `null` for blank or whitespace-only source without calling the engine. The options are `lineLength` (88), `quoteStyle` ('double', 'single' or 'preserve'), `indentStyle` ('space' or 'tab') and `indentWidth` (4). It throws `PythonFormatterError` for every failure, never returning partly formatted code; the error carries `line` and `column` (both 1-based, the column counted in characters) when Ruff located a syntax error. `positionFromByteOffset(source, byteOffset)` is the conversion it uses.

## Dependencies

- `@wasm-fmt/ruff_fmt` 0.15.20

## Tests

```sh
npm test
```

The oracle is Ruff's own published formatter test data at tag 0.15.20 (crates/ruff_python_formatter): the quote_style fixture is formatted with each of its three option sets and compared byte for byte with the outputs of its snapshot. The vendored fixtures keep Ruff's licence and a record of where they came from. Error positions in the tests are counted by hand from each test's input.

## Licence

MIT. See [LICENSE](./LICENSE).
