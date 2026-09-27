# PDF to Image

Render PDF pages to PNG or JPEG in the browser.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Turns every page of a PDF into a downloadable PNG or JPEG image at the resolution you choose. Rendering runs through Mozilla's own PDF.js, with its worker, standard font data and decoders built into this page, so nothing is fetched once the page has loaded, and the file you pick never leaves your browser.

## Supported

- Every page of a PDF, or a page list such as 1-3,5,8-, rendered to PNG or JPEG
- A chosen resolution from 72 to 600 dots per inch
- A transparent background for PNG output, and a chosen quality for JPEG output
- The ten Foxit standard fonts PDF.js bundles for unembedded Times, Courier, Symbol and ZapfDingbats text
- JBIG2 and JPEG 2000 image decoding through PDF.js's own bundled wasm decoders
- A progress bar per page and a Cancel button that stops the run

## Limits

- Files up to 100 MB and up to 200 pages in one run, above which this tool refuses rather than risk freezing the tab.
- A page list may name at most 10,000 pages in one run.
- A page whose rendered size at the chosen resolution would be too large for this browser to encode is refused; try a lower resolution.
- Password-protected PDFs are refused outright: this tool never asks for or accepts a password, even when only an owner password is set.
- Unembedded Helvetica-family text is drawn with your browser's own sans-serif font, because Times New Roman's actual glyph data cannot be bundled under this project's licence rules; the page layout still uses PDF.js's own built-in character widths.
- A document that needs an unbundled Chinese, Japanese or Korean character map is reported with a note; some of that text may not render.
- A run that reports no progress for 20 seconds is stopped rather than left to run indefinitely.
- Document scripts, links and page actions are never run.
- CMYK images needing an ICC colour profile transform are not colour-corrected: the profile data is bundled for completeness but this tool does not wire it into rendering, since doing so would need a synchronous fetch this tool's zero-network design does not offer.
- Rendering runs in your browser, so fonts and exact pixels can differ slightly between browsers.
- Requires a browser recent enough to run Node 22.13-class JavaScript features that pdfjs-dist 6.x depends on.

## Ambiguous cases, and what this does about them

- A document with only an owner password (no user password needed to open it) still renders here, matching how most viewers treat that case; a document needing a user password is always refused, even to a caller that already knows the password, since this page never asks for one.
- PDF.js's own useSystemFonts option, when off, is what makes the ten bundled Foxit files actually get requested; the Liberation Sans files the Helvetica family maps to are refused on purpose rather than treated as a bug, since bundling them is a licence choice, not a defect.

## Defined by

- [ISO 32000-1:2008 — Document management — Portable document format — Part 1: PDF 1.7](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **PDF.js standard font data (Foxit fonts from PDFium)** (BSD-3-Clause) — [source](https://github.com/mozilla/pdf.js/tree/v6.3.289/external/standard_fonts). Copyright 2014 PDFium Authors. All rights reserved.
- **PDF.js JBIG2 wasm decoder** (BSD-3-Clause) — [source](https://github.com/mozilla/pdf.js/tree/v6.3.289/external/wasm). Copyright 2014 The PDFium Authors; PDF.js wrapper Copyright 2026 Mozilla Foundation
- **PDF.js OpenJPEG wasm decoder** (BSD-2-Clause) — [source](https://github.com/mozilla/pdf.js/tree/v6.3.289/external/wasm). Copyright 2002-2014 Universite catholique de Louvain (UCL), Belgium and others
- **PDF.js qcms wasm decoder** (MIT) — [source](https://github.com/mozilla/pdf.js/tree/v6.3.289/external/wasm). Copyright (C) 2009-2024 Mozilla Corporation; Copyright (C) 1998-2007 Marti Maria
- **PDF.js CMYK ICC profile (CGATS001Compat-v2-micro)** (CC0-1.0) — [source](https://github.com/mozilla/pdf.js/tree/v6.3.289/external/iccs). Public domain (CC0-1.0), bundled by the pdf.js project

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/pdf-to-image pdf-to-image
cd pdf-to-image
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/pdf-to-image
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { planRender, renderPages, outputName, sniffFile } from '@fodt/pdf-to-image';

const plan = planRender(bytes, 'document.pdf', { dpi: 150, format: 'png' });
// renderPages(document, plan, surfaces, hooks) drives an already-open PDF.js
// document (built by the calling page or test) over an injected surface factory.
```

This package takes only byte arrays and plain values, and names no browser-only type anywhere, not even in a comment: it is built and tested in plain Node by a release gate that has no such type available. Anything that needs a canvas is an injected SurfaceFactory the page or the test supplies; the PDF.js document itself is likewise injected into renderPages rather than constructed inside this package, since getDocument's own worker and binary-data wiring differ between a browser worker and this package's own Node test suite.

## Dependencies

- `pdfjs-dist` 6.3.289

## Tests

```sh
npm test
```

Every render test runs the real, installed pdfjs-dist library end to end (loading a hand-written PDF built by test/minimal-pdf.ts, from ISO 32000-1's own object/xref/trailer grammar) rather than mocking it, over a BinaryDataFactory that answers only from this package's own bundled bytes and a surface factory built on @napi-rs/canvas, whose canvas exposes the identical convertToBlob shape OffscreenCanvas does. pdfjs-dist 6.x requires Node 22.13 or later; this repository's root package.json declares Node >=20.19 and this project's CI runs Node 22, which satisfies pdfjs-dist's own requirement -- recorded here as a real per-package floor, since a consumer copying this folder out onto an older Node 20 release would need to raise it.

## Licence

MIT. See [LICENSE](./LICENSE).
