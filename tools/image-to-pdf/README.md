# Image to PDF

Place images into a PDF with page size and orientation control.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Places one or more pictures into a PDF, one image per page, with a chosen page size, orientation, margin and fit. JPEGs are embedded exactly as they were encoded — never re-compressed — and a rotated phone photo is placed the way your photo app already shows it. The pictures you pick never leave your browser.

## Supported

- PNG, JPEG, GIF, WebP and BMP images (GIF, WebP and BMP converted to lossless PNG first)
- A3, A4, A5, US Letter, Legal or a page fitted exactly to each image's own size
- Portrait, landscape or automatic orientation, chosen per image
- A margin from 0 to 50 mm
- Fit inside the margins (keeping the picture's own proportions) or actual size at 96 pixels per inch
- JPEG EXIF orientation applied so a phone photo is placed upright
- A progress bar and a Cancel button that stops the run

## Limits

- Up to 200 images and 300 MB in total in one run, above which this tool refuses rather than risk freezing the tab.
- GIF, WebP and BMP images are converted to lossless PNG first, and an animation keeps only its first frame.
- CMYK JPEGs are embedded as they are and may show different colours in some PDF viewers.
- Converting GIF, WebP and BMP images depends on your browser's own image decoders.
- Placing images runs in your browser, so very large or very many images depend on your browser's own memory.

## Ambiguous cases, and what this does about them

- Actual size draws every image at 96 pixels per inch (the CSS reference pixel this project's other tools already use); a picture larger than the page after the margins is scaled down to fit, with a note, rather than clipped.
- Automatic orientation looks only at whether the placed image is wider than it is tall (after any EXIF rotation is applied), never at the page size chosen for a different image in the same run.

## Defined by

- [ISO 32000-1:2008 — Document management — Portable document format — Part 1: PDF 1.7](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf)
- [ISO 216:2007 — Writing paper and certain classes of printed matter — Trimmed sizes — A and B series](https://www.iso.org/standard/36631.html)
- [CIPA DC-008-2019 — Exchangeable image file format for digital still cameras: Exif Version 2.32](https://www.cipa.jp/e/std/std-sec.html)
- [W3C Portable Network Graphics (PNG) Specification (Third Edition)](https://www.w3.org/TR/png/)
- [ITU-T T.81 — Information technology — Digital compression and coding of continuous-tone still images](https://www.itu.int/rec/T-REC-T.81)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/image-to-pdf image-to-pdf
cd image-to-pdf
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/image-to-pdf
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { imagesToPdf, PAGE_SIZES } from '@fodt/image-to-pdf';

const result = await imagesToPdf(
  [{ name: 'photo.jpg', bytes, kind: 'jpeg' }],
  { pageSize: 'a4', orientation: 'auto', marginMm: 10, fit: 'contain' },
  { onProgress: (fraction, detail) => {}, signal: controller.signal },
);
// result.bytes is the produced PDF.
```

This package takes only byte arrays and plain values, and names no browser-only type anywhere, not even in a comment: it is built and tested in plain Node by a release gate that has no such type available. Only PNG and JPEG bytes ever reach it; the worker converts GIF, WebP and BMP to PNG first with the browser's own canvas.

## Dependencies

- `@cantoo/pdf-lib` 2.11.1

## Tests

```sh
npm test
```

Every test runs the real, installed @cantoo/pdf-lib end to end, and checks results with an independent reader (the same pdfjs-dist version this catalog already pins elsewhere for rendering PDF pages), including reading back the exact content-stream transformation matrix `drawImage` wrote for each JPEG orientation, so the same library that wrote a file is never the only thing that reads it back.

## Licence

MIT. See [LICENSE](./LICENSE).
