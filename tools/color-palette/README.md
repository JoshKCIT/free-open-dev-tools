# Colour Palette & Shades

Build harmonies, tints, shades, tones and blends from a base colour.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds a colour palette from one base colour: a harmony (complementary, analogous, triadic, split-complementary or tetradic hue rotation), tints toward white, shades toward black, tones toward a mid grey, or a blend toward a second colour, mixed with CSS Color Module Level 5's own color-mix() semantics. Shows each colour as a swatch and copies the whole palette as CSS custom properties.

## Supported

- Complementary, analogous, triadic, split-complementary and tetradic hue harmonies, rotated in OKLCH (default, perceptually even) or HSL
- Tints, shades, tones and an arbitrary two-colour blend, mixed with premultiplied alpha and the CSS Color 4 "shorter" hue arc, in Oklab (default), OKLCH or sRGB
- 3 to 12 steps per palette
- A CSS custom-properties block (--palette-1 through --palette-N) ready to paste, and a swatch/table view of every step's hex and OKLCH value

## Limits

- Steps outside the sRGB gamut are gamut-mapped for display, which changes them; the OKLCH caption always shows the exact, unmapped value
- HSL harmonies are not perceptually even (a fixed hue-degree rotation does not look evenly spaced to the eye), which is why OKLCH is the default
- The swatches are drawn by the visitor's own browser and display
- Harmony names follow common design usage, not a published colour-theory standard

## Ambiguous cases, and what this does about them

- "Tones" mixes toward a mid grey at OKLCH lightness 60%, chroma 0 -- a reasonable middle grey, not a value any specification defines

## Defined by

- [CSS Color Module Level 4 — colour interpolation and hue interpolation (the "shorter" arc)](https://www.w3.org/TR/css-color-4/)
- [CSS Color Module Level 5 — color-mix() and its percentage normalisation](https://www.w3.org/TR/css-color-5/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/color-palette color-palette
cd color-palette
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/color-palette
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildPalette } from '@fodt/color-palette';

buildPalette({ base: '#2563eb', mode: 'harmony', harmonyName: 'complementary', space: 'hsl' });
// { swatches: [...], css: ':root {\n  --palette-1: #2563eb;\n  --palette-2: #eb9d25;\n}', table: [...], warnings: [] }
```

buildPalette({ base, mode, harmonyName, steps, second, space }) parses base (and second, for a blend) through this tool's own colour core, falling back to a default with a warning naming the field on failure. mode is 'harmony' | 'tints' | 'shades' | 'tones' | 'blend'; steps (3-12, default 5) applies to every mode but harmony. Returns { swatches, css, table, warnings }.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Harmonies are checked against a hand-worked HSL example (complementary of #ff0000 is #00ffff) and against the stated hue offsets. Tints/shades/tones are checked against colorjs.io's own mix() (devDependency-only oracle) at the same percentages, within one step of 255. Hue interpolation is checked against the CSS Color 4 specification's own worked "shorter arc" example.

## Licence

MIT. See [LICENSE](./LICENSE).
