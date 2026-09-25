# JavaScript Formatter & Minifier

Beautify or minify JavaScript and TypeScript without running it.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Beautifies JavaScript or TypeScript with Prettier's own parser, or minifies it with terser (TypeScript has its types stripped by the TypeScript compiler first, then the result is minified as JavaScript). The pasted code is only parsed and rewritten; it is never executed, in either mode.

## Supported

- ECMA-262 (ECMAScript 2025) syntax: classes, private fields, async and generator functions, destructuring, optional chaining, regular expressions, template literals and JSX
- TypeScript generics, interfaces, enums and satisfies expressions
- Beautify with Prettier's own opinions and a few chosen options (indent, semicolons, quote style)
- Minify JavaScript with terser; minify TypeScript by stripping types first, then minifying the result as JavaScript
- A syntax error reported with its line and column from either library
- Beautifying and minifying never run the pasted code

## Limits

- Formatting follows Prettier's own opinions and only a handful of options; it does not aim to reproduce every Prettier setting
- TypeScript input is always minified down to JavaScript output, never TypeScript
- Terser folds constant expressions and removes dead code by static analysis at build time; it never runs the pasted code to do so
- Flow syntax is not supported
- The TypeScript-specific Prettier plugin is not used, to keep this page's chunk smaller; TypeScript is beautified with Prettier's babel-ts parser instead

## Ambiguous cases, and what this does about them

- TypeScript generics and JSX both use angle brackets; Prettier's babel-ts parser resolves the ambiguity the same way the TypeScript compiler itself does, by file extension convention (.tsx allows JSX), so this tool always parses TypeScript input in a mode that accepts JSX

## Defined by

- [ECMAScript 2025 Language Specification (ECMA-262)](https://tc39.es/ecma262/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/js-formatter js-formatter
cd js-formatter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/js-formatter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { formatJs } from '@fodt/js-formatter';

await formatJs('const a={b:1}', { language: 'javascript', mode: 'beautify' });
// { output: 'const a = { b: 1 };\n', inputBytes: 13, outputBytes: 21, warnings: [] }
```

`formatJs(source, options)` is async and returns `{ output, inputBytes, outputBytes, warnings }`, or throws `JsFormatterError` with `line`/`column` (1-based; terser's own 0-based columns are converted) for a syntax error. `language` is `'javascript'` (default) or `'typescript'`; `mode` is `'beautify'` (default) or `'minify'`. Beautify options: `indent`, `semicolons` (default `true`), `singleQuote` (default `false`). Minify options: `module` (default `true`), `mangle` (default `true`), `compress` (default `true`), `keepLicenceComments` (default `true`).

## Dependencies

- `prettier` 3.9.9
- `terser` 5.51.2
- `typescript` ^5.9.3

## Tests

```sh
npm test
```

Beautified output is parsed with @babel/parser (jsx and typescript plugins) and compared against the parsed input, position and comment data stripped, to prove formatting never changes the syntax tree. A required test proves beautifying and minifying never run the pasted code in any of the four language/mode combinations, using the shared never-evaluates.ts check. Terser is run with every unsafe* option explicitly off, asserted by a test that inspects the option object this package builds.

## Licence

MIT. See [LICENSE](./LICENSE).
