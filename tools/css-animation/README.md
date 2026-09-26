# CSS Animation & Transition

Build keyframe animations and transitions with a live preview.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds a keyframe animation of movement, rotation, scale and opacity over two to four frames, or a hover transition between a resting and a target state, with a chosen duration, easing, repetition, direction and fill mode, showing the result playing live next to the exact CSS. A reduced-motion rule that turns the motion off is included by default.

## Supported

- Two to four keyframes, each with its own horizontal and vertical movement, rotation, scale and opacity, written as one transform declaration and an opacity declaration per keyframe
- A keyframes name validated as an identifier the CSS Animations Level 1 grammar allows, refusing a CSS-wide keyword, none, or anything that is not a valid identifier
- Every animation longhand (name, duration, timing function, delay, iteration count, direction, fill mode, play state), written as longhands rather than the shorthand so a keyframes name can never be misread as a keyword
- A hover transition mode with its own resting and target state (movement, scale, opacity and colour) and the four transition longhands
- Easing as a keyword, a cubic-bezier curve with its horizontal control points kept between 0 and 1, or a stepped curve with a named step position
- A reduced-motion rule (on by default) that turns the animation or transition off for a visitor whose system asks for less motion

## Limits

- A keyframes name is shared by the whole page it is pasted into, so a name already used elsewhere in a visitor's own stylesheet will clash with this one
- Only movement, rotation, scale, opacity and background colour are animated; no other property is offered
- Animation smoothness and timing precision depend on the visitor's own browser and device
- The reduced-motion rule only helps a visitor whose system itself asks for less motion; it cannot detect a preference no operating system reports

## Ambiguous cases, and what this does about them

- A keyframes name that fails validation falls back to the tool's own default name with a warning, rather than being rejected outright
- Two frames sharing the same position are not both kept: the later one is nudged forward with a warning, since two keyframe selectors at the same percentage would silently overwrite each other in a real browser

## Defined by

- [CSS Animations Level 1 — the @keyframes rule, the keyframes name and every animation longhand](https://www.w3.org/TR/css-animations-1/)
- [CSS Transitions Level 1 — the transition longhands](https://www.w3.org/TR/css-transitions-1/)
- [CSS Easing Functions Level 1 — easing keywords, cubic-bezier and steps](https://www.w3.org/TR/css-easing-1/)
- [Media Queries Level 5 — the prefers-reduced-motion feature](https://www.w3.org/TR/mediaqueries-5/)
- [CSS Color Module Level 4 — RGB Hexadecimal Notations](https://www.w3.org/TR/css-color-4/#hex-notation)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/css-animation css-animation
cd css-animation
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/css-animation
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { generateAnimation } from '@fodt/css-animation';

generateAnimation({
  mode: 'keyframes',
  name: 'slide-in',
  frames: [
    { at: 0, x: 0, y: 0, rotate: 0, scale: 1, opacity: 100 },
    { at: 100, x: 100, y: 0, rotate: 0, scale: 1, opacity: 0 },
  ],
  timing: { duration: 600, easing: 'ease', delay: 0, iterations: 1, infinite: false, direction: 'normal', fillMode: 'none', playState: 'running' },
  reducedMotion: true,
});
// { css: '@keyframes slide-in { ... }\n\n.box { ... }\n\n@media (prefers-reduced-motion: reduce) { ... }', tree: { className: 'box' }, warnings: [] }
```

generateAnimation({ mode, name, frames, timing, transition, reducedMotion, width, height, background }) takes 'keyframes' or 'transition' mode. In keyframes mode, frames is an array of two to four { at, x, y, rotate, scale, opacity } objects (at is a percent position, the rest are the movement, rotation, scale and opacity at that position); timing sets duration, easing (a keyword from EASING_KEYWORDS, or 'cubic-bezier' with a bezier control-point object, or 'steps' with a step count and step position), delay, iterations, infinite, direction, fillMode and playState. In transition mode, transition sets the target hover state (x, y, scale, opacity, color) and timing's duration/easing/delay govern the transition longhands. reducedMotion (default true) adds a reduced-motion media rule turning the motion off. Returns { css, tree, warnings }: css is built entirely through the canonical stylesheetText writer; tree is the element the CSS styles. Throws AnimationError only if the canonical safety writer itself refuses the finished CSS, which validated input never reaches.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The keyframes-name grammar, the animation longhands and the shorthand-versus-name ambiguity note are all quoted directly from a live fetch of CSS Animations Level 1. The cubic-bezier control-point range and the steps() step-position keywords are quoted from a live fetch of CSS Easing Functions Level 1. The reduced-motion feature is quoted from a live fetch of Media Queries Level 5. Every declaration is checked against the css-tree 3.2.1 lexer. Hostile field values are checked against the shared HOSTILE_VALUES battery.

## Licence

MIT. See [LICENSE](./LICENSE).
