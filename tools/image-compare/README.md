# Image Diff & Compare

Compare two images pixel by pixel and see the differences highlighted with the share of pixels that differ.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Compares two pictures pixel by pixel in a background worker inside your browser, using pixelmatch's perceptual colour difference, and draws every difference in red on a faded copy of the first picture. You get the exact number of differing pixels out of the total, their share as a percentage, and the difference image as a PNG you can download. Nothing is sent, stored or recorded: both pictures and the result stay in this page.

## Supported

- PNG, JPEG, GIF, WebP and BMP image files
- A threshold from 0 (any change counts) to 1, default 0.1, on pixelmatch's own perceptual colour difference
- An exact count of differing pixels and an exact share, worked out in whole numbers
- Pictures of different sizes, refused by default or compared after the smaller one is padded with transparent pixels at its right and bottom edges
- An option to count anti-aliased pixels, which pixelmatch otherwise skips and draws in yellow without counting

## Limits

- Each file may be up to 50 MB and 16,000,000 pixels; larger ones are refused before decoding.
- The threshold runs from 0 (any change counts) to 1; it is pixelmatch's own threshold on a perceptual colour difference, not a percentage.
- Images of different sizes are refused unless you choose to pad the smaller one with transparent pixels at its right and bottom.
- Comparing stops after 20 seconds with a message; Cancel stops it at once.
- Pixels are compared as this browser decodes them, with photo orientation applied.
- Padding may not make a picture of more than 16,000,000 pixels either: a very wide thin picture against a very tall thin one is refused, with the size padding would need named.
- The difference image is previewed on the page up to 2 MB; a larger one is offered only as the diff.png download.
- An animated GIF or WebP is compared as the browser draws it, normally its first frame; nothing is compared across frames.

## Ambiguous cases, and what this does about them

- Which pixels count as anti-aliased is pixelmatch's own heuristic, a published detector that looks at a pixel's neighbours; it can skip a real one-pixel change that happens to look like an edge
- A semi-transparent pixel is compared after blending it against a checkerboard background, as pixelmatch does by default, so two fully transparent pixels with different hidden colours match and a transparent padded pixel differs from a solid one
- The share is rounded half up to two decimals, but never shown as 0.00 % while any pixel differs or as 100.00 % while any pixel matches

## Defined by

- [pixelmatch 7.2.0 README (the threshold, anti-aliasing and output colour rules)](https://github.com/mapbox/pixelmatch/blob/v7.2.0/README.md)
- [Kotsarenko and Ramos 2010, Measuring perceived color difference using YIQ NTSC transmission color space in mobile applications](https://www.spiedigitallibrary.org/conference-proceedings-of-spie/8011/80119D/Simple-perceptual-color-space-for-color-specification-and-real-time/10.1117/12.901997.full)
- [Vysniauskas 2009, Anti-aliased pixel and intensity slope detector (archived copy)](https://web.archive.org/web/2024/https://www.researchgate.net/publication/234126755_Anti-aliased_Pixel_and_Intensity_Slope_Detector)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/image-compare image-compare
cd image-compare
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/image-compare
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { compareImages, shareText } from '@fodt/image-compare';

// a and b are Uint8ClampedArray RGBA buffers of the same width and height.
const result = compareImages(a, b, width, height, { threshold: 0.1, includeAA: false });
// result.differing is the exact count, result.total is width * height,
// result.diff is an RGBA buffer with differing pixels in red.
console.log(`${result.differing} of ${result.total} (${shareText(result.differing, result.total)})`);
```

`compareImages(a, b, width, height, { threshold, includeAA })` calls pixelmatch with `alpha: 0.1` and `diffColor: [255, 0, 0]` and returns `{ differing, total, diff }`; both buffers must be whole `Uint8ClampedArray`s of `width * height * 4` bytes. `planCompare(a, b, 'refuse' | 'pad')` decides the compared size and throws `ImageCompareError` naming both sizes when they differ and padding was not chosen; `padPixels(src, width, height, toWidth, toHeight)` copies a picture to the top left of a transparent canvas. `shareText(differing, total)` gives the percentage in integer arithmetic. `checkImageFile(header, byteLength)` refuses an over-size, unsupported or over-large picture before any decoding; `checkThreshold(value)` refuses a threshold outside 0 to 1 or not a number, naming the Threshold field.

## Dependencies

- `pixelmatch` 7.2.0

## Tests

```sh
npm test
```

Boundary values come from pixelmatch's own source at 7.2.0: a pixel counts when the absolute YIQ delta, 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q, is greater than maxDelta = 35215 * threshold * threshold, where 35215 is the most the metric can reach. Black against white has delta 32857.13, so it counts at 0.9659 (maxDelta 32854.29) and not at 0.966 (32861.09); gray 100 against 110 has delta 50.53, so it counts at 0.0378 (50.3166) and not at 0.0379 (50.5832); gray 128 against 129 has delta 0.5053, so it counts at 0.0037 (0.4821) and not at 0.0038 (0.5085); at the default 0.1 (maxDelta 352.15) a gray difference of 26 (delta 341.58) does not count and one of 27 (delta 368.36) does. Each literal is checked one step either side, and the formula is written out a second time in the test from the YIQ coefficients rather than taken from the library. pixelmatch's own published test images 1a and 1b (test/fixtures at the tag v7.2.0, kept as base64 in test/fixtures/pixelmatch-vectors.ts) must differ in 143 pixels at threshold 0.05 and 106 at 0.1, as its own test suite states. The anti-aliasing case is a 5 by 5 image built by hand from the detector's published rules.

## Licence

MIT. See [LICENSE](./LICENSE).
