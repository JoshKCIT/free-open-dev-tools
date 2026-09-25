# CSS Formatter & Minifier

Beautify or minify CSS.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Beautifies CSS with Prettier's own CSS printer, or minifies it with csso. Both modes first parse the input with Prettier's CSS parser, so malformed CSS is refused the same way whichever mode is chosen, with the line and column of the problem.

## Supported

- CSS Syntax Module Level 3: rules, selectors, declarations, strings, escapes and comments
- Beautify with a chosen indent (2 spaces, 4 spaces, or a tab)
- Minify with csso, with structural restructuring on or off
- Licence comments (/*! ... */) kept on request when minifying; other comments removed
- Malformed CSS refused with its line and column in both modes

## Limits

- CSS only: SCSS and Less syntax are not understood
- Restructuring (on by default when minifying) may merge and reorder rules where csso judges it safe; it can be switched off
- Comments other than a leading /*! licence comment are removed when minifying
- A vendor hack that is not valid CSS is refused rather than passed through

## Defined by

- [CSS Syntax Module Level 3](https://www.w3.org/TR/css-syntax-3/)

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

`formatCss(source, options)` is async and returns `{ output, inputBytes, outputBytes }`, or throws `CssFormatterError` with `line`/`column` (1-based) for malformed CSS. `mode` is `'beautify'` (default) or `'minify'`. Beautify options: `indent` (`2` default, `4`, or `'tab'`). Minify options: `restructure` (default `true`) and `keepLicenceComments` (default `true`, keeps only `/*! ... */` comments).

## Dependencies

- `prettier` 3.9.9
- `csso` 5.0.5

## Tests

```sh
npm test
```

Beautified and minified (with restructuring off) output is parsed with css-tree and compared against the parsed input, ignoring whitespace, to prove formatting never changes the rules, selectors or declarations. The csso README's own documented minification example is checked literally. postcss is used as a second oracle for minified output.

## Licence

MIT. See [LICENSE](./LICENSE).
