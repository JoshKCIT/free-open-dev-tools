# Cubic Bezier Easing Editor

Shape a cubic-bezier easing curve by dragging its handles or picking a preset, and preview the motion.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Shapes a cubic-bezier() easing function. Pick one of the five CSS keywords (linear, ease, ease-in, ease-out, ease-in-out), one of three labelled curves of this page's own that are not CSS keywords, or choose Custom and drag either of the two handles, or move it with the arrow keys or the number boxes. You see the curve, a dot moving along a track with exactly that easing, a table of sampled values and the cubic-bezier() value and declaration to copy.

## Supported

- The five CSS keywords with the control points CSS Easing Functions Level 1 gives them
- Three labelled non-keyword curves (a back-out that overshoots, a back-in that pulls back first and a smooth in-out), with their four numbers shown beside them
- Custom curves from two handles: dragging, arrow keys with Shift for steps of ten, or typing the numbers
- A motion preview whose duration runs from 0.2 to 5 seconds, a picture of the curve and a table of the progress at eleven times from 0 to 1 in steps of 0.1
- The cubic-bezier() value and the transition-timing-function declaration to copy, and the preview CSS to download

## Limits

- Both x values are kept in the range 0 to 1, as the cubic-bezier() function requires; y values may go from -1 to 2.
- The motion preview stops when the visitor's system asks for reduced motion, and the copied CSS carries that rule.
- The handle pad shows progress upward, so its second number is 1 minus the curve's y value; the cubic-bezier() text shows the real values.
- Sampled values are computed to six decimals.
- Numbers are kept to three decimals in the copied value, and the sampled values are computed from exactly those numbers.
- The motion preview is a dot on a fixed 240 pixel track with one easing for the whole move; it does not show steps() or multi-segment easing.

## Ambiguous cases, and what this does about them

- A browser solves the curve with its own tolerance, so a value it reports for a given time can differ from the sampled value here by a tiny amount; the sampled values are the exact solution of the curve
- The pad's y axis runs downward like a screen, so the page maps it to 1 minus y; the curve picture and the copied text use the usual upward y

## Defined by

- [CSS Easing Functions Level 1 (cubic-bezier() and the keyword curves)](https://www.w3.org/TR/css-easing-1/)
- [Web Animations Level 1 (timing and progress)](https://www.w3.org/TR/web-animations-1/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/cubic-bezier cubic-bezier
cd cubic-bezier
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/cubic-bezier
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateEasing } from '@fodt/cubic-bezier';

const ease = generateEasing({ preset: 'ease' });
// ease.value is "cubic-bezier(0.25, 0.1, 0.25, 1)"; ease.declaration is "transition-timing-function: cubic-bezier(0.25, 0.1, 0.25, 1);"
const custom = generateEasing({ preset: 'custom', p1: { x: 0.34, y: 1.56 }, p2: { x: 0.64, y: 1 }, duration: 0.8 });
// custom.table holds the progress at 0, 0.1, ... 1; custom.svg is the picture; custom.css is the preview stylesheet
```

generateEasing({ preset, p1, p2, duration }) takes a preset name ('custom', one of the five keywords or one of three named curves), two control points as { x, y } (read only for 'custom'; an x outside 0 to 1 is held at the nearest end with a warning, a y outside -1 to 2 likewise) and a duration in seconds (clamped to 0.2 to 5). It returns { value, declaration, css, tree, svg, table, points, warnings }. pointFieldToControl and controlToPointField map between a handle pad's { x, y 1 minus y } and the control point; solveProgress(x1, y1, x2, y2, input) returns the progress at an input time between 0 and 1 by Newton steps with a bisection fallback; sampleCurve returns the eleven table rows; curveSvg returns the picture, with a title and a description. A preset name outside the lists is refused with CubicBezierError.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The five keyword control points are written into the tests from CSS Easing Functions Level 1, and the progress at eleven times is compared with an independent solution of the same curve by bisection on the defining polynomials, for the keywords and for 40 curves from a seeded generator; ease at 0.5 is 0.802403. The pad mapping, the clamp of x with its warning, the six-decimal table, the picture's title and description and the preview stylesheet with its reduced-motion rule are checked. In a browser, the table the page prints is compared with the browser's own Web Animations engine for the keywords and ten seeded curves, and a handle is moved by pointer and by arrow keys.

## Licence

MIT. See [LICENSE](./LICENSE).
