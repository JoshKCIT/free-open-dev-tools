# CSS Clamp Generator

Produce a fluid clamp() value from a size range and a viewport range.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds a fluid font-size declaration from a minimum and maximum size and the viewport widths they should apply at, using the widely documented straight-line ('CSS lock') construction: a slope and intercept computed from the two size/viewport pairs, written as clamp(min, intercept + slope*100vw, max). The result equals the minimum at and below the minimum viewport, the maximum at and above the maximum viewport, and scales linearly in between, exactly as CSS's own clamp() function is defined to behave.

## Supported

- Fluid clamp() generation from a minimum size, maximum size, minimum viewport and maximum viewport
- Output in rem (default, so the value still follows the visitor's font size preference) or px
- Evaluating the resulting value at common device widths (320, 375, 768, 1024, 1280, 1440, 1920px) and the two chosen viewports
- A warning, grounded in WCAG 2.2 success criterion 1.4.4 Resize Text, when the maximum size is disproportionately larger than the minimum

## Limits

- The straight-line fluid-scaling construction is a widely used community convention (credited to Utopia and Pedro Rodriguez's original slope/intercept derivation), not part of any W3C specification -- only the clamp() function itself is standardised
- Text that scales with the browser's viewport width can fail WCAG 2.2 success criterion 1.4.4 (Resize Text) if a user cannot reach 200 percent of the original size by zooming, which depends on how the browser's own zoom affects the reported viewport width; this tool warns when the size range looks risky but cannot test a real browser's zoom behaviour
- Results assume the stated root font size for the rem output; a real page's root font size can differ if the visitor has changed their browser's default
- Below the minimum viewport the value stays at the minimum size, and above the maximum viewport it stays at the maximum size -- it does not keep scaling past either bound

## Ambiguous cases, and what this does about them

- No fetched source states a precise numeric ratio above which a fluid range is certain to fail WCAG 2.2 1.4.4 on zoom; Adrian Roselli's documented warning (quoted via Smashing Magazine's 'Modern Fluid Typography Using CSS Clamp') is qualitative ('there is a chance'). This tool uses 2.5 (maximum more than 2.5 times the minimum) as its own conservative heuristic threshold, disclosed here rather than presented as a specification value.

## Defined by

- [CSS Values and Units Module Level 4 (the clamp() function)](https://www.w3.org/TR/css-values-4/)
- [WCAG 2.2 Success Criterion 1.4.4 Resize Text](https://www.w3.org/TR/WCAG22/#resize-text)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/css-clamp css-clamp
cd css-clamp
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/css-clamp
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { fluidClamp, evaluateClamp } from '@fodt/css-clamp';

const result = fluidClamp({ minSize: 16, maxSize: 24, minViewport: 320, maxViewport: 1280 });
result.value; // 'clamp(1rem, 0.8333rem + 0.8333vw, 1.5rem)'
evaluateClamp(result, 320); // 16 (px)
evaluateClamp(result, 1280); // 24 (px)
```

`slope` and `intercept` are always returned in raw px-per-px and px terms, independent of the chosen output unit, so a caller can evaluate or chart the underlying straight line without re-parsing the generated CSS text.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The clamp() function's own min/preferred/max semantics are quoted from CSS Values and Units Module Level 4 ('clamp(MIN, VAL, MAX) ... represents exactly the same value as max(MIN, min(VAL, MAX))'), fetched this session. WCAG 2.2's Resize Text wording ('text can be resized without assistive technology up to 200 percent without loss of content or functionality') is quoted from the fetched specification. The slope/intercept construction is quoted from Utopia's own blog post 'Preparing clamp() for typographic scales' (utopia.fyi/blog/clamp/, crediting Pedro Rodriguez), fetched this session. Adrian Roselli's 1.4.4 warning is quoted via Smashing Magazine's 'Modern Fluid Typography Using CSS Clamp' (2022), fetched this session, since Roselli's own site could not be reached over TLS from this session.

## Licence

MIT. See [LICENSE](./LICENSE).
