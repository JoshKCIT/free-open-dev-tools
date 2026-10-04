# SCSS & Less Compiler

Compile SCSS, indented Sass or Less to CSS in the browser, with errors shown at their line and column.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Compiles SCSS, the indented Sass syntax or Less to CSS with the official Sass compiler and the Less compiler, each running in a background worker inside your browser so a stylesheet that never finishes can be stopped. Imports of other files or addresses are refused, so nothing is fetched, read or sent: the stylesheet and the compiled CSS stay in this page.

## Supported

- SCSS, the indented Sass syntax and Less, each compiled by its own official compiler
- Dart Sass 1.103.1 language features, including the built-in modules such as sass:math and sass:color, and Less 4.9.1 with its default math mode, where a division is calculated only inside parentheses
- Expanded or compressed CSS output, shown with its size and ready to copy or download as compiled.css
- Warnings from Sass @warn and @debug, shown separately from the CSS
- Syntax errors shown with their line and column, counted from 1 as a reader counts them

## Limits

- Sources up to 256 KiB (counted in UTF-8 bytes) are accepted, and compiled CSS over 2 MiB is refused.
- Imports of other files and addresses are refused: Sass @use, @forward, @import and meta.load-css, Less @import, and plain CSS @import rules in the output.
- Less @plugin, inline JavaScript, data-uri with a file and image-size are refused.
- Compiling stops after 8 seconds with a message, because a short stylesheet can make the compiler use more and more memory until it is stopped; Cancel stops it at once.
- Only the built-in Sass modules are available, such as sass:math and sass:color.
- At most 20 Sass warnings are shown, each cut at 200 characters.

## Ambiguous cases, and what this does about them

- In Less, a division is calculated only inside parentheses (its default since version 4): 10px / 2 stays as written and (10px / 2) gives 5px
- A plain CSS @import is not an error in either compiler; it passes through to the output, and this page refuses it there, so the refusal names the position in the compiled CSS when the source has none

## Defined by

- [Sass documentation](https://sass-lang.com/documentation/)
- [Less documentation](https://lesscss.org/features/)
- [CSS Cascading and Inheritance Level 5 (the @import rule)](https://www.w3.org/TR/css-cascade-5/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/sass-less-compiler sass-less-compiler
cd sass-less-compiler
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/sass-less-compiler
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { compileStylesheet } from '@fodt/sass-less-compiler';

const { css, warnings, engine } = await compileStylesheet('$c: #336699;\n.a { color: $c; }', {
  language: 'scss',
  style: 'expanded',
});
// css is '.a {\n  color: #336699;\n}', engine is 'Sass 1.103.1'.
// A source that names another file or address throws a StylesheetError with kind 'import', a line and a column.
```

`compileStylesheet(source, { language, style })` takes `language` `scss`, `sass` (the indented syntax) or `less` and `style` `expanded` or `compressed`, and resolves with `{ css, warnings, engine }`. A problem throws `StylesheetError` with a plain `message`, a `kind` of `syntax`, `import` or `limit`, and a `line` and `column` counted from 1 when the compiler gave a position. Sass runs with an importer that refuses every address it is asked about; Less is built from its core factory with one file manager and one plugin loader that refuse everything, and with inline JavaScript off. A plain CSS `@import` that either compiler passes through is found by `findCssImport`, a one-pass scan that skips comments and strings, and refused the same way. `checkSource` refuses a source over 256 KiB (UTF-8 bytes) and `isBlankSource` says whether a source holds anything. Compiled CSS over 2 MiB, and Sass warnings beyond 20, are cut or refused with a plain message. Sass is asked not to add a byte order mark or an @charset rule to its output. Messages from the compilers are cut to their first line with anything they quote from the stylesheet (quoted text, variable and mixin names) replaced by an ellipsis, and the position is added in parentheses. The package reads no file, makes no request and prints nothing.

## Dependencies

- `sass` 1.103.1
- `less` 4.9.1

## Tests

```sh
npm test
```

Expected values come from the two projects' own published test cases, each quoted with its upstream path and commit in test/fixtures/published-cases.ts: the Sass project's sass-spec (MIT) for loops, conditionals, variables and extend, in SCSS and in the indented syntax, and the Less project's test data (Apache-2.0) under packages/test-data/tests-unit. Larger runs of the same two suites (131 import-free Sass-spec pairs, 57 of 58 import-free Less pairs) were made once outside the repository; the one Less pair that differs depends on functions the Less project's own test runner registers. The Less default math rule is pinned with the pair 10px / 2 and (10px / 2). Positions are checked against literal sources, including a source with an astral character before the error and one with Windows line ends. test/fixtures/README.md names both repositories, their licences, the commits and the download date.

## Licence

MIT. See [LICENSE](./LICENSE).
