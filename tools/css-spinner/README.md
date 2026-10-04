# CSS Loading Spinner Generator

Make pure-CSS loading spinners in a chosen size, colour and speed that stop for reduced motion.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Makes a pure-CSS loading spinner: a ring, a dual ring, bouncing dots, stretching bars, a pulse or a ripple, in the size, colour and speed you choose. It shows the spinner moving in a live preview next to the exact CSS and the markup to copy. The CSS carries a prefers-reduced-motion rule, so the spinner stops moving for visitors who ask their system for less motion. Built for a button, a card or a page that is waiting for data.

## Supported

- Six kinds: ring, dual ring, dots, bars, pulse and ripple
- A size from 16 to 256 pixels, a colour and the time of one turn or one beat from 0.2 to 5 seconds
- A live preview that moves, and stops moving when the visitor's system asks for reduced motion
- Keyframes and the animation written as separate properties, with a numbered delay on each dot, bar and ripple
- A prefers-reduced-motion rule that sets animation to none on every animated class
- The markup to copy, with role status and a label so screen readers announce it, and a download of the CSS

## Limits

- Spinners stop moving when the visitor's system asks for reduced motion; the copied CSS carries that rule.
- The preview and the copied CSS are the same text; size is clamped to 16 to 256 pixels and one turn to 0.2 to 5 seconds, with a warning; a pulse is held to at least 0.4 seconds and a ripple to at least 0.7, so neither flashes more than three times a second.
- Add role="status" and a label to the spinner element in your page so screen readers announce it; the copied markup does.
- Colours are hexadecimal; the track of a ring is the same colour at 20 percent opacity.
- Dots, bars and ripples are child elements with numbered classes, not pseudo-elements, so the copied markup must include them.
- A spinner shown for reduced motion is a still picture of the spinner, not a different one.

## Ambiguous cases, and what this does about them

- A turn means one full rotation for a ring and one full beat for the other kinds
- The delay between dots, bars and ripples is a fixed share of that time, so a slower spinner also has longer delays
- Under reduced motion a pulse is a filled circle and a ripple is a single ring, because their moving parts are drawn on top of each other

## Defined by

- [CSS Animations Module Level 1 (keyframes and the animation properties)](https://www.w3.org/TR/css-animations-1/)
- [Media Queries Level 5 (the prefers-reduced-motion feature)](https://www.w3.org/TR/mediaqueries-5/)
- [CSS Color Module Level 4 (hexadecimal colour notation)](https://www.w3.org/TR/css-color-4/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/css-spinner css-spinner
cd css-spinner
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/css-spinner
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateSpinner } from '@fodt/css-spinner';

const { css, markup } = generateSpinner({ type: 'ring', size: 48, colour: '#1d4ed8', speed: 1 });
// css holds .spinner { ... animation-name: spin; animation-duration: 1s; ... }, @keyframes spin { ... } and
// @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
// markup is <div class="spinner" role="status" aria-label="Loading"></div>
```

generateSpinner({ type, size, colour, speed }) takes a kind ('ring', 'dual-ring', 'dots', 'bars', 'pulse' or 'ripple'), a size in pixels (clamped to 16 to 256), a hex colour and the seconds for one turn (clamped to 0.2 to 5), and returns { css, tree, markup, warnings }. css is written through the canonical stylesheet writer, with keyframes and the exact reduced-motion rule; tree is the element tree the CSS styles; markup is that tree as HTML with role status and an aria-label on the first element. A kind outside the list, or a colour that is not a 3, 4, 6 or 8 digit hex colour, is refused with CssSpinnerError.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

For a ring of size 48 and speed 1 the border width, the track colour at 20 percent opacity and the animation properties are worked out by hand and written into the tests as literals; the delays of the dots, bars and ripples are the same kind of hand arithmetic. Every kind is run through the canonical safety scan, must carry the exact reduced-motion prelude and must stop every animated class under it. Kind names are looked up safely for __proto__, constructor and toString. In a browser, the copied CSS is pasted into an empty page with the copied tree and compared with the preview by computed style, keyframes and pixels, and the preview is checked to stop moving under emulated reduced motion.

## Licence

MIT. See [LICENSE](./LICENSE).
