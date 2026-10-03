# CSS Background Pattern Generator

Build repeating stripes, checks, dots and grids as CSS gradients or an inline SVG, with a live preview.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds a repeating background pattern, such as diagonal stripes, checks, dots, a grid, a zigzag or a cross-hatch, from two colours, a repeat size and a line thickness. Choose CSS gradients, which show in a live preview beside the exact CSS, or an inline SVG, which shows in a frame with no scripts and gives CSS that holds the whole tile. Either copied into an empty page reproduces the preview. Built for a section background, a card texture or a loading placeholder.

## Supported

- Eight patterns: diagonal, horizontal and vertical stripes, checks, dots, a grid, a zigzag and a cross-hatch
- Two colours, a repeat size from 4 to 200 pixels and a line thickness from 1 to 50 percent of the size
- Gradient output: repeating and radial gradients with a background size, written as plain CSS
- Inline SVG output: a small SVG tile as a data address in the CSS, with every special character percent-encoded
- The markup to copy and a download of the CSS

## Limits

- The gradient form is previewed live beside its CSS; the inline SVG form is previewed in a frame with no scripts, holding the same CSS.
- The inline SVG is a small tile built only from the chosen shape, sizes and colours, so nothing outside the page is referenced.
- Size is clamped to 4 to 200 pixels and line thickness to 1 to 50 percent of the size, with a warning.
- Colours are hexadecimal; a colour box holding other text falls back to the default colour with a warning.
- Checks and zigzag have no line thickness, so that field is not read for them.
- The preview box is 240 by 160 pixels and part of the copied CSS; remove its width and height to use the pattern on your own element.

## Ambiguous cases, and what this does about them

- Line thickness is a share of the repeat for stripes and the cross-hatch, the width of a line for the grid and the radius of a dot, so the same figure draws different amounts of colour in different patterns
- The gradient and SVG forms draw the same shapes, but a browser anti-aliases a gradient edge and an SVG edge differently, so pixels along a diagonal can differ slightly
- A diagonal stripe is measured across the stripe, so the repeat of the diagonal patterns is a little shorter along the edge of the tile than the size

## Defined by

- [CSS Images Module Level 3 (linear, radial and repeating gradients)](https://www.w3.org/TR/css-images-3/)
- [Scalable Vector Graphics (SVG) 2 (basic shapes)](https://www.w3.org/TR/SVG2/)
- [CSS Color Module Level 4 (hexadecimal colour notation)](https://www.w3.org/TR/css-color-4/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/css-pattern css-pattern
cd css-pattern
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/css-pattern
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generatePattern } from '@fodt/css-pattern';

const gradient = generatePattern({ pattern: 'stripes-horizontal', output: 'gradient', size: 24, thickness: 25 });
// gradient.css holds .pattern { ... background-image: repeating-linear-gradient(180deg, ...); background-size: 24px 24px; }
const svg = generatePattern({ pattern: 'dots', output: 'svg', size: 24, thickness: 20 });
// svg.css holds the same rule with background-image: url("data:image/svg+xml,..."); svg.html is the frame's content
```

generatePattern({ pattern, output, foreground, background, size, thickness }) takes a pattern name, an output ('gradient' or 'svg'), two hex colours, a repeat size in pixels (clamped to 4 to 200) and a line thickness in percent (clamped to 1 to 50). The gradient form returns { output, css, tree, markup, warnings }, written by the canonical stylesheet writer; the SVG form returns { output, css, html, markup, warnings }, where css is written by the small writer in svg-pattern.ts and html is a style element holding that same css plus the markup. A name outside its list or a colour that is not a 3, 4, 6 or 8 digit hex colour is refused with CssPatternError. patternSvg, svgPatternCss and svgPatternHtml are the three steps of the SVG form.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

For a 24 pixel repeat at 25 percent thickness the gradient stops, the sizes in pixels and the zigzag offsets are worked out by hand and written into the tests as literals, and the SVG tile of horizontal stripes is compared with its exact text and its exact percent-encoded form. The SVG tile of every pattern is checked to hold only the fixed element names and attribute names, and decoding the percent-encoding returns the tile exactly. Hostile field values are fed to every field of both forms. In a browser, the copied CSS of the gradient form is pasted into an empty page and compared with the preview, and the inline SVG form copied into an empty page is compared with the frame by pixels.

## Licence

MIT. See [LICENSE](./LICENSE).
