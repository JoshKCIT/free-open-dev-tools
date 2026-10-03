# CSS Shape Generator (Triangles, Ribbons, Speech Bubbles)

Draw triangles, ribbons, speech bubbles and tooltip arrows in pure CSS with a live preview.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Draws a triangle in one of eight directions (with borders or with clip-path), a ribbon with notched ends, a speech bubble or a tooltip with an arrow, in pure CSS. Pick the shape, its size and its colours and see it live next to the exact CSS and the markup to copy. Pasted into an empty page, the copied CSS on the copied markup reproduces the preview. Built for a badge, a callout, a dropdown pointer or a chat bubble.

## Supported

- Triangles in eight directions: up, down, left, right and the four corner directions, each by the border method (a zero-size box with coloured and transparent borders) or by the clip-path method (a polygon cut from a coloured box)
- A ribbon: a bar with text and a notched end on each side
- A speech bubble with a tail on the bottom left, bottom right, left or right
- A tooltip with an arrow on the top, bottom, left or right
- Width and height, a shape colour (or the text colour on a bubble, ribbon or tooltip), a background colour and, for a bubble, ribbon or tooltip, a line of text
- The CSS, the markup that goes with it and a download of the CSS

## Limits

- The preview and the copied CSS are the same text; the shapes use only class selectors, so tails and ribbon ends are child elements, not pseudo-elements.
- Sizes are clamped to 8 to 400 pixels with a warning; colours are hexadecimal.
- Bubble and tooltip text is at most 200 characters and appears only in the markup, never in the CSS.
- Control characters and text direction characters are removed from the text with a warning, and the markup shows the rest escaped.
- The preview area has a fixed size, so a large shape is cut off in the preview; the copied CSS is not affected.
- A bubble tail is a fixed 16 pixels and a tooltip arrow a fixed 10 pixels; the shapes have no outline, shadow or rounded tail.
- The clip-path method needs a browser that supports CSS Masking; the border method works in every browser.

## Ambiguous cases, and what this does about them

- The border method draws a triangle of exactly the width and height given by sizing its borders; for the sideways triangles the width is the length of the coloured border and the height is the base
- The shape colour of a bubble, ribbon or tooltip is the colour of its text, and the background colour fills the shape and its tail; a triangle uses only the shape colour
- A bubble and a tooltip carry a fixed margin so their tail or arrow is not cut off inside the preview; the margin is part of the copied CSS and can be removed

## Defined by

- [CSS Backgrounds and Borders Module Level 3 (border widths, styles and the way borders meet at a corner)](https://www.w3.org/TR/css-backgrounds-3/)
- [CSS Masking Module Level 1 (clip-path and basic shapes)](https://www.w3.org/TR/css-masking-1/)
- [CSS Color Module Level 4 (hexadecimal colour notation)](https://www.w3.org/TR/css-color-4/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/css-shapes css-shapes
cd css-shapes
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/css-shapes
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateShape } from '@fodt/css-shapes';

const { css, markup } = generateShape({
  shape: 'triangle',
  direction: 'up',
  method: 'border',
  width: 100,
  height: 100,
  colour: '#2563eb',
});
// css holds .triangle { width: 0; height: 0; border-left: 50px solid transparent; border-right: 50px solid transparent; border-bottom: 100px solid #2563eb; }
// markup is <div class="triangle"></div>
```

generateShape({ shape, direction, method, tail, width, height, colour, background, text }) takes a shape ('triangle', 'ribbon', 'bubble' or 'tooltip'), a triangle direction and method, a tail or arrow side, a width and height in pixels (clamped to 8 to 400), a shape colour, a background colour and a line of text, and returns { css, tree, markup, warnings }. css is written through the canonical stylesheet writer, tree is the element tree the CSS styles, markup is that tree as HTML with the text escaped, and warnings names any value that was clamped. A name outside its closed list, or a colour that is not a 3, 4, 6 or 8 digit hexadecimal colour, is refused with CssShapesError. Only the fields a shape uses are read.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The border widths and the polygon points of all eight triangle directions are worked out by hand from the way two borders meet at a corner (CSS Backgrounds and Borders Level 3) and written into the tests as literals. Every combination of shape, direction, method and tail is run through the canonical safety scan and the tree limits, hostile field values are fed to every field, and the canonical css-safe.ts copy is compared with its source by hash. In a browser, the copied CSS is pasted into an empty page with the copied tree and compared with the preview by computed style and by pixels.

## Licence

MIT. See [LICENSE](./LICENSE).
