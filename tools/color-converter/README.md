# Colour Converter

Convert between HEX, RGB, HSL, HWB, LAB, LCH, OKLAB, OKLCH and CMYK.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Types a colour in any of nine formats and shows it converted into all nine, alongside whether it falls inside the sRGB colour gamut and, when it does not, how it was mapped back into range. Built on a colour core checked digit for digit against the CSS Color 4 sample conversion code and cross-checked against two independent colour libraries.

## Supported

- HEX (3, 4, 6 and 8-digit), rgb()/rgba() (legacy comma and modern space syntax, numbers or percentages), hsl()/hsla() (legacy and modern, including a missing hue written as none), hwb(), lab(), lch(), oklab(), oklch() and device-cmyk() (legacy and modern), all as CSS Color Module Level 4 and 5 define them
- Hue units deg, grad, rad and turn, and the none keyword for any missing component (treated as zero per the specification)
- Out-of-gamut reporting and mapping into sRGB by the CSS Color 4 gamut mapping algorithm (Binary Search with Local MINDE), with the Oklab colour-difference distance to the mapped result
- Adjustable output precision and an optional legacy comma syntax for the formats that define one

## Limits

- device-cmyk() is the naive, uncalibrated conversion CSS Color 5 itself defines, not an ICC-profile-calibrated one, so it does not match what any particular printer produces
- Colours outside the sRGB gamut are mapped for the sRGB-bound formats (HEX, RGB, HSL, HWB, CMYK) by the CSS Color 4 gamut mapping algorithm, which changes the colour; LAB, LCH, OKLAB and OKLCH always show the exact, unmapped value
- Named colours (for example red or rebeccapurple) and the wider-gamut color() function spaces are not accepted
- Float-to-float conversions round trip within 1e-6 per component; anything through 8-bit HEX or rounded RGB, and naive CMYK, round trip within one step of 255
- The swatch shown is drawn by the visitor's own browser and display, which may render the same colour slightly differently

## Ambiguous cases, and what this does about them

- Lab and LCH lightness is serialised with a percent sign, matching the specification's own worked examples; Oklab and OKLCH lightness is serialised as a plain 0-1 number, matching widely observed browser serialisation -- CSS Color 4 permits either the percentage or the plain-number form for all of these, so this is a documented choice, not a specification requirement
- A colour with a value the parser cannot make sense of (an unbalanced function, too few or too many components) is refused outright with a named error rather than partially interpreted

## Defined by

- [CSS Color Module Level 4 — colour syntaxes, gamut mapping, and Lab/LCH/Oklab/OKLCH](https://www.w3.org/TR/css-color-4/)
- [CSS Color Module Level 5 — device-cmyk() and its naive conversion](https://www.w3.org/TR/css-color-5/)
- [Björn Ottosson — A perceptual color space for image processing (the Oklab definition)](https://bottosson.github.io/posts/oklab/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/color-converter color-converter
cd color-converter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/color-converter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { convertAll } from '@fodt/color-converter';

convertAll('#3366ff');
// { formats: [{ format: 'hex', value: '#3366ff' }, ...], inGamut: true, mapped: false, deltaE: 0, swatch: '#3366ff', warnings: [] }
```

convertAll(text, { precision = 3, legacy = false }) parses one colour and returns { formats, inGamut, mapped, deltaE, swatch, warnings }: formats is one entry per supported format (see FORMATS); inGamut says whether the parsed colour falls inside sRGB; mapped is true when the sRGB-bound formats were gamut-mapped; deltaE is the Oklab colour-difference distance between the original and the mapped colour (0 when inGamut); swatch is a hex string built by this tool's own serialiser, never from the input text. Throws ColorConverterError only when the text cannot be parsed at all.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Parsing is checked against every CSS Color 4 syntax form (legacy comma, modern space, none, percentages, hue units) and against the specification's own worked examples (the hwb()/hsl()/rgb() equivalence in section 8, the oklch()/lab()/hex equivalence in section 11.1) and CSS Color 5's own device-cmyk() worked example. The Oklab implementation is cross-checked against Björn Ottosson's own published direct linear-sRGB-to-Oklab matrices, an independent route from the XYZ-pivoted one this tool implements. The conversion matrices are compared digit for digit against the CSS Color 4 sample code vendored at a pinned commit, and conversions are checked against culori and colorjs.io (devDependency-only oracles, never a runtime dependency) over 1,000 seeded colours.

## Licence

MIT. See [LICENSE](./LICENSE).
