# PDF Merge

Combine PDFs into one document in the browser.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Combines several PDFs into one document, choosing which pages to take from each and in what order. Every page is copied as the original PDF objects — its text stays real, selectable text, its fonts and drawings stay exactly as drawn — never rasterised into a picture. The files you pick never leave your browser.

## Supported

- Any number of PDFs (up to 50) merged in the order you pick, or by file name
- A page list per file such as 1-3,5,8- to take only some pages, in the order written
- Fonts, images and drawings copied unchanged, never re-rendered as pictures
- An optional title for the combined document
- A progress bar per file and a Cancel button that stops the run

## Limits

- Up to 50 documents and 500 MB in total in one run, each document up to 200 MB on its own, above which this tool refuses rather than risk freezing the tab.
- Bookmarks and interactive form field definitions are not carried over, so a filled form can stop working in the merged copy.
- Page-level links and annotations are copied exactly as they are on the source page.
- Encrypted PDFs are refused outright: this tool never asks for or accepts a password, even when only an owner password is set, because writing a modified copy would drop or break whatever protection the source had.
- Merging runs in your browser, so very large files depend on your browser's own memory.

## Ambiguous cases, and what this does about them

- A PDF that reports itself encrypted with an empty (blank) user password is refused the same as one that needs a real password: writing any modified copy would silently drop the source's own protection, so this tool never distinguishes 'needs no real password' from 'needs one'.
- The merged document's page order follows exactly the order its inputs and their own page lists are written in; the 'By file name' option only changes which input is read first, never the order pages are listed within one file's own page list.

## Defined by

- [ISO 32000-1:2008 — Document management — Portable document format — Part 1: PDF 1.7](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf)
- [ISO 32000-2:2020 — Document management — Portable document format — Part 2: PDF 2.0](https://www.iso.org/standard/75839.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/pdf-merge pdf-merge
cd pdf-merge
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/pdf-merge
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { mergePdfs, loadPdf } from '@fodt/pdf-merge';

const result = await mergePdfs(
  [{ name: 'a.pdf', bytes: aBytes, pages: '1-3' }, { name: 'b.pdf', bytes: bBytes }],
  { order: 'as-picked' },
  { onProgress: (fraction, detail) => {}, signal: controller.signal },
);
// result.bytes is the merged PDF.
```

This package takes only byte arrays and plain values, and names no browser-only type anywhere, not even in a comment: it is built and tested in plain Node by a release gate that has no such type available. Every input is loaded with loadPdf, which checks the file header before the PDF library ever sees the bytes and refuses any encrypted document by name, whether the library throws its own encryption error or reports the loaded document as encrypted.

## Dependencies

- `@cantoo/pdf-lib` 2.11.1

## Tests

```sh
npm test
```

Every merge test runs the real, installed @cantoo/pdf-lib end to end against fixtures this package's own test/build-pdfs.ts builds with the same library, then checks the result with an independent reader (the same pdfjs-dist version this catalog already pins elsewhere for rendering PDF pages) so the same library that wrote the file is never the only thing that reads it back.

## Licence

MIT. See [LICENSE](./LICENSE).
