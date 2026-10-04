# QR Code & Barcode Reader

Read QR codes and common barcodes from an image file or your camera, entirely in the browser.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Reads QR codes and common barcodes from a picture you choose, or from your camera when you pick the camera and press Run. The zxing-cpp reading engine, compiled to WebAssembly, runs in a background worker inside your browser, so a hostile or huge image can be stopped. Nothing is sent, stored or recorded: the picture, the camera frames and the text that was read stay in this page.

## Supported

- PNG, JPEG, GIF, WebP and BMP image files
- The camera, through the browser's media capture interface where the browser has one, when you pick Camera and press Run
- QR Code, Micro QR, Data Matrix, Aztec, PDF417, Code 128, Code 39, Code 93, Codabar, ITF, EAN-13, EAN-8, UPC-A and UPC-E, as zxing-wasm 3.1.3 reads them
- Several codes in one image, up to 16, each with its symbology and exact text
- Turned and reduced-size copies of a code, and light-on-dark copies of QR, Micro QR, Data Matrix and Aztec codes, which the engine tries by itself

## Limits

- Files up to 50 MB and up to 50,000,000 declared pixels are accepted; larger ones are refused before decoding.
- A picture of more than 16,777,216 pixels (a 48 megapixel photograph, for example) is scaled down to that size before it is read, because Safari on an iPhone or iPad draws a larger canvas blank; a small code in a very large photograph may therefore be missed.
- Reading stops after 20 seconds with a message; Cancel stops it at once.
- The camera starts only when you press Run with Camera chosen; it stops when a code is read, when you press Cancel, when you leave the page, or 30 seconds after the camera opens.
- If the camera does not start within 15 seconds the page stops waiting; allow camera access when the browser asks.
- Camera frames are read in the page and never recorded, stored or sent.
- A UPC-A code is reported as the EAN-13 code the engine returns, with a leading zero; the 12 digit UPC-A form is shown in a note.
- Rotated Data Matrix codes, strongly blurred photos and light-on-dark one-dimensional barcodes or PDF417 codes are not read.
- At most 16 codes are reported for one image, and the text shown for each code is cut at 4096 characters with a note; control, direction-changing and invisible characters (such as zero width marks and tag characters) are shown escaped.
- A one-dimensional barcode needs each bar at least about two pixels wide: an EAN-13 shrunk to half size, with 1.5 pixel bars, was not read.

## Ambiguous cases, and what this does about them

- A code that is valid in two symbologies is reported as the engine identifies it, with the one name the engine gives
- A UPC-E code comes back from the engine expanded to its 13 digit form, and the note says so
- Text that is not valid UTF-8 is shown as the engine decodes it; the bytes behind a code are not shown

## Defined by

- [zxing-cpp, the reading engine](https://github.com/zxing-cpp/zxing-cpp)
- [GS1 General Specifications (EAN and UPC symbols)](https://ref.gs1.org/standards/genspecs/)
- [W3C Media Capture and Streams (the camera interface)](https://www.w3.org/TR/mediacapture-streams/)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **zxing-cpp compiled into zxing-wasm 3.1.3** (Apache-2.0) — [source](https://github.com/zxing-cpp/zxing-cpp/tree/a17fd9dc65d6aa0dd2f660fdfca7a6a6613d938f). zxing-cpp is the C++ port of the ZXing barcode library, licensed under the Apache License 2.0. zxing-wasm 3.1.3 compiles it to WebAssembly and ships the result as dist/reader/zxing_reader.wasm; the package's own source is MIT. The notice file holds the Apache-2.0 text.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/qr-barcode-reader qr-barcode-reader
cd qr-barcode-reader
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/qr-barcode-reader
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prepareReader, readCodes } from '@fodt/qr-barcode-reader';

const require = createRequire(import.meta.url);
const wasm = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
await prepareReader(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));

// pixels is { data: Uint8ClampedArray (RGBA), width, height } from any image decoder or canvas.
const codes = await readCodes(pixels);
// codes[0].label is 'QR Code' and codes[0].text is the exact text.
```

`prepareReader(wasmBinary)` hands the engine its WebAssembly bytes once and keeps the promise, so a second call reuses it; nothing is ever located or fetched. `readCodes(pixels, { maxSymbols })` reads RGBA pixels and returns one `{ format, label, text, shown, truncated, notes }` per code: `format` is the engine's own name, `label` the plain name, `text` the exact decoded text, `shown` the same text with control, direction-changing and invisible characters escaped as \u{...} and cut at `MAX_TEXT_SHOWN`. `checkImageFile(header, byteLength)` (give it up to `MAX_IMAGE_HEADER_BYTES`, 2 MiB, of the start of the file, since a JPEG's size can lie behind a long profile) refuses an over-size file, an unsupported kind or more declared pixels than `MAX_INPUT_PIXELS` before any decoding, throwing `CodeReaderError` with a plain message that never holds the file name. `codeRows(results)` gives the table rows (Format, Text, Notes).

## Dependencies

- `zxing-wasm` 3.1.3

## Tests

```sh
npm test
```

The qrcode 1.5.4 library makes the QR fixtures at test time, and jsQR and @zxing/library 0.21.3 are the independent second opinions that must read the same text (56 QR codes: seven payloads, four error correction levels, two scales). Fifteen barcode and QR images from an independent writer (BWIPP through treepoem 3.29.0 and Ghostscript 10.07.1) and fourteen symbols written by this repository (Code 128, EAN-13, EAN-8 and UPC-A at two module widths, checked against @zxing/library) are committed as literals; test/fixtures/make-fixtures.py and test/fixtures/README.md record the commands, versions and dates. Documented exceptions are listed by name in the tests: a Code 93 symbol made without its check characters is not read, a UPC-E symbol is read as its 13 digit expansion, rotated Data Matrix codes, light-on-dark one-dimensional barcodes and PDF417 codes, and a half-size EAN-13 are not read (the same engine built for Python gives the same results).

## Licence

MIT. See [LICENSE](./LICENSE).
