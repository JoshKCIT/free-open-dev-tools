# CSS Transform Generator

Compose translate, rotate, scale and skew with a live preview.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Composes translate, rotate, scale and skew in whatever order matters for the effect, with drag handles for the move offset, the skew angles and the rotation origin, showing the live result next to the exact transform CSS and its equivalent matrix. Built for a tilted card, a mirrored element, or seeing exactly why the order of two transform functions changes the result.

## Supported

- Translate, rotate, scale and skew composed in one of four chosen orders, with every function written even at its identity value so the order stays visible
- A move handle, two skew handles and an origin handle, each with paired numeric inputs
- The individual translate, rotate and scale properties, written in the fixed order Level 2 defines, with any skew left in the transform property alone
- The equivalent 2D matrix, computed by multiplying the function matrices in the order written
- A colour box for the previewed element's background, accepting a 3, 4, 6 or 8-digit hex colour

## Limits

- Only 2D functions are offered; perspective and other 3D transform functions are not part of this generator
- A transform never affects layout, so neighbouring elements on the visitor's own page do not move even though the transformed element visually does
- Different browsers can round the reported matrix's own decimal digits slightly differently; this tool rounds to six decimals
- The individual translate, rotate and scale properties need a browser that supports CSS Transforms Module Level 2

## Ambiguous cases, and what this does about them

- Every function is written at its identity value (a zero translate, a zero rotation) rather than omitted, so the chosen order is always visible in the generated CSS even when it makes no visual difference
- Translate, rotate, scale and skew fields are each clamped to a fixed practical range (translate -300 to 300px, rotate -360 to 360deg, scale 0.1 to 4, skew -60 to 60deg) since the specification itself sets no upper bound on any of them

## Defined by

- [CSS Transforms Module Level 1 — the 2D transform functions and their matrices](https://www.w3.org/TR/css-transforms-1/)
- [CSS Transforms Module Level 2 — the individual transform properties](https://www.w3.org/TR/css-transforms-2/)
- [CSS Color Module Level 4 — RGB Hexadecimal Notations](https://www.w3.org/TR/css-color-4/#hex-notation)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/css-transform css-transform
cd css-transform
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/css-transform
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateTransform } from '@fodt/css-transform';

generateTransform({
  translate: { x: 10, y: 20 },
});
// { css: '.box {\n  ...\n  transform: translate(10px, 20px) rotate(0deg) scale(1, 1) skew(0deg, 0deg);\n  ...\n}', matrix: [1, 0, 0, 1, 10, 20], ... }
```

generateTransform({ translate, rotate, scale, skew, origin, order, individual, width, height, background }) takes optional { x, y } translate/scale/skew values, an optional rotate angle in degrees, an optional { x, y } origin in percent, an order key naming one of four fixed presets, an individual flag, an optional preview box width and height (default 120x120, clamped to 40-240px), and an optional background hex colour. Returns { css, tree, value, matrix, warnings }: css is one .box rule (plus a .box-label rule) built through the canonical stylesheetText writer; value is the transform property's own written value; matrix is the equivalent [a, b, c, d, e, f] 2D matrix, computed by composeMatrix in the order the functions are actually applied (the fixed translate/rotate/scale/skew order when individual is set, the chosen order otherwise); warnings names any field a value was clamped or replaced in. composeMatrix(functions) is also exported directly, multiplying an ordered list of transform functions' own matrices in the order given. Throws TransformError only if the canonical safety writer itself refuses the finished CSS, which validated input never reaches.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The composed matrix is checked against CSS Transforms Level 1's own per-function matrix definitions (translate, rotate, scale, skew) and against a hand-worked translate-then-rotate example, then against the fact that reordering the same functions changes the result. The individual-properties path is checked against CSS Transforms Level 2's own fixed translate/rotate/scale/transform application order. Every declaration is checked against the css-tree 3.2.1 lexer. Hostile field values are checked against the shared HOSTILE_VALUES battery.

## Licence

MIT. See [LICENSE](./LICENSE).
