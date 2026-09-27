# ZIP & TAR Toolkit

Create and extract ZIP archives and extract TAR and gzip archives in the browser.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Opens a ZIP file you pick and lists every entry with its path, type, size and date, so you can download the parts you need. A hostile entry name that would climb out of the archive is refused rather than followed, a link or device entry is only ever listed, and a run that would produce far more data than it consumed is stopped before it fills up your browser tab.

## Supported

- Extract ZIP (stored and deflated entries, ZIP64 archives, UTF-8 and code page 437 names)
- Every listed entry shows its path, type, size, packed size and modification date

## Limits

- Picked files up to 2 GB, above which this tool refuses rather than risk freezing the browser tab.
- Extraction stops once it has produced 256 MB of decompressed data in one run, or once a single entry expands more than 250 times its own packed size, which is how decompression bombs work.
- An entry whose path climbs out of the archive with a parent segment is never extracted; absolute paths and drive letters are made relative instead.
- Symbolic links, hard links, devices and FIFOs are listed with their target only and are never followed or extracted.
- An entry with the encryption flag set is listed but never extracted, since this tool never asks for a password.
- Compression methods other than stored and deflate — for example bzip2, LZMA or Zstandard — are listed but not extracted.
- How many files a browser lets a page download to disk at once depends on the browser.

## Ambiguous cases, and what this does about them

- A ZIP entry's Unix file type (symbolic link, device, FIFO or socket) is only decoded when the archive's own version-made-by field names UNIX as the authoring host; the same bit pattern from any other host is read as an ordinary file.
- When two entries neutralise to the same download name, the second and later ones are suffixed ' (2)', ' (3)' and so on before their extension, in the order they appear in the archive.

## Defined by

- [PKWARE .ZIP File Format Specification (APPNOTE.TXT)](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
- [Unicode.org code page 437 to Unicode mapping table](https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/PC/CP437.TXT)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **Code page 437 to Unicode mapping table** (Unicode License v3) — [source](https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/PC/CP437.TXT). Copyright © 1991-2026 Unicode, Inc. "CP437.TXT", from the MAPPINGS/VENDORS/MICSFT/PC directory.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/archive-toolkit archive-toolkit
cd archive-toolkit
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/archive-toolkit
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { extractArchive } from '@fodt/archive-toolkit';

const result = await extractArchive(reader, 'photos.zip', {}, {
  onProgress: (fraction, detail) => {},
  signal: controller.signal,
});
// result.entries lists every entry; result.files holds the extracted bytes.
```

This package takes only a RandomAccessReader over bytes already resident somewhere the caller controls (a picked File's own slices, or an in-memory Uint8Array in tests) and plain values, and names no browser-only type anywhere, not even in a comment: it is built and tested in plain Node by a release gate that has no such type available. Every byte this package produces is charged to a shared output budget before it is kept, so a hostile archive is stopped mid-stream rather than after it has already been fully expanded in memory.

## Dependencies

- `fflate` 0.8.3

## Tests

```sh
npm test
```

The ZIP reader is proven against hand-built fixtures covering the hostile cases (path traversal, overlapping entries, decompression bombs, encrypted and unsupported-method entries, damaged checksums) and against a small set of the Go programming language's own archive/zip test files, vendored under test/fixtures/go-archive, whose expected names, sizes and types are transcribed from that project's own reader tests.

## Licence

MIT. See [LICENSE](./LICENSE).
