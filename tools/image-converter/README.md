# Image Converter & Resizer

Convert, resize and re-encode images entirely in the browser canvas.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Decodes a picked PNG, JPEG, GIF, WebP or BMP image and re-encodes it to PNG, JPEG, WebP or AVIF, resized by percent, to fit inside a box or to an exact size, using the browser's own canvas and codecs. Every run reports plainly which of the four output formats this particular browser can really write, judged by the media type the browser's own encoder hands back, never assumed from a format name alone.

## Supported

- PNG, JPEG, GIF, WebP and BMP input, read from the file's own header before anything is decoded
- PNG, JPEG, WebP and AVIF output, whichever this browser can really encode
- Resize by percent, fit inside a box (never enlarging unless asked), or an exact size with an optional locked aspect ratio
- A quality setting for JPEG, WebP and AVIF output, and a background colour for JPEG output
- EXIF orientation applied so a rotated photo comes out upright
- Decoding, resizing and encoding in a background worker with progress and a Cancel button

## Limits

- Files up to 100 MB and up to 100,000,000 declared pixels are accepted; the planned output is refused before any canvas is created once it would exceed this browser's own measured decode-and-encode ceiling, currently 40,000,000 pixels.
- Whether WebP and AVIF can be written at all depends on this browser: the page reports exactly what its own encoder returns and never hands back a PNG under a WebP or AVIF name.
- Re-encoding drops embedded metadata, including any colour profile: the browser converts to sRGB.
- An animated GIF or WebP source gives only its first frame.
- A transparent source written to JPEG is composited on the chosen background colour, since JPEG has no transparency.
- AVIF, HEIC and TIFF are not accepted as input.
- Resampling quality is whatever this browser's own canvas scaling provides; it is not a dedicated resampling algorithm.

## Ambiguous cases, and what this does about them

- The quality field is a 1 to 100 number in the page, converted to the 0 to 1 fraction the HTML Standard's own canvas encode calls take; an out-of-range value is clamped rather than passed straight through to let the browser fall back to its own default, so the visitor's request stays as close to what they asked for as the standard allows.
- Whether a source is genuinely animated (rather than simply a GIF or WebP file that happens to hold one frame) is not checked before warning that only the first frame is kept, since detecting that reliably would need decoding the whole file rather than reading its header.

## Defined by

- [HTML Standard — Canvas: the 2D rendering context (createImageBitmap, OffscreenCanvas, convertToBlob/toBlob)](https://html.spec.whatwg.org/multipage/canvas.html)
- [W3C PNG (Third Edition) — Portable Network Graphics Specification](https://www.w3.org/TR/png/)
- [ITU-T T.81 — Information technology — Digital compression and coding of continuous-tone still images](https://www.w3.org/Graphics/JPEG/itu-t81.pdf)
- [RFC 9649 — WebP Image Format](https://www.rfc-editor.org/rfc/rfc9649)
- [AV1 Image File Format (AVIF)](https://aomediacodec.github.io/av1-avif/)
- [CSS Images Level 3 — image-orientation](https://www.w3.org/TR/css-images-3/#the-image-orientation)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/image-converter image-converter
cd image-converter
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/image-converter
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { planConversion, outputFileName } from '@fodt/image-converter';

const plan = planConversion(bytes, 'photo.png', { format: 'jpeg', quality: 85, background: '#ffffff', resize: { mode: 'percent', percent: 50 } });
// plan.targetWidth/targetHeight/mediaType/qualityFraction/background feed the
// worker's own createImageBitmap/OffscreenCanvas/convertToBlob call, which
// this package never names.
```

This package takes only byte arrays and plain values, and names no browser-only type anywhere, not even in a comment: it is built and tested in plain Node by a release gate that has no such type available. Deciding the output pixel size, checking the file header and clamping options all happen here; decoding, drawing and encoding the actual pixels happen only in the worker this package never imports.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every sizing, capability-interpretation and quality-clamping rule is proven in plain Node against hand-computed expectations; the header check reuses the canonical file-sniff.ts this phase's every file-reading tool copies byte for byte. The real browser encode -- and the per-engine truth about which formats this particular browser can actually write -- is proven only by the dedicated Playwright spec, which probes each of the four tested browser projects with its own OffscreenCanvas.convertToBlob call and compares the result to what the page itself reports.

## Licence

MIT. See [LICENSE](./LICENSE).
