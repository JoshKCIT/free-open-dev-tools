# Data URI Converter

Convert files to and from data URIs with correct MIME type and Base64 handling.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Converts a file into an RFC 2397 data URI and back, with the media type worked out from the file's own leading bytes against a signature table written in this repository, rather than trusted from a file extension that can lie. Handles both the base64 form and the percent-encoded form the RFC defines, over arbitrary bytes.

## Supported

- Encoding any file into a data URI, with the base64 marker or without it
- A media type detected from roughly thirty file formats' own leading bytes (images, fonts, audio, video, PDF, archives and byte-order-marked text), falling back to what the browser reported when no signature matches
- An explicit media type override for when neither of those is right
- Decoding a data URI back into its exact original bytes, offered as a download
- Decoding a data URI whose payload is readable text, shown directly as text so a download is not required for the common case
- Every well-formed worked example RFC 2397 itself publishes, including the one with no media type at all
- A named size ceiling checked before a file is read, before a data URI is built, and before a pasted data URI is expanded

## Limits

- A data URI carrying markup or a scalable image (SVG) is executable content the moment a browser opens it. Treat one from a source you do not trust the way you would treat an HTML file from that source, not as inert data.
- Files above 10,485,760 bytes (10 MB) are refused before they are read. A data URI is always larger than the bytes it carries -- roughly a third larger in the base64 form -- which makes it a poor choice for anything beyond a small asset.
- The media type comes from the file's leading bytes when a signature matches, and from the browser's own guess when none does. A file with no recognised signature and a misleading extension can still be reported under the wrong type.
- A ZIP-based document format (an Office file, an OpenDocument file, a JAR) is reported as a plain ZIP archive unless either its own inner signature is recognised (this tool resolves EPUB this way) or the browser supplied a more specific type -- a bare ZIP signature is deliberately never reported as anything more specific than 'a ZIP archive'.
- Decoding an empty payload (`data:,` or `data:;base64,`) is valid under RFC 2397's grammar and produces zero bytes. Encoding an empty selected file is rejected instead, on the assumption that a visitor who picked an empty file almost always picked the wrong one.
- SVG detection looks for a bare `<svg` root element. An SVG file that opens with an XML declaration instead is not caught by the signature table and falls back to the browser's reported type.

## Ambiguous cases, and what this does about them

- RFC 2397 section 2: when the media type is omitted entirely, it defaults to text/plain;charset=US-ASCII. This tool writes that default into the parsed parameters explicitly rather than leaving a reader to apply it silently.
- The same section describes a shorthand: `text/plain` may be omitted while a parameter such as charset is still supplied (for example `data:;charset=iso-8859-7,...`). This tool accepts that shorthand and fills in text/plain, keeping the given parameter exactly as written.
- One of RFC 2397's own printed worked examples, `data:text/plain;charset=iso-8859-7,%be%fg%be`, contains an invalid percent escape (`%fg` -- `g` is not a hexadecimal digit) and cannot be decoded by a grammar-correct parser. This tool rejects it, naming the position of the bad digit, and documents this as a known defect in the published document rather than loosening its own parser to accept it.

## Defined by

- [RFC 2397 — The "data" URL scheme](https://www.rfc-editor.org/rfc/rfc2397)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/data-uri data-uri
cd data-uri
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/data-uri
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildDataUri, parseDataUri, sniffMediaType } from '@fodt/data-uri';

const { dataUri, mediaType, source } = buildDataUri(bytes, { browserReportedType: file.type });
// dataUri === 'data:image/png;base64,iVBORw0KGgo...'

const decoded = parseDataUri('data:,A%20brief%20note');
// decoded.mediaType === 'text/plain', decoded.bytes decodes to 'A brief note'

sniffMediaType(bytes); // { mediaType: 'image/png', label: 'PNG image', ... } | undefined
```

`buildDataUri` and `parseDataUri` throw `DataUriError`, which carries a `position` field pointing at the offending character in the input string when one is known. Percent-encoding is implemented directly against RFC 2396's unreserved-character set rather than `encodeURIComponent`, whose escaping rules are close but not identical to this grammar's. Base64 encoding and decoding are reimplemented in this package rather than imported from `tools/base64`, because a tool folder may not depend on another tool package. `MAX_DATA_URI_BYTES` is exported so the page can check a picked file's size before ever reading it.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Every well-formed worked example RFC 2397 section 4 publishes is asserted, including the no-media-type example and the ZIP-file query-string example whose data segment contains literal commas and slashes. The RFC's own charset example contains an invalid percent escape (%fg) and is asserted as a rejection rather than a success, with a hand-written valid charset example covering the path the RFC's example was meant to illustrate. The media-type signature table (tools/data-uri/src/signatures.ts) has its own separate test file, covering a dozen independently transcribed magic-byte fixtures, the generic-container-vs-specific-inner-signature precedence rule, and the equal-length masked-match tie-break.

## Licence

MIT. See [LICENSE](./LICENSE).
