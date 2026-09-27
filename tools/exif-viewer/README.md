# EXIF Viewer & Remover

Read image metadata and write a copy with it removed.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Reads the EXIF, GPS, XMP, IPTC and colour-profile metadata a JPEG, PNG or WebP photo carries, and writes a copy with that metadata cut out by hand -- never re-encoded -- so the picture's own pixels never change. The copy is re-read to confirm nothing is left, and a rotated photo keeps its own orientation tag by default so it is not shown sideways.

## Supported

- Reading EXIF, GPS, XMP, IPTC and ICC colour-profile blocks from JPEG and PNG with the exifr library
- Reading EXIF and XMP from WebP, whose EXIF chunk is handed to exifr as a raw TIFF stream and whose XMP chunk is read with a small hand-written extractor
- Removing metadata by cutting JPEG marker segments, PNG chunks or WebP RIFF chunks -- the picture's own scan or pixel data is copied byte for byte, never re-encoded
- Keeping the colour profile and the Exif orientation tag by default, each with its own checkbox to remove it too
- A warning naming the exact GPS coordinates when a photo records where it was taken
- Re-reading the copy after removal and reporting plainly what -- if anything -- still remains

## Limits

- Only JPEG, PNG and WebP are read; HEIC, TIFF, GIF and other formats are not accepted.
- Whether a colour profile or an orientation tag changes what a photo looks like depends on the browser used to view it.
- The colour profile is kept by default; a rotated photo's orientation tag is kept by default too.
- Maker notes (a large, camera-specific block) are never decoded.
- Information inside the picture itself, such as a visible watermark, a face or on-screen text, cannot be removed by this tool.
- Files up to 100 MB are accepted.

## Ambiguous cases, and what this does about them

- The installed exifr library has no WebP file parser at all, confirmed directly against its own source; a WebP's XMP packet (standalone XML with no JPEG or TIFF wrapper) is read with a small hand-written extractor that understands a plain element's text content and a single rdf:Alt/rdf:li language container, not a full XML or RDF parser -- an XMP packet using a more elaborate RDF shape may not show every value.
- A PNG's own zTXt (compressed text) chunks are not read by the installed exifr at all, confirmed directly against its source; this tool decompresses and reads them itself.
- A WebP's colour profile (ICCP chunk) is kept or removed on request, matching JPEG and PNG, but is not shown in the metadata table when reading, since neither the plan nor exifr expose ICC data for a raw TIFF/EXIF stream.

## Defined by

- [ITU-T T.81 -- Digital compression and coding of continuous-tone still images (JPEG)](https://www.w3.org/Graphics/JPEG/itu-t81.pdf)
- [CIPA DC-008 -- Exchangeable image file format for digital still cameras (Exif)](https://www.cipa.jp/std/documents/download_e.html?DC-008-2019-J)
- [W3C PNG (Third Edition) -- Portable Network Graphics Specification](https://www.w3.org/TR/png/)
- [RFC 9649 -- WebP Image Format](https://www.rfc-editor.org/rfc/rfc9649)
- [Adobe XMP Specification Part 3 -- Storage in Files](https://developer.adobe.com/xmp/docs/XMPSpecifications/)
- [IPTC IIM 4.2 -- Information Interchange Model](https://iptc.org/std/IIM/4.2/specification/IIMV4.2.pdf)
- [ICC.1:2022 -- Image technology colour management](https://www.color.org/specification/ICC.1-2022-05.pdf)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/exif-viewer exif-viewer
cd exif-viewer
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/exif-viewer
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { readMetadata, stripMetadata } from '@fodt/exif-viewer';

const read = await readMetadata(bytes);
// read.blocks, read.gps, read.orientation

const stripped = await stripMetadata(bytes, { keepColourProfile: true, keepOrientation: true });
// stripped.bytes, stripped.removed, stripped.kept, stripped.warnings
```

This package takes only byte arrays and plain values, and names no browser-only type anywhere, not even in a comment: it is built and tested in plain Node by a release gate that has no such type available. Every removal is a hand-written cut of marker segments (JPEG), chunks (PNG) or RIFF chunks (WebP); reading is exifr for JPEG and PNG, exifr fed a raw TIFF stream for WebP's own EXIF chunk, and a small hand-written extractor for WebP's own XMP chunk.

## Dependencies

- `exifr` 7.1.3

## Tests

```sh
npm test
```

Reading, removal, the re-read check, the colour-profile and orientation defaults, trailing-data removal and malformed-input refusal are proven in plain Node against hand-built fixtures (test/build-images.ts) covering every segment and chunk kind these specifications define, plus up to five small real camera files vendored from the exifr project's own test fixtures at a pinned commit (test/fixtures/exifr/, licensed under exifr's own MIT licence, verified byte for byte against the recorded git blob SHA). The four-browser pixel-identity and orientation proofs live only in the dedicated Playwright spec, since decoding a real image is a browser concern this package's own tests never touch.

## Licence

MIT. See [LICENSE](./LICENSE).
