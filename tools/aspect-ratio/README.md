# Aspect Ratio Calculator

Solve for a missing dimension, and list common ratios and resolutions.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Solves a missing width, height or ratio from the other two, simplifies a width and height to the simplest whole-number ratio, and shows a decimal ratio (such as 2.39:1) alongside the nearest simple whole-number ratio. Also lists common aspect ratios and resolutions, each named for what it is used for and cited to the standard that defines or popularised it -- ITU-R BT.709 and BT.2020 for HD and UHD television, DCI's Digital Cinema System Specification for 2K/4K cinema, and VESA's display timing standards for common PC resolutions.

## Supported

- Solving a missing width or height from the other size and a ratio, rounded to whole pixels with the rounding error shown
- Solving the ratio from a width and height, reduced to the simplest whole-number form by the greatest common divisor
- Decimal ratios (such as 2.39:1) kept exactly as written, alongside the nearest ratio expressible with two whole numbers each at most 100
- A CSS aspect-ratio declaration in the form the property accepts
- A table of common ratios and common resolutions, each cited to the standard body that defines or popularised it

## Limits

- The common ratios and resolutions are a selection, not an exhaustive list, and reflect this project's own research rather than one single official table -- see testNotes and common-sizes-NOTICE.txt for what was fetched and what is established industry convention
- Marketing and colloquial names for resolutions vary by vendor and region; this tool uses the names commonly associated with each standard
- Solved sizes are rounded to whole pixels; the exact, unrounded value is available as the rounding error
- A decimal ratio's nearest whole-number match is approximate by construction and is shown alongside, never in place of, the exact value

## Ambiguous cases, and what this does about them

- DCI's own specification website returned no readable text this session (a JavaScript-rendered page); its title, resolutions and aspect ratios are cited from established, publicly documented industry convention rather than the specification's own fetched text.
- VESA's Display Monitor Timing and Coordinated Video Timings standards were confirmed to exist and be named on VESA's own site this session; their full timing tables are a members-oriented PDF this session could not fetch as text, so the common 16:10 resolution names (WXGA, WXGA+, WSXGA+, WUXGA) are cited from established industry convention.

## Defined by

- [CSS Box Sizing Module Level 4 (the aspect-ratio property)](https://www.w3.org/TR/css-sizing-4/)
- [CSS Values and Units Module Level 4 (the <ratio> type)](https://www.w3.org/TR/css-values-4/)
- [ITU-R BT.709-6 (HDTV parameter values)](https://www.itu.int/rec/R-REC-BT.709/en)
- [ITU-R BT.2020-2 (UHDTV parameter values)](https://www.itu.int/rec/R-REC-BT.2020/en)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/aspect-ratio aspect-ratio
cd aspect-ratio
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/aspect-ratio
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { solveAspect, simplifyRatio } from '@fodt/aspect-ratio';

solveAspect({ solveFor: 'height', width: 1920, ratio: { w: 16, h: 9 } }).height; // 1080
simplifyRatio(1920, 1080); // { w: 16, h: 9 }
simplifyRatio(2.39, 1); // { w: 2.39, h: 1, nearestWhole: { w: 98, h: 41, error: ... } }
```

`simplifyRatio` only reduces by the greatest common divisor when both inputs are already whole numbers; a decimal ratio is kept exactly as given, with the nearest whole-number match (both terms at most 100) offered alongside it, never substituted for it.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

aspect-ratio's property definition is quoted from CSS Box Sizing Module Level 4 (fetched this session, https://www.w3.org/TR/css-sizing-4/), and the <ratio> type's grammar and serialization rule are quoted from CSS Values and Units Module Level 4 (fetched this session). D-121/D-122: the common ratio and resolution table is not vendored from any single third-party source (per the orchestrator amendment overriding this plan's original Wikipedia-table step); it is compiled in this project's own words, each row cited to the standard that defines it. ITU-R BT.709 and BT.2020's own recommendation index pages were fetched this session (2026-09-26) and confirm each recommendation's title, number and scope; the full recommendation text sits behind a PDF this session did not fetch. DCI's and VESA's exact timing tables likewise sit behind pages this session could not read as text; see ambiguities.

## Licence

MIT. See [LICENSE](./LICENSE).
