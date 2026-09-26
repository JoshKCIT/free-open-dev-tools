# CSS Unit Converter

Convert between px, rem, em, pt, pc, in, cm, mm, vw, vh and percent.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts a CSS length between eleven units by routing every value through px, the canonical unit CSS Values and Units Level 4 defines. The absolute units (px, in, cm, mm, pt, pc) convert by their fixed ratios. The context-dependent units (rem, em, vw, vh, percent) have no real page to measure against, so this tool asks for the root font size, the parent font size, the viewport size and what a percentage is relative to, and shows every assumption beside the result so it is never hidden.

## Supported

- Converting a length between px, rem, em, pt, pc, in, cm, mm, vw, vh and percent in one pass
- An editable assumed context: root font size (for rem), parent font size (for em and percent-of-font-size), viewport width and height (for vw and vh), and a container width (for percent-of-container-width)
- Out-of-range context values (a font size or viewport at or below zero) clamped to the smallest allowed value with a warning naming the field
- A chosen display precision from 0 to 6 decimal places

## Limits

- em, rem, vw, vh and percent depend on the root font size, parent font size, viewport and reference this tool assumes (16px and a 1440 by 900 viewport unless changed in the browser above), which a real page can differ from
- vw and vh here are the large viewport units CSS Values and Units Level 4 defines; the small and dynamic viewport units (svw/svh, dvw/dvh) are not offered
- Percentages have a different reference value for almost every CSS property that accepts one; this tool only offers the parent font size or a container width as the reference
- Results are shown to the chosen precision and are not the exact binary value a browser keeps internally

## Defined by

- [CSS Values and Units Module Level 4](https://www.w3.org/TR/css-values-4/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/css-unit css-unit
cd css-unit
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/css-unit
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { convertLength, UNITS } from '@fodt/css-unit';

convertLength(1, 'in', {}).results; // every unit's value for 1 inch
convertLength(1.5, 'rem', { rootFontSize: 16 }).results.find((r) => r.unit === 'px'); // { unit: 'px', value: 24 }
```

`convertLength` always returns all eleven units in `UNITS` order, plus the exact context it used (after clamping) and any warnings from that clamping. Every absolute-unit ratio and every context-dependent formula is applied in double-precision floating point with no rounding until display; the caller chooses how many decimal places to show.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The absolute-unit ratios (1in = 2.54cm = 96px, 1cm = 96px/2.54, 1mm = 1/10th of 1cm, 1pt = 1/72nd of 1in, 1pc = 1/6th of 1in) and the em/rem/vw/vh/percent definitions are quoted directly from CSS Values and Units Level 4 sections 6.1.1, 6.1.2.2, 6.2 and 5.5, fetched this session.

## Licence

MIT. See [LICENSE](./LICENSE).
