# CSS Filter Generator

Compose filter functions with a live preview.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Chains up to four filter functions (blur, brightness, contrast, a drop shadow, grayscale, hue rotation, invert, opacity, saturate, sepia) in the order you choose, applying them to a sample photo-like subject and showing the live result next to the exact filter CSS. Built for a faded-photo look, a duotone effect, or a floating drop shadow.

## Supported

- Up to four filter functions applied in the order they are listed, per the Filter Effects Level 1 property grammar
- Every amount clamped to the range the specification allows for that function, with a warning naming the slot
- A drop shadow with its own draggable offset, blur (standard deviation) and colour, with no spread
- A fixed decorative background so every filter has real colour and contrast to act on

## Limits

- Filters are applied by the visitor's own browser and GPU, so results can differ slightly between browsers, especially for a large blur radius
- Applying any filter function makes the element a containing block for fixed-position descendants and creates a stacking context (Filter Effects Module Level 1, section 2)
- SVG reference filters (the in-page-fragment form of the filter property) are not offered; only the ten closed filter functions this specification defines
- At most four filter functions are offered, applied in the fixed order this tool lists them in
- The starting blur amount is kept deliberately small: a blur re-rasterises the whole subject rather than drawing a separate layer, so it is not pixel-snapped the way a solid fill is, and a stronger starting value can differ visibly, pixel for pixel, between browsers even though the CSS itself is identical

## Ambiguous cases, and what this does about them

- hue-rotate has no maximum the specification enforces (it explicitly says implementations must not normalise beyond 360deg); this tool still bounds it to a wide but finite practical range for a usable slider

## Defined by

- [Filter Effects Module Level 1 — Filter Functions and the filter property](https://www.w3.org/TR/filter-effects-1/#supported-filter-functions)
- [CSS Color Module Level 4 — RGB Hexadecimal Notations](https://www.w3.org/TR/css-color-4/#hex-notation)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/css-filter css-filter
cd css-filter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/css-filter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateFilter } from '@fodt/css-filter';

generateFilter({
  functions: [
    { name: 'blur', amount: 4 },
    { name: 'grayscale', amount: 50 },
  ],
});
// { css: '.photo {\n  width: 240px;\n  height: 160px;\n  ...\n  filter: blur(4px) grayscale(50%);\n}', value: 'blur(4px) grayscale(50%)', ... }
```

generateFilter({ functions, width, height }) takes one to four filter layers in order -- either { name, amount } for the nine scalar functions or { name: 'drop-shadow', x, y, blur, color } -- and an optional preview box width and height (default 240x160, clamped to 40-480px). Returns { css, tree, value, warnings }: css is one .photo rule (and a .photo-label rule) built through the canonical stylesheetText writer; value is the filter value alone; warnings names any slot an amount was clamped in. Throws FilterError only if the canonical safety writer itself refuses the finished CSS, which validated input never reaches.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every function's own amount range and default is checked against the Filter Effects Level 1 specification's own definition of that function. Every declaration is checked against the css-tree 3.2.1 lexer. Hostile field values are checked against the shared HOSTILE_VALUES battery.

## Licence

MIT. See [LICENSE](./LICENSE).
