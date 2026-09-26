# CSS Gradient Generator

Build linear, radial and conic gradients with a live preview.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds a linear, radial or conic gradient from two to five colour stops, dragging the centre of a radial or conic gradient or typing its position, showing the live result next to the exact background-image CSS. Built for a hero background, a card accent, a button highlight or a colour wheel swatch.

## Supported

- Linear gradients with an explicit start angle in degrees
- Radial gradients with a circle or ellipse ending shape, one of the four sizing keywords, and a draggable centre
- Conic gradients with a start angle and a draggable centre
- The repeating form of all three gradient types
- Two to five colour stops, each a 3, 4, 6 or 8-digit hex colour placed at its own percentage
- A warning naming any colour stop the CSS Images Level 3 colour stop fix-up rule would move forward, without reordering it in the written CSS

## Limits

- Every colour stop position is written as a percentage; this tool does not offer mixed length and percentage stops or transition hints
- Conic gradients need a browser that supports CSS Images Module Level 4; older browsers show nothing for that gradient type
- Colours are interpolated by the visitor's own browser in its default colour space, so this tool does not offer the newer colour-interpolation-method hints
- Banding on a low-bit-depth display is up to the browser, not something this tool can control
- At most five colour stops are offered; a gradient with more stops is not supported

## Ambiguous cases, and what this does about them

- Radial gradients always write both the ending shape and the ending size keyword explicitly, even though the specification allows either to be omitted
- A colour stop placed before an earlier one in position is written exactly as given, with a warning, rather than reordered -- the pasted CSS relies on a real browser applying its own fix-up rule, which the preview also does

## Defined by

- [CSS Images Module Level 3 — Linear Gradients, Radial Gradients, Repeating Gradients and Color Stop Fixup](https://www.w3.org/TR/css-images-3/#gradients)
- [CSS Images Module Level 4 — Conic Gradients](https://www.w3.org/TR/css-images-4/#conic-gradients)
- [CSS Color Module Level 4 — RGB Hexadecimal Notations](https://www.w3.org/TR/css-color-4/#hex-notation)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/gradient-generator gradient-generator
cd gradient-generator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/gradient-generator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateGradient } from '@fodt/gradient-generator';

generateGradient({
  type: 'linear',
  angle: 180,
  stops: [
    { color: '#ffff00', at: 0 },
    { color: '#0000ff', at: 100 },
  ],
});
// { css: '.box {\n  width: 240px;\n  height: 160px;\n  background-image: linear-gradient(180deg, #ffff00 0%, #0000ff 100%);\n}', value: 'linear-gradient(180deg, #ffff00 0%, #0000ff 100%)', ... }
```

generateGradient({ type, repeating, angle, shape, size, position, stops, width, height }) takes a gradient type ('linear' default, 'radial' or 'conic'), a repeating flag, a start angle in degrees (linear and conic), a radial ending shape and size, a centre position in percent (radial and conic), two to five { color, at } stops, and an optional preview box width and height (default 240x160, clamped to 40-480px). Returns { css, tree, value, warnings }: css is one .box rule built through the canonical stylesheetText writer; value is the gradient function alone; warnings names any field a value was clamped or replaced in, and any colour stop the fix-up rule would move. Throws GradientError only if the canonical safety writer itself refuses the finished CSS, which validated input never reaches.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The CSS Images Level 3 specification's own linear gradient equivalent-forms example (linear-gradient(yellow, blue) equals linear-gradient(180deg, yellow, blue)) is reproduced exactly with hex colours. The colour stop fix-up rule is checked against the specification's own worked examples in section 3.4.3. Every declaration is checked against the css-tree 3.2.1 lexer. Hostile field values are checked against the shared HOSTILE_VALUES battery.

## Licence

MIT. See [LICENSE](./LICENSE).
