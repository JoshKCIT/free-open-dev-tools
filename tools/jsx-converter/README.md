# HTML & SVG to JSX

Convert markup to JSX or a typed React component.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Parses pasted HTML or SVG markup into a syntax tree and writes JSX source text, with attribute and element names taken from React DOM's own attribute table and the HTML parser's own SVG tag-name table. Can wrap the result in a plain function component or a typed one. Nothing pasted is ever run: inline event handlers and script elements are dropped with a warning instead of being carried into the output.

## Supported

- class, for, style and SVG-only attribute names rewritten to the React DOM prop names React itself uses
- SVG element names such as lineargradient rewritten to the camelCase the HTML Living Standard's own parser table gives, such as linearGradient
- An inline style attribute rewritten to a style object with camel-cased properties, vendor-prefixed properties handled per React's own convention, and custom properties kept as quoted keys
- Three output modes: bare JSX, a function component, or a typed function component with props typed from the root element
- An option to rewrite value and checked on form controls to defaultValue and defaultChecked
- Comments rewritten to JSX comments, text braces and angle brackets escaped, and multiple root elements wrapped in a fragment

## Limits

- Inline event handler attributes and script elements are dropped with a warning; their text is never turned into code
- Conditional comments and templates are written out as plain markup, with no special handling
- Custom elements and unrecognised attribute names are kept exactly as written, since no published table names them
- CSS values inside a style attribute are copied into the style object as written, never validated

## Ambiguous cases, and what this does about them

- A component name that is not a valid JavaScript identifier falls back to "Markup" with a warning, rather than refusing to convert

## Defined by

- [HTML Living Standard — Parsing](https://html.spec.whatwg.org/multipage/parsing.html)
- [SVG 2](https://www.w3.org/TR/SVG2/)
- [react.dev — Common components (e.g. div)](https://react.dev/reference/react-dom/components/common)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **React possibleStandardNames (attribute names)** (MIT) — [source](https://github.com/facebook/react/blob/d083ec1da1e5252abd3ddfdde6dfbc09701a2c51/packages/react-dom-bindings/src/shared/possibleStandardNames.js). "possibleStandardNames.js", (c) Meta Platforms, Inc. and affiliates, from the React repository, licensed under the MIT License.
- **HTML Living Standard SVG tag-name adjustment table** (CC-BY-4.0) — [source](https://html.spec.whatwg.org/multipage/parsing.html). SVG tag-name adjustment table from the HTML Living Standard, (c) WHATWG, licensed under CC BY 4.0.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/jsx-converter jsx-converter
cd jsx-converter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/jsx-converter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { convertToJsx } from '@fodt/jsx-converter';

convertToJsx('<label for="x" class="y">A</label>');
// { output: '<label htmlFor="x" className="y">A</label>\n', warnings: [] }
```

`convertToJsx(markup, options)` returns `{ output, warnings }`. `options.output` is `'jsx'` (bare JSX, the default), `'component'` (wrapped in a named function component) or `'typescript'` (the same, typed with `ComponentProps<'<root tag>'>` on the root element; a fragment root takes no props and no type import is added). `options.componentName` defaults to `'Markup'`. `options.defaultValues` (default `true`) rewrites `value`/`checked` on form controls to `defaultValue`/`defaultChecked`. Throws `JsxConverterError` only when the markup cannot be parsed at all.

## Dependencies

- `htmlparser2` 12.0.0

## Tests

```sh
npm test
```

The React attribute table (`src/react-attribute-names.ts`) and the SVG tag-name table (`src/svg-tag-names.ts`) are each checked, pair by pair, against their own vendored upstream fixture under `test/fixtures/`, read by a line-pattern parser rather than imported. Every output mode is parsed back with the Babel parser (JSX/TSX plugins) and the typed component is additionally compiled with the TypeScript compiler in strict mode with `@types/react` installed, both devDependency-only oracles never bundled at runtime.

## Licence

MIT. See [LICENSE](./LICENSE).
