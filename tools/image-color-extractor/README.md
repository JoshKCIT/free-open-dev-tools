# Image Colour Extractor

Extract a dominant palette from an image entirely in the browser.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Pick a PNG, JPEG, GIF, WebP or BMP image and get its dominant colours as swatches, a table and CSS custom properties -- the same colours every time for the same image. The image's header is checked before any decoding, decoding happens only in a background worker with a time limit, and nothing is ever uploaded: the picked file never leaves the browser.

## Supported

- PNG, JPEG (baseline and progressive), GIF, WebP (lossy, lossless and extended) and BMP (bottom-up and top-down) images
- A header check -- format, dimensions and a hard pixel and byte-size limit -- before any pixel is ever decoded
- Deterministic median cut quantisation (Heckbert 1982), 3 to 12 colours, with an option to leave out mostly-transparent pixels
- Swatches, a table of hex/RGB/share, and downloadable CSS custom properties (--image-1, --image-2, ...)
- A built-in four-colour test pattern that needs no file at all

## Limits

- Only PNG, JPEG, GIF, WebP and BMP are read; SVG is never opened, even renamed, because it can reference other resources this tool must never fetch
- Animated GIF and animated WebP give only the first frame's colours
- A large image is downscaled before its pixels are sampled, which can merge small, vividly coloured details into the surrounding average colour
- Colour profiles embedded in the file are applied or ignored exactly as the visitor's browser decides when it decodes the image
- The picked image itself is never shown on the page -- only its extracted colours are -- so a decoding problem is reported by message, not by a preview

## Ambiguous cases, and what this does about them

- Ties in median cut's own channel-range comparison are broken red, then green, then blue, a deterministic rule this tool chose since Heckbert's paper does not specify a tie-break

## Defined by

- [W3C Portable Network Graphics (PNG) specification, Third Edition](https://www.w3.org/TR/2003/REC-PNG-20031110/)
- [ITU-T Recommendation T.81 (JPEG)](https://www.w3.org/Graphics/JPEG/itu-t81.pdf)
- [GIF89a (CompuServe, hosted by W3C)](https://www.w3.org/Graphics/GIF/spec-gif89a.txt)
- [RFC 9649 (the WebP image format)](https://www.rfc-editor.org/rfc/rfc9649.txt)
- [Microsoft BITMAPFILEHEADER and BITMAPINFOHEADER documentation](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapfileheader)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/image-color-extractor image-color-extractor
cd image-color-extractor
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/image-color-extractor
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { extractFromPixels, paletteCss, sniffImage } from '@fodt/image-color-extractor';

const header = sniffImage(firstBytesOfFile); // { type: 'png', width, height } or throws
const { colors, sampled } = extractFromPixels(rgbaBytes, width, height, { count: 6 });
colors[0]; // { hex: '#ff0000', r: 255, g: 0, b: 0, share: 0.25 }
paletteCss(colors); // ':root {\n  --image-1: #ff0000;\n  ...\n}'
```

`sniffImage` and `extractFromPixels`/`extractPalette` are the only two calls a caller needs: sniff the header first and refuse before decoding anything, then decode with the browser's own decoder and pass the resulting pixel bytes here. Nothing in this package ever reads a file or touches a canvas -- both live in the web application's worker.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every format's header layout is quoted from its own fetched specification in tools/image-color-extractor/src/sniff.ts: the PNG signature and IHDR chunk (W3C PNG Third Edition, sections 5.2 and 11.2.2), the JPEG marker-segment and frame-header syntax (ITU-T T.81, sections B.1.1.4 and B.2.2) together with the VP8 key-frame dimension layout (RFC 6386), the GIF Header and Logical Screen Descriptor (GIF89a, sections 17 and 18), the WebP RIFF header and its three bitstream chunk shapes (RFC 9649, sections 2.3-2.7), and the BITMAPFILEHEADER/BITMAPINFOHEADER field layout (Microsoft's own documentation pages). Median cut is Paul Heckbert's 1982 SIGGRAPH paper 'Color Image Quantization for Frame Buffer Display', reimplemented from its description of the algorithm, never from any published source code. The four-colour sample pattern's colours (red, lime, blue, white) are CSS Color Module Level 4's own named colours.

## Licence

MIT. See [LICENSE](./LICENSE).
