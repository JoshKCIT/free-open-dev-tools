# PDF Text Extractor & Metadata Remover

Extract a PDF's text page by page, view its metadata and download a copy with the metadata removed.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Reads a PDF's text one page at a time, shows its document information and XMP metadata, and writes a copy with all of that metadata removed. Reading runs through Mozilla's PDF.js in its own background worker and the copy is written by pdf-lib in a second one, both built into this page, and the copy is read again by two readers before it is offered. The file you pick never leaves your browser.

## Supported

- PDF files PDF.js can open, with every page or a page list such as 1-3,5,8-
- Text mode: the text of each page under a --- Page N --- heading as Unicode, with a note for a page that has no text
- Metadata mode: the document information dictionary (Title, Author, Subject, Keywords, Creator, Producer, CreationDate, ModDate, Trapped and any custom keys) and the XMP properties
- Remove mode: a copy named after your file with -clean.pdf added, without the document information dictionary, any metadata stream, any piece-info or last-modified entry, or any object that nothing refers to any more, so the author or XMP of an earlier saved revision does not survive
- A list of what was removed, and a check that two readers find no metadata left in the copy before it is offered
- A progress bar per page in Text mode and a Cancel button in every mode

## Limits

- Files up to 100 MB are accepted; text is read from at most 500 pages and 2,000,000 characters, with a note when more exists.
- A file whose compressed streams would decode to more than 64 MiB in one stream, or 256 MiB in all, is refused before it is read, with the message that it expands to more data than this page can hold in memory. A stream is left out as a picture only when every Subtype entry of its own dictionary says Image, and such a picture is counted too when page content, a font, a character map or an object stream uses it, or when its object number cannot be read; pictures used only as images are not counted. A crafted file can still hide a stream from this check, for example as a whole object written inside a string with its own header and a correct Length, beyond the first 8 MiB of one object stream, the first 32 MiB of all object streams or the first 32 MiB of text between streams, among more than 20,000 picture streams or object streams, in an array or dictionary of references longer than 64 KiB, in a page content array object named after more than 100,000 page content references, or past the first 1 MiB of an object stream header. A file whose text literally reads /Contents and a reference to a large picture, even inside a string, is refused.
- A PDF that needs a password to open is refused; an encrypted PDF is not rewritten, so Remove mode refuses it.
- The file identifier (/ID) stays in the copy; annotations, form data, attachments, bookmarks and page content are not changed.
- Reading stops after 20 seconds without progress, and removal after 20 seconds; Cancel stops either at once.
- Reading a long file takes longer in some browsers, Safari most of all (on one test machine 150 short pages took about 5 seconds there and about 0.3 seconds or less in Chrome and Firefox); the progress bar and Cancel stay available, and a read stops only after 20 seconds without progress.
- Text that relies on a built-in Chinese, Japanese or Korean character map may be missing, because this page loads no extra data files.
- The copy is a rewritten file: a digital signature in it no longer validates, and it is saved without object streams, so it can be larger.
- Only the metadata fields ISO 32000-1 names are removed; text in page content, annotations, bookmarks, form fields or attached files can still identify an author.
- Each value shown is cut at 1,000 characters, at most 200 custom keys and 200 XMP properties are listed, and control, direction-changing and invisible characters (such as zero width marks and tag characters) are shown escaped.

## Ambiguous cases, and what this does about them

- Text comes in the order PDF.js reports it, which follows the content order of the file and is not always the reading order; columns and tables can interleave
- A page made only of pictures has no text: the page says so and no character recognition is attempted
- An XMP packet that PDF.js cannot parse is shown as having no XMP properties, although Remove mode still deletes the stream that holds it
- Some producers keep an author or a title in places other than metadata, such as page content or bookmarks; those places are not metadata fields and are left alone

## Defined by

- [ISO 32000-1:2008 Document management, Portable document format, Part 1: PDF 1.7 (section 14.3 Metadata and section 7.5 File structure), archived copy of the text Adobe published](https://web.archive.org/web/2024/https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf)
- [XMP Specification Part 1: Data and Serialization Models (Adobe, the XMP packet and properties shown in Metadata mode)](https://raw.githubusercontent.com/adobe/xmp-docs/master/XMPSpecifications/XMPSpecificationPart1.pdf)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **PDF.js JBIG2 wasm decoder** (BSD-3-Clause) — [source](https://github.com/mozilla/pdf.js/tree/v6.3.289/external/wasm). Copyright 2014 The PDFium Authors; PDF.js wrapper Copyright 2026 Mozilla Foundation. The module ships in pdfjs-dist 6.3.289.
- **PDF.js OpenJPEG wasm decoder** (BSD-2-Clause) — [source](https://github.com/mozilla/pdf.js/tree/v6.3.289/external/wasm). Copyright 2002-2014 Universite catholique de Louvain (UCL), Belgium and others. The module ships in pdfjs-dist 6.3.289.
- **PDF.js qcms wasm decoder** (MIT) — [source](https://github.com/mozilla/pdf.js/tree/v6.3.289/external/wasm). Copyright (C) 2009-2024 Mozilla Corporation; Copyright (C) 1998-2007 Marti Maria. The module ships in pdfjs-dist 6.3.289.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/pdf-text-metadata pdf-text-metadata
cd pdf-text-metadata
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/pdf-text-metadata
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { stripMetadata, findMetadataLeft } from '@fodt/pdf-text-metadata';

const input = new Uint8Array(readFileSync('report.pdf'));
const { bytes, report } = await stripMetadata(input);
// report counts what was removed; findMetadataLeft(bytes) lists anything the copy still holds (an empty list is clean).
const left = await findMetadataLeft(bytes);
if (left.length === 0) writeFileSync('report-clean.pdf', bytes);
```

`stripMetadata(bytes)` loads the file with pdf-lib without letting it stamp its own name, deletes the trailer Info dictionary, every Metadata, PieceInfo and LastModified key in any dictionary or stream dictionary, then deletes every object that cannot be reached from the Root, the Encrypt entry or the ID (that is what removes the author and XMP of an earlier revision that pdf-lib would otherwise keep), and saves without object streams. It returns the new bytes and a `StripReport`; an encrypted or damaged file throws `PdfToolError` with a plain message that never holds the file name or any of its content. `findMetadataLeft(bytes)` loads a copy again and lists any trailer Info and any dictionary that still holds one of those keys. `extractPageTexts(pdfDocument, pages, { signal, onPage })` reads the text of an already opened PDF.js document page by page and stops at 500 pages or 2,000,000 characters; `formatPageTexts` joins the pages under --- Page N --- headings. `describeMetadata(info, xmp)` turns the information dictionary and the XMP properties into rows with control characters escaped. `checkPdfFile(header, byteLength)` and `cleanCopyName(fileName)` check a picked file before it is parsed and name the copy. `checkExpansion(bytes, { limits, signal, onProgress })` finds every stream, runs it through the filters its dictionary names (Flate, LZW, ASCII85, ASCII hex and run-length, every stage of a chain counted) with the platform's DecompressionStream, keeps nothing, and throws `PdfToolError` kind `size` the moment one stream decodes past 64 MiB or all together past 256 MiB; `stripMetadata` and `findMetadataLeft` call it before pdf-lib loads the file.

## Dependencies

- `pdfjs-dist` 6.3.289
- `@cantoo/pdf-lib` 2.11.1

## Tests

```sh
npm test
```

The fixtures are small PDFs written by reportlab 5.0.1, pikepdf 10.16.0 and pypdf 6.19.0 (never by the code under test) and committed as base64 text in test/fixtures/pdfs.ts; test/fixtures/make-fixtures.py and README.md record the commands, versions and date. A file with the document information, a catalog XMP stream, a page XMP stream, a piece-info entry and a last-modified entry, saved with and without object streams, is read back with PDF.js and pdf-lib, and the bytes of the copy are scanned raw and after decompression for the marker strings. An incrementally updated file proves the author of the superseded revision is gone from the bytes. Owner-password and user-password files prove the refusals. pypdf, pikepdf and Poppler pdftotext were run offline as second readers on the copies (their outputs are recorded in the plan summary, not run here). pdfjs-dist 6.x needs Node 22.13 or later; the test adapter supplies Promise.try, which Node 22 does not have. The memory check's rule for pictures was probed with pdfjs-dist 6.3.289 in Node: a 150 MiB picture-labelled stream placed under /Contents, /ToUnicode, /FontFile, /FontFile2, /FontFile3, /CIDToGIDMap, /Encoding and /CharProcs raised the peak memory of the process from about 85 MB to between 338 MB and the 4 GB heap limit (PDF.js ran out of memory for /FontFile and /FontFile3), so PDF.js decodes a stream under each of those keys whatever its label, while the same file without the key stayed near 85 MB; the tests write such files from the ISO 32000-1 syntax and do not need the library for them. PDF.js also reads the picture label only from the dictionary's own Subtype entry: a form whose dictionary carries the label inside a string, a nested dictionary, an array or a first of two Subtype keys is drawn, and a metadata stream with such a label is read, so the check counts those streams; the tests open each such file with pdfjs-dist 6.3.289 and require its text or title back. A 306,601 byte file whose form holds 300 MiB behind a string label raised the peak memory of a Node process reading it with PDF.js from 179 MiB to 778 MiB, and the check refuses it in about 150 ms; a picture whose header holds a comment, and a content stream after a page string longer than 64 KiB that looks like a stream start, behave the same.

## Licence

MIT. See [LICENSE](./LICENSE).
