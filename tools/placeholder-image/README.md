# Placeholder Image Generator

Generate placeholder SVG or PNG images at any size.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Draws a placeholder rectangle at any size you choose, as an SVG string or a PNG image, with a label (the size by default, or your own text), a background and foreground colour, and an optional cross or grid pattern. Nothing is decoded or fetched: the SVG is built as text and the PNG is drawn with the browser's own canvas.

## Supported

- SVG output as a data URI or raw markup, at any size up to 10,000 pixels on a side
- PNG output drawn with the browser's own canvas, up to this browser's own measured encoding limit
- A custom label (defaulting to the image size), background colour and foreground colour
- A cross or grid pattern drawn with plain line elements
- Every hostile label is shown only as escaped text, never as markup

## Limits

- SVG sizes are limited to 10,000 pixels on a side; PNG sizes are limited to this browser's own measured encoding ceiling, since a very large canvas can be slow or fail to encode at all.
- The label is plain text only, limited to 80 characters; it cannot include formatting.
- Colours are accepted only as #rgb or #rrggbb hex values.
- PNG text is drawn with the visitor's own installed fonts, so it can look different between systems and browsers.

## Ambiguous cases, and what this does about them

- A width, height or font size that is zero, negative, not a number, or above its own maximum is clamped to the nearest valid value with a warning naming the field, rather than rejected outright, so a visitor typing while a field is briefly empty or invalid never loses their other choices.
- MAX_PNG_SIDE is a measured value (the largest square side every tested browser project encodes to PNG in comfortably under one second), not a guessed constant; a PNG request above it is refused with a plain reason while the SVG output for the same request is unaffected.

## Defined by

- [W3C SVG 2 -- Scalable Vector Graphics](https://www.w3.org/TR/SVG2/)
- [W3C Extensible Markup Language (XML) 1.0 -- Character Data and Markup](https://www.w3.org/TR/xml/#syntax)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/placeholder-image placeholder-image
cd placeholder-image
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/placeholder-image
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generatePlaceholder } from '@fodt/placeholder-image';

const result = generatePlaceholder({ width: 640, height: 360, label: 'Hero image' });
// result.svg, result.dataUri; drawing the same numbers to a PNG is left to the caller's own canvas.
```

This package builds an SVG string and returns plain values only; it draws no PNG itself and names no browser-only type anywhere, not even in a comment, so it is built and tested in plain Node by a release gate that has no canvas available. The page this package feeds draws the PNG itself with the same clamped numbers, using an OffscreenCanvas this package never imports.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every clamping, escaping and colour-normalising rule is proven in plain Node against hand-computed expectations; SVG well-formedness is checked by parsing the generated markup with the installed @xmldom/xmldom (devDependency-only) and asserting no parser error and no element outside the small set this tool ever emits. The real PNG encode -- and MAX_PNG_SIDE's own measured per-engine timing -- is proven only by the dedicated Playwright spec, since drawing a canvas is a browser concern this package's own tests never touch.

## Licence

MIT. See [LICENSE](./LICENSE).
