# CSS Formatter & Minifier

Beautify or minify CSS.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Beautifies CSS, SCSS or Less with Prettier's own printer, or minifies plain CSS with csso. Beautify first parses the input with the chosen syntax's own Prettier parser, so malformed CSS, SCSS or Less is refused with that parser's own line and column.

## Supported

- CSS Syntax Module Level 3: rules, selectors, declarations, strings, escapes and comments
- SCSS, the brace syntax used in .scss files: nesting and the & parent selector, variables, @mixin/@include, @use, placeholder selectors and @extend, @if/@else, @each and other control directives
- Less: variables, mixin definitions and calls, guards (when (...)), operations on values, &:extend
- Beautify with a chosen indent (2 spaces, 4 spaces, or a tab), for any of the three syntaxes
- Minify plain CSS with csso, with structural restructuring on or off
- Licence comments (/*! ... */) kept on request when minifying; other comments removed
- Malformed CSS, SCSS or Less refused with its line and column

## Limits

- SCSS and Less are beautified only; minifying needs plain CSS, so compile the SCSS or Less to CSS first, then minify the result
- SCSS and Less are formatted, not compiled or type-checked: an undefined variable, mixin or import is not reported
- The indented Sass syntax (.sass files, no braces) is not supported, only SCSS's brace syntax
- Restructuring (on by default when minifying) may merge and reorder rules where csso judges it safe; it can be switched off
- Comments other than a leading /*! licence comment are removed when minifying
- A vendor hack that is not valid CSS is refused rather than passed through

## Ambiguous cases, and what this does about them

- csso's value compression (e.g. rewriting a colour keyword to its shorter hex form) runs even with restructure off, since restructure only controls merging and reordering rules and declarations, not value shortening

## Defined by

- [CSS Syntax Module Level 3](https://www.w3.org/TR/css-syntax-3/)
- [Sass documentation: syntax](https://sass-lang.com/documentation/syntax/)
- [Less language features](https://lesscss.org/features/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/css-formatter css-formatter
cd css-formatter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/css-formatter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { formatCss } from '@fodt/css-formatter';

await formatCss('a{color:red}', { mode: 'beautify' });
// { output: 'a {\n  color: red;\n}\n', inputBytes: 12, outputBytes: 16 }
```

`formatCss(source, options)` is async and returns `{ output, inputBytes, outputBytes }`, or throws `CssFormatterError` with `line`/`column` (1-based) for malformed input. `mode` is `'beautify'` (default) or `'minify'`. `syntax` is `'css'` (default), `'scss'` or `'less'`; beautify accepts all three, minify accepts only `'css'` and throws a plain message (no line/column) for the other two before any parsing happens. Beautify options: `indent` (`2` default, `4`, or `'tab'`). Minify options: `restructure` (default `true`) and `keepLicenceComments` (default `true`, keeps only `/*! ... */` comments).

## Dependencies

- `prettier` 3.9.9
- `csso` 5.0.5

## Tests

```sh
npm test
```

Beautified and minified (with restructuring off) output is parsed with css-tree and compared against the parsed input, ignoring whitespace, to prove formatting never changes the rules, selectors or declarations. The csso README's own documented minification example is checked literally. postcss is used as a second oracle for minified output. SCSS and Less samples are taken from the Sass and Less documentation, cited by URL; a postcss structure oracle (node-for-node, whitespace collapsed) proves formatting never changes the parsed rules for every sample plain postcss can parse; samples it cannot parse (comments, Less mixin calls) are instead proven idempotent with an expected output recorded after reading it.

## Licence

MIT. See [LICENSE](./LICENSE).
