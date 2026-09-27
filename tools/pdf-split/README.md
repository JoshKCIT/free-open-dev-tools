# PDF Split & Page Organizer

Split, extract, delete, reorder and rotate PDF pages in the browser.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Takes a PDF apart the way you need it: split every page into its own file, split it into ranges, pull specific pages out, drop pages, put the remaining pages in a new order, or turn pages by 90, 180 or 270 degrees. Every output page is copied as the original PDF objects — never rasterised into a picture — and the file you pick never leaves your browser.

## Supported

- Split every page into its own single-page PDF
- Split by ranges such as 1-2;3 into one document per range
- Extract a page list such as 3,1 into one document, in that order, duplicates allowed
- Delete a page list, keeping every other page in order
- Reorder pages by a full permutation such as 3,1,2
- Rotate listed pages, or every page, by 90, 180 or 270 degrees, added to whatever rotation the page already has
- A progress bar and a Cancel button that stops the run

## Limits

- Files up to 200 MB and at most 1,000 output files in one run, above which this tool refuses rather than risk freezing the tab.
- Bookmarks and interactive form field definitions are not carried over into any output file.
- Encrypted PDFs are refused outright: this tool never asks for or accepts a password, even when only an owner password is set, because writing a modified copy would drop or break whatever protection the source had.
- Reordering requires every page named exactly once; a missing or repeated page number is refused by name.
- Deleting every page from a document is refused, since a PDF must have at least one page.
- Splitting and rotating run in your browser, so very large files depend on your browser's own memory.

## Ambiguous cases, and what this does about them

- Rotating adds the requested degrees to whatever rotation the page already effectively has (including one it only inherits from the document's own page tree), never replacing it, so rotating the same page twice compounds rather than resets.
- A PDF that reports itself encrypted with an empty (blank) user password is refused the same as one that needs a real password, since writing any modified copy would silently drop the source's own protection.

## Defined by

- [ISO 32000-1:2008 — Document management — Portable document format — Part 1: PDF 1.7](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf)
- [ISO 32000-2:2020 — Document management — Portable document format — Part 2: PDF 2.0](https://www.iso.org/standard/75839.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/pdf-split pdf-split
cd pdf-split
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/pdf-split
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { organizePdf } from '@fodt/pdf-split';

const result = await organizePdf(bytes, 'document.pdf', { kind: 'split-ranges', ranges: '1-2;3' }, {
  onProgress: (fraction, detail) => {},
  signal: controller.signal,
});
// result.files is one entry per output document.
```

This package takes only byte arrays and plain values, and names no browser-only type anywhere, not even in a comment: it is built and tested in plain Node by a release gate that has no such type available. Every input is loaded with its own loadPdf (a small file this package owns outright, not shared code), which checks the file header before the PDF library ever sees the bytes and refuses any encrypted document by name.

## Dependencies

- `@cantoo/pdf-lib` 2.11.1

## Tests

```sh
npm test
```

Every test runs the real, installed @cantoo/pdf-lib end to end against fixtures this package's own test/build-pdfs.ts builds with the same library, then checks results with an independent reader (the same pdfjs-dist version this catalog already pins elsewhere for rendering PDF pages) so the same library that wrote a file is never the only thing that reads it back.

## Licence

MIT. See [LICENSE](./LICENSE).
