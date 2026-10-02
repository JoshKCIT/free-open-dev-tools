# Hex Viewer & File Identifier

View any file as offset, hex and text columns, search it for bytes or text, and name its type from its signature.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Opens any file in your browser and shows its bytes as offset, hex and text columns, one page at a time, so a file of any size opens without reading all of it. Jump to any byte, search the file for text or hex bytes in a background worker, and see the file's type named from its first bytes, with the evidence and the specification behind the signature. The file is read where it is: never uploaded, never changed and never stored.

## Supported

- Any file you pick, up to 2 GiB to view, or hex bytes or text you paste, up to 5 MiB
- The canonical hexdump layout: an 8 digit hex offset, 8, 16 or 32 bytes per row in groups of eight, and a text column where every byte outside printable ASCII (0x20 to 0x7E) is a full stop
- Go to byte (a decimal offset) and 16, 64 or 256 rows per page
- Search by text (encoded as UTF-8) or by hex bytes, in files up to 1 GiB: every match is counted and the first 1,000 offsets are listed
- The file type named from its signature bytes, with the evidence and the specification it comes from; a ZIP archive is named by the family its first entry suggests

## Limits

- Viewing reads only the rows on screen, for files up to 2 GiB.
- Search covers files up to 1 GiB, lists the first 1,000 matches and counts the rest; a search that takes longer than 20 seconds is stopped with a message.
- A signature is a hint: a file can begin with any bytes, so the type shown is what its first bytes suggest, not a check of the whole file.
- Match case off folds the letters A to Z only.
- Pasted hex or text is limited to 5 MiB.

## Ambiguous cases, and what this does about them

- Offsets and lengths count bytes, not characters, and offsets are shown in lower case hex with 8 digits
- Matches may overlap: searching for aa in aaa finds offsets 0 and 1
- Text search encodes what you type as UTF-8, and an unpaired surrogate is searched as U+FFFD
- The text column shows a full stop for the byte 0x7F and for every byte from 0x80 up, so a UTF-8 character shows as several full stops

## Defined by

- [PNG (Third Edition): PNG signature](https://www.w3.org/TR/png-3/)
- [RFC 1952: GZIP file format specification 4.3](https://www.rfc-editor.org/rfc/rfc1952)
- [PKWARE ZIP file format specification (APPNOTE)](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/hex-viewer hex-viewer
cd hex-viewer
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/hex-viewer
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { formatHexRows, identifyFile } from '@fodt/hex-viewer';

const bytes = new TextEncoder().encode('Hello');
console.log(formatHexRows(bytes, 0, 16));
// 00000000  48 65 6c 6c 6f                                    |Hello|

// The first 512 bytes, the last 22 bytes and the size of a file name its type:
console.log(identifyFile(bytes, bytes, bytes.length));
```

`formatHexRows(bytes, startOffset, bytesPerRow)` returns the rows of the canonical hexdump layout (8 digit hex offset, two spaces, the bytes in groups of eight, two spaces, `|text|`) with the rows joined by line breaks and no closing offset line. `parseHexInput(text)` reads pairs of hex digits with spaces or line breaks between them and refuses an odd digit count or a character that is not a digit, naming its position. `identifyFile(head, tail, size)` takes the first 512 bytes, the last 22 bytes and the byte size of a file and returns every name its signature bytes fit, each with its evidence and the address of the specification. Every expected failure is a `HexViewerError` with a plain message.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

The row layout is checked against hexdump from util-linux 2.39.3 (Ubuntu 24.04.2 under WSL 2) run with -vC on the same bytes, its output quoted as literals. The PNG signature is the one the W3C specification states in section 5.2.

## Licence

MIT. See [LICENSE](./LICENSE).
