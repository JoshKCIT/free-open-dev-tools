# CSS Text Shadow Generator

Design layered text shadows with a live preview.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Stacks up to four independent text shadows on the visitor's own sample text, each with its own offset, blur radius, colour and opacity, showing the live result next to the exact text-shadow CSS. Built for a soft glow, a hard drop shadow, or an outline built from several offset shadows.

## Supported

- Up to four independently configured shadow layers on the visitor's own sample text, each with its own horizontal and vertical offset, blur radius, colour and opacity
- The CSS Text Decoration Level 3 text-shadow grammar's own front-to-back painting order, so the first layer listed is the one shown on top
- The closed set of generic font families CSS Fonts Level 4 defines that every browser must provide: sans-serif, serif, monospace and system UI
- A colour box for the sample text, each shadow layer and the previewed background, each accepting a 3, 4, 6 or 8-digit hex colour

## Limits

- The visitor's own browser picks the actual font behind a generic family, so the same shadow can look different across systems
- Browsers may render a very large blur radius differently from one another
- The sample text is a preview only: it is drawn as plain text inside the preview and is never part of the generated CSS
- Only the offsets, blur radius and colour the text-shadow grammar allows are offered; spread distance and an inset keyword do not exist for this property

## Ambiguous cases, and what this does about them

- A zero length is written without a unit ('0', not '0px') everywhere this tool's own output uses one, one of the two forms CSS itself allows
- The sample text is capped at 80 characters, with a warning, rather than refused outright, since a preview only needs to show the shadow's shape

## Defined by

- [CSS Text Decoration Module Level 3 — Text Shadows: the text-shadow property](https://www.w3.org/TR/css-text-decor-3/#text-shadow-property)
- [CSS Fonts Module Level 4 — Generic font families](https://www.w3.org/TR/css-fonts-4/#generic-font-families)
- [CSS Color Module Level 4 — RGB Hexadecimal Notations](https://www.w3.org/TR/css-color-4/#hex-notation)
- [CSS Syntax Module Level 3 — Escaping and comments](https://www.w3.org/TR/css-syntax-3/#escaping)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/text-shadow text-shadow
cd text-shadow
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/text-shadow
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateTextShadow } from '@fodt/text-shadow';

generateTextShadow({
  layers: [
    { x: 2, y: 2, blur: 4, color: '#000000', opacity: 50 },
  ],
});
// { css: '.text {\n  display: grid;\n  ...\n  text-shadow: 2px 2px 4px #00000080;\n}', value: '2px 2px 4px #00000080', ... }
```

generateTextShadow({ layers, sample, fontFamily, fontSize, fontWeight, textColor, background, width, height }) takes one to four shadow layers (offset x/y, blur radius, a hex colour and opacity 0-100 percent), an optional sample string (default 'Shadow', trimmed and capped at 80 characters), an optional generic font family ('sans-serif' default, 'serif', 'monospace' or 'system-ui'), an optional font size (default 64, clamped to 12-160px), an optional font weight (400 default, 700 or 900), optional text and background hex colours, and an optional preview box width and height (default 360x160, clamped to 120-720px by 40-400px). Returns { css, tree, value, warnings }: css is one .text rule built through the canonical stylesheetText writer; value is the text-shadow value alone; the sample text lives only in tree, never in css; warnings names any field a value was clamped or replaced in. Throws TextShadowError only if the canonical safety writer itself refuses the finished CSS, which validated input never reaches.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The text-shadow grammar's own lack of a spread distance and inset keyword is checked directly against a layer that is written with only three lengths and a colour. Every declaration is checked against the css-tree 3.2.1 lexer. Hostile field values, including the sample text itself, are checked against the shared HOSTILE_VALUES battery.

## Licence

MIT. See [LICENSE](./LICENSE).
