# CSS Clip-path Generator

Draw polygon, circle, ellipse and inset shapes with a live preview.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Draws a polygon by dragging each point, or a circle, ellipse or inset shape by dragging its centre or typing its offsets, showing the clipped result live next to the exact clip-path CSS. Includes six regular-polygon presets (triangle, rhombus, pentagon, hexagon, octagon and a five-point star), every vertex computed from the circle it describes rather than typed by hand.

## Supported

- A polygon of three to ten points, each dragged or typed as a percentage of the element's own box, with an optional even-odd fill rule
- Circle, ellipse and inset basic shapes, each with a draggable centre or typed offsets
- An optional rounded corner on the inset shape, following the border radius shorthand's own syntax
- Six regular-polygon presets (triangle, rhombus, pentagon, hexagon, octagon, five-point star), every vertex placed on the circle it describes by trigonometry, never typed by hand
- A fixed decorative background so the clipped shape stays visible against it

## Limits

- The parts of the element outside the drawn shape stop receiving pointer events, exactly as CSS Masking Module Level 1 says clip-path does
- Every shape's percentages are relative to the element's own box, so the same CSS pasted onto a differently sized element gives a scaled shape
- SVG path and shape references are not offered; only the four basic shape functions are
- Rounding an inset shape's corners follows the border radius shorthand's own syntax, and the amount a browser actually renders may be scaled down by the corner-overlap rule that shorthand defines

## Ambiguous cases, and what this does about them

- A polygon below three points or above ten is clamped to that range rather than refused, since a shape outside it has no well-defined visual meaning
- The five-point star preset's inner radius is derived from the golden ratio (a commonly used pentagram proportion), not from any CSS specification, since no specification defines a star basic shape

## Defined by

- [CSS Masking Module Level 1 — the clip-path property](https://www.w3.org/TR/css-masking-1/)
- [CSS Shapes Module Level 1 — the basic shape functions](https://www.w3.org/TR/css-shapes-1/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/clip-path clip-path
cd clip-path
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/clip-path
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateClipPath } from '@fodt/clip-path';

generateClipPath({
  shape: 'polygon',
  points: [{ x: 50, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
});
// { css: '.box {\n  ...\n  clip-path: polygon(50% 0%, 100% 100%, 0% 100%);\n}', value: 'polygon(50% 0%, 100% 100%, 0% 100%)', ... }
```

generateClipPath({ shape, points, evenodd, radius, center, radiusX, radiusY, top, right, bottom, left, round, width, height }) takes a shape name (polygon, circle, ellipse or inset) and that shape's own fields (percent for every offset and radius, px for the inset round radius), plus an optional preview box width and height (default 240x160, clamped to 40-480px). Returns { css, tree, value, warnings }: css is one .box rule built through the canonical stylesheetText writer; value is the clip-path value alone; warnings names any field a value was clamped or replaced in. REGULAR_POLYGON_PRESETS exports the six named presets' own point lists, each computed from a shared circle (centre 50%, radius 50%) rather than typed by hand. Throws ClipPathError only if the canonical safety writer itself refuses the finished CSS, which validated input never reaches.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Polygon, circle, ellipse and inset output are each checked against CSS Shapes Level 1's own basic shape grammar and a hand-worked example. Every regular-polygon preset's own vertices are checked against the circle they are computed from. Every declaration is checked against the css-tree 3.2.1 lexer, with one documented difference: that lexer's own bundled grammar data reuses CSS Images' radial-size type for circle()'s single-radius argument rather than CSS Shapes Level 1's own shape-radius production, so a percentage circle radius (this tool's only form) is reported as unknown by the lexer even though it is valid CSS Shapes syntax. Hostile field values are checked against the shared HOSTILE_VALUES battery.

## Licence

MIT. See [LICENSE](./LICENSE).
