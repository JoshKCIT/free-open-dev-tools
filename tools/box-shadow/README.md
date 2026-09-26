# CSS Box Shadow Generator

Design layered box shadows with a live preview.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Stacks up to four independent box shadows on a preview box, each with its own offset, blur radius, spread distance, colour, opacity and inset flag, showing the live result next to the exact box-shadow CSS. Built for card elevation, layered depth, or a cut-out inset look.

## Supported

- Up to four independently configured shadow layers, each with its own horizontal and vertical offset, blur radius, spread distance, colour, opacity and inset flag
- The CSS Backgrounds and Borders Level 3 box-shadow grammar's own front-to-back painting order, so the first layer listed is the one shown on top
- A colour box for each layer and for the previewed element's background, each accepting a 3, 4, 6 or 8-digit hex colour
- Independent corner rounding on the previewed box

## Limits

- Shadows do not affect layout, so a large shadow can overlap a neighbouring element on the visitor's own page without pushing it aside
- Browsers may render a very large blur radius differently from one another
- Only the offsets, blur radius, spread distance and inset keyword this specification allows are offered; nothing beyond the box-shadow grammar itself
- The preview shows one element on a plain background; a design stacking a shadow over other overlapping shapes is not modelled here

## Ambiguous cases, and what this does about them

- A zero length is written without a unit ('0', not '0px') everywhere this tool's own output uses one, one of the two forms CSS itself allows
- A negative blur radius is clamped to zero rather than refused, since the specification states outright that a negative blur radius is invalid

## Defined by

- [CSS Backgrounds and Borders Module Level 3 — Drop Shadows: the box-shadow property](https://www.w3.org/TR/css-backgrounds-3/#box-shadow)
- [CSS Color Module Level 4 — RGB Hexadecimal Notations](https://www.w3.org/TR/css-color-4/#hex-notation)
- [CSS Syntax Module Level 3 — Escaping and comments](https://www.w3.org/TR/css-syntax-3/#escaping)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/box-shadow box-shadow
cd box-shadow
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/box-shadow
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateBoxShadow } from '@fodt/box-shadow';

generateBoxShadow({
  layers: [
    { x: 0, y: 4, blur: 12, spread: 0, color: '#000000', opacity: 30, inset: false },
  ],
});
// { css: '.box {\n  width: 240px;\n  height: 160px;\n  background-color: #ffffff;\n  border-radius: 12px;\n  box-shadow: 0 4px 12px 0 #0000004d;\n}', value: '0 4px 12px 0 #0000004d', ... }
```

generateBoxShadow({ layers, width, height, radius, background }) takes one to four shadow layers (offset x/y, blur radius, spread distance, a hex colour, opacity 0-100 percent, and an inset flag), an optional preview box width and height (default 240x160, clamped to 40-480px), an optional corner rounding (default 12, clamped to 0-120px) and an optional background hex colour (default #ffffff). Returns { css, tree, value, warnings }: css is one .box rule built through the canonical stylesheetText writer; value is the box-shadow value alone; warnings names any field a value was clamped or replaced in. Throws BoxShadowError only if the canonical safety writer itself refuses the finished CSS, which validated input never reaches.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The CSS Backgrounds and Borders Level 3 specification's own two-layer box-shadow example is rebuilt from its own offsets, blur radius, spread distance, colour and inset flag and compared to the generated value length by length and flag by flag using the css-tree parser (colour text itself is not compared, since this tool always writes a hex colour and the specification's own example uses rgba()). Every declaration is checked against the css-tree 3.2.1 lexer. Hostile field values are checked against the shared HOSTILE_VALUES battery.

## Licence

MIT. See [LICENSE](./LICENSE).
