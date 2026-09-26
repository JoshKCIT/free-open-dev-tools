# Colour Contrast Checker

Check WCAG 2.2 contrast ratios and report the APCA lightness contrast.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Checks a foreground and background colour pair against the WCAG 2.2 contrast ratio and its AA and AAA thresholds for normal text, large text and non-text, and separately reports an independent APCA lightness contrast figure, clearly labelled as not a WCAG 2.2 result. A live text sample and its exact CSS are shown side by side so the effect can be pasted straight into a real page.

## Supported

- The WCAG 2.2 relative luminance and contrast ratio formulas, checked against the fetched WCAG glossary definitions and against the ACT rule "Text has minimum contrast" own worked example
- Success Criteria 1.4.3 (AA, 4.5:1 normal / 3:1 large text), 1.4.6 (AAA, 7:1 normal / 4.5:1 large text) and 1.4.11 (Non-text Contrast, 3:1)
- An independently implemented APCA lightness contrast figure (Lc), from the published APCA-W3 constants, credited to the Myndex APCA project
- Any colour text this project's colour core accepts (hex, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch(), device-cmyk()), including translucent colours composited over each other and, when the background itself is translucent, over white

## Limits

- The APCA figure comes from an independent implementation of the published APCA-W3 0.1.9 algorithm; it is not an official or certified APCA implementation and is never combined with, or shown as, a WCAG 2.2 pass or fail
- APCA is not a WCAG 2.2 conformance measure and has no official pass or fail threshold of its own here
- This tool cannot account for the font weight, size or anti-aliasing of the visitor's own page, or for how their own browser and display render the same colours
- "Large-scale" text is assumed at the WCAG 2.2 glossary's own 18-point (about 24px) size for the large text sample; the normal text sample is shown at 16px
- A colour that cannot be parsed at all falls back to this tool's own default with a warning naming the field, rather than blocking the check
- A translucent colour is composited over the other colour (and, when the background itself is translucent, over white first) before contrast is measured, in sRGB only -- this tool does not model a printed or otherwise non-sRGB compositing environment

## Ambiguous cases, and what this does about them

- The default background is assumed to be white when a colour cannot be parsed, matching the WCAG 2.2 Understanding document's own stated default

## Defined by

- [WCAG 2.2 — Success Criteria 1.4.3, 1.4.6 and 1.4.11, and the relative luminance and contrast ratio definitions](https://www.w3.org/TR/WCAG22/)
- [CSS Color Module Level 4 — colour parsing shared with the colour converter](https://www.w3.org/TR/css-color-4/)
- [APCA-W3 (Accessible Perceptual Contrast Algorithm), Myndex — independent implementation, version 0.1.9](https://git.apcacontrast.com/documentation/README.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/contrast-checker contrast-checker
cd contrast-checker
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/contrast-checker
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { checkContrast } from '@fodt/contrast-checker';

checkContrast('#000000', '#ffffff');
// { wcag: { ratio: 21, results: [...] }, apca: { lc: 106.04, label: 'APCA Lc (independent implementation, not a WCAG 2.2 result)', version: 'APCA 0.1.9 (0.98G-4g)' }, css: '...', tree: {...}, warnings: [] }
```

checkContrast(foreground, background) parses both colours (falling back to this tool's own default with a warning naming the field on failure), gamut-maps them into sRGB, composites any translucency, and returns { wcag: { ratio, results }, apca: { lc, label, version }, css, tree, warnings }. results is one row per WCAG success criterion and text size; css is the sample's own preview rule built through the canonical CSS safety writer. Throws ContrastError only if the safety writer itself refuses the finished CSS, which validated input never reaches.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

WCAG contrast is checked against the fetched WCAG 2.2 glossary formulas, against black-on-white (21:1) and same-on-same (1:1) identities, and against the ACT rule "Text has minimum contrast" (afw4f7) own Passed Example 10 (#0000EE on white, 9.39:1), plus a 500-pair differential against colorjs.io (devDependency-only oracle). APCA is checked against this tool's own independently derived reference values (hand-worked from the published constants, never from apca-w3's source) for full-contrast black-on-white and white-on-black. The generated preview CSS is checked against the css-tree 3.2.1 lexer and the shared hostile-value battery.

## Licence

MIT. See [LICENSE](./LICENSE).
