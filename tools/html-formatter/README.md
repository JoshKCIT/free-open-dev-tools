# HTML Formatter & Minifier

Beautify or minify HTML without executing it.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Beautifies HTML with Prettier's own HTML printer, or minifies it with html-minifier-terser. Embedded style and script are formatted or minified in place with the same csso and terser this site's CSS and JavaScript formatters use, never with html-minifier-terser's own bundled CSS minifier, so nothing embedded is ever loaded from a file or the network.

## Supported

- The HTML Living Standard's own parsing rules
- Beautify with a chosen indent and whitespace-sensitivity mode
- Minify with collapsed whitespace, boolean attributes shortened, and comments removed on request
- Embedded style minified with csso; embedded script minified with terser, both with terser's own unsafe options off
- pre blocks and inline whitespace keep their meaning in both modes
- Beautifying and minifying never run the pasted code

## Limits

- The 'ignore' whitespace-sensitivity mode can change how the browser renders whitespace; use it only when that is intended
- Template syntaxes other than the ones this minifier already ignores by default are treated as plain text
- Conditional comments are removed along with every other comment when minifying
- A minified embedded script follows terser's own rules and limits
- This tool shows the formatted HTML only as text; it renders no preview of the page itself
- Extremely deeply nested markup (roughly a thousand levels or more of nesting) can exceed the parser's recursion limit and be refused rather than formatted

## Ambiguous cases, and what this does about them

- An embedded style or script block whose language attribute names something other than CSS or JavaScript (for example a templating language) is minified as plain text, since this tool only recognises the two languages it wraps its own formatters around

## Defined by

- [HTML Living Standard](https://html.spec.whatwg.org/multipage/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/html-formatter html-formatter
cd html-formatter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/html-formatter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { formatHtml } from '@fodt/html-formatter';

await formatHtml('<div><p>hi</p></div>', { mode: 'beautify' });
// { output: '<div>\n  <p>hi</p>\n</div>\n', inputBytes: 20, outputBytes: 24, warnings: [] }
```

`formatHtml(source, options)` is async and returns `{ output, inputBytes, outputBytes, warnings }`, or throws `HtmlFormatterError` with `line`/`column` (1-based) for malformed input. `mode` is `'beautify'` (default) or `'minify'`. Beautify options: `indent` (default `2`), `whitespace` (`'css'` default, `'strict'`, or `'ignore'`). Minify options: `removeComments` (default `true`).

## Dependencies

- `prettier` 3.9.9
- `html-minifier-terser` 7.2.0
- `csso` 5.0.5
- `terser` 5.51.2

## Tests

```sh
npm test
```

Beautified and minified output is parsed with parse5 and compared against the parsed input, with element names, attributes and text (whitespace-only text between block elements ignored) checked for equivalence. Prettier's own HTML Whitespace Sensitivity documentation example is checked literally. A required test proves neither mode ever runs pasted script, using the shared never-evaluates.ts check.

## Licence

MIT. See [LICENSE](./LICENSE).
